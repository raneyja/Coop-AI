import assert from "node:assert/strict";
// Keep focused preparation regressions in the existing source-claims CI gate.
import "../prompts/repoSummaryResponseEnrichment.test";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SecureApiClient, StreamChatParams } from "./SecureApiClient";
import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import { streamSourceReviewedUnderstand, snapshotUnderstandClaimEvidence } from "./understandRepoSourceReview";
import { streamSourceReviewedEvidence } from "./sourceBackedActionReview";
import { sourceClaimVerdictFixture } from "./sourceClaimReviewTestFixture";
import { buildSourceEvidenceSynthesisRequest } from "./sourceEvidenceSynthesis";
import { resolveAssignedSourceVerificationModel, SOURCE_VERIFICATION_MAX_TOKENS } from "../config/featureModelAssignments";
import type { SourceReviewPhase } from "./sourceBackedActionReview";

const request: StreamChatParams = {message: "Explain the actual validation behavior and unknowns.",
  context: {owner: "org", repo: "service", branch: "release"}, history: [{role:"user",content:"Old unverified claim",timestamp:1}],
  model:"claude-sonnet-4-6", provider:"anthropic", useCase:"comprehension", maxTokens:16000,
  temperature:0.5, enableThinking:true, quotaTurnId:"same-turn"};
const source = "if (ready) {\n  await persist();\n}";
const quote = "```30:32:Odd/Operation.rs\n"+source+"\n```";
const summary: RepoSummaryEvidence = {entryFiles:[{path:"Odd/Operation.rs",content:source,startLine:30,endLine:32,truncated:true}],
  repoInventory:{fileCount:400,lineCount:12000,source:"index-stats",branch:"release"},
  treeOverview:{topLevelDirs:["Odd"],topLevelFiles:["README.md"]}, manifest:{fileCount:5,entryPoints:["Odd/Operation.rs"]}};
const usage = {model:request.model,provider:request.provider,inputTokens:10,outputTokens:4,estimatedCostUsd:0.1};
const result = (content: string, finishReason = "stop", cost: typeof usage | undefined = usage) => ({
  message:{role:"assistant" as const,content,timestamp:1},finishReason:finishReason as "stop"|"length",usage:cost});

test("typed snapshot admits exact windows, canonical totals and scoped samples, not opaque narratives or foreign refs", () => {
  const admitted = snapshotUnderstandClaimEvidence({...summary, repository:{description:"Invented architecture"},
    warnings:["False behavior"], entryFiles:[...summary.entryFiles!,{path:"../foreign",content:source},{path:"prefix.go",content:"partial",truncated:true}],
    dependencyGraph:{entryFile:"Odd/Operation.rs",directDependents:["client.kt"],source:"workspace"}},request.context);
  assert.deepEqual(admitted.windows,[{path:"Odd/Operation.rs",content:source,startLine:30}]);
  assert.equal(admitted.facts.find(f => f.kind==="inventory")?.value && (admitted.facts.find(f => f.kind==="inventory")!.value as {fileCount:number}).fileCount,400);
  assert.ok(admitted.facts.some(f=>f.kind==="sample" && JSON.stringify(f.value).includes('"sampleEntryCount":5')));
  assert.ok(!JSON.stringify(admitted).includes("Invented architecture"));
  assert.ok(!admitted.facts.some(f=>f.kind==="dependency"));
  for (const invalid of [{fileCount:123,source:"unavailable",branch:"release"},{fileCount:123,source:"index-stats",branch:"other"}])
    assert.ok(!snapshotUnderstandClaimEvidence({...summary,repoInventory:invalid},request.context).facts.some(f=>f.kind==="inventory"));
  assert.throws(()=>snapshotUnderstandClaimEvidence(summary,{owner:"org",repo:"service"}));
});

test("publication is private until prepared content has complete v3 review; zero quotes are allowed", async () => {
  const seen: StreamChatParams[] = [], visible: string[] = [], thinking: string[] = [];
  const stream: SecureApiClient["streamChat"] = async (body, chunk, _url, _signal, onThinking) => {
    seen.push(body); chunk("unpublished draft"); onThinking?.("unpublished reasoning"); assert.equal(visible.length,0);
    return result(body.sourceClaimReview ? sourceClaimVerdictFixture(body) : "The inspected implementation remains conditional.");
  };
  let frozen: unknown;
  const final = await streamSourceReviewedUnderstand({stream,request,summary,
    prepareAnswer:body=>body+" Imported implementations remain unverified.",onChunk:c=>visible.push(c),
    onThinking:c=>thinking.push(c),onValidated:(windows,quotes,content)=>{frozen=windows;assert.equal(quotes,0);assert.equal(content,visible[0]??content);},baseUrl:"https://fixture.invalid"});
  assert.equal(seen.length,2); assert.equal(thinking.length,0); assert.equal(visible.length,1);
  assert.equal(visible[0],final.message.content); assert.match(JSON.parse(seen[1].message).blocks.map((block:{text:string})=>block.text).join("\n"),/Imported implementations/);
  assert.deepEqual(seen[1].history,[]); assert.deepEqual(frozen,[{path:"Odd/Operation.rs",content:source,startLine:30}]);
  assert.equal(final.usage?.inputTokens,20);
});

test("unsupported prose and recommendation premises get one full replacement preserving routing/ref/quota/reasoning", async () => {
  const seen: StreamChatParams[] = [], visible: string[] = [];
  const stream: SecureApiClient["streamChat"] = async (body, chunk) => {
    seen.push(body); chunk("private");
    if (body.sourceClaimReview) {
      const candidate=JSON.parse(body.message).blocks.map((block:{text:string})=>block.text).join("\n");
      return result(sourceClaimVerdictFixture(body,candidate.includes("globally")?[{claim:"This handler applies globally.",category:"scope",reason:"No reviewed wiring establishes repository-wide application."}]:[]));
    }
    return result(seen.length===1?"This handler applies globally.\n\n"+quote:"When ready, the inspected block awaits persistence.\n\n"+quote);
  };
  const final=await streamSourceReviewedUnderstand({stream,request,summary,onChunk:c=>visible.push(c),baseUrl:"https://fixture.invalid"});
  assert.equal(seen.length,4); assert.equal(visible.length,1); assert.ok(!visible[0].includes("globally"));
  for (const generated of [seen[0],seen[2]]) {
    const assignment = generated.sourceEvidenceRepair ? {...resolveAssignedSourceVerificationModel(), maxTokens: SOURCE_VERIFICATION_MAX_TOKENS} : request;
    for (const key of ["model","provider","maxTokens"] as const) assert.equal(generated[key],assignment[key]);
    for (const key of ["quotaTurnId","temperature","enableThinking"] as const)
      assert.equal(generated[key],request[key]);
    for (const key of ["owner","repo","branch","file"] as const)
      assert.equal(generated.context[key],request.context[key]);
    assert.deepEqual(generated.history,[]); assert.equal(generated.attachments,undefined);
    assert.equal(generated.mentions,undefined); assert.equal(generated.sourceEvidenceSynthesis,true);
    assert.equal(generated.sourceClaimReview,false);
  }
  assert.equal(final.usage?.inputTokens,40); assert.match(seen[2].message,/untrusted data/);
  assert.deepEqual(seen.map(body=>Boolean(body.sourceEvidenceRepair)),[false,false,true,false]);
  assert(!seen[2].message.includes(JSON.stringify("This handler applies globally.\n\n"+quote)));
  assert(seen[2].message.includes("unchecked claims were not approved"));
});

test("Understand corrective model phase keeps frozen evidence and actual mixed-provider costs with one repair", async () => {
  const seen: StreamChatParams[] = [], phases: SourceReviewPhase[] = [], visible: string[] = [];
  const known: NonNullable<Awaited<ReturnType<SecureApiClient["streamChat"]>>["usage"]>[] = [];
  const stream: SecureApiClient["streamChat"] = async (body, chunk, _base, _signal, thinking) => {
    seen.push(body); chunk("private"); thinking?.("private reasoning");
    const content = body.sourceClaimReview ? sourceClaimVerdictFixture(body, seen.length === 2
      ? [{claim: "This handler applies globally.", category: "scope", reason: "No inspected wiring proves global application."}] : [])
      : body.sourceEvidenceRepair ? "When reached, the shown branch contains the call.\n\n" + quote : "This handler applies globally.\n\n" + quote;
    return result(content, "stop", {...usage, model: body.model, provider: body.provider,
      inputTokens: seen.length * 10, outputTokens: seen.length * 2, estimatedCostUsd: seen.length / 10});
  };
  const final = await streamSourceReviewedUnderstand({stream, request, summary, onChunk: text => visible.push(text),
    onThinking: () => assert.fail("Private quality phases cannot leak reasoning"), onFailureUsage: value => known.push(value),
    onPhase: phase => phases.push(phase), baseUrl: "https://fixture.invalid"});
  assert.equal(seen.length, 4); assert.equal(final.usage, undefined); assert.equal(visible.length, 1);
  assert.deepEqual(seen.map(body => Boolean(body.sourceEvidenceRepair)), [false, false, true, false]);
  assert.deepEqual(known.map(value => [value.model, value.provider, value.inputTokens, value.outputTokens, value.estimatedCostUsd]),
    seen.map((body, index) => [body.model, body.provider, (index + 1) * 10, (index + 1) * 2, (index + 1) / 10]));
  const complete = phases.filter(phase => phase.event === "complete");
  assert.deepEqual(complete.map(phase => [phase.phase, phase.model, phase.provider]),
    seen.map((body, index) => [index === 0 ? "synthesis" : index === 2 ? "repair" : "claim-review", body.model, body.provider]));
  assert.equal(seen[0].model, request.model);
  const assigned = resolveAssignedSourceVerificationModel();
  assert.equal(seen[2].model, assigned.model); assert.equal(seen[2].provider, assigned.provider);
  assert.equal(seen[2].maxTokens, SOURCE_VERIFICATION_MAX_TOKENS); assert.equal(seen[2].enableThinking, true);
  assert.equal(seen[2].sourceEvidenceSynthesis, true); assert.equal(seen[2].sourceClaimReview, false);
  assert.equal(seen[2].useCase, request.useCase); assert.equal(seen[2].quotaTurnId, request.quotaTurnId);
  const initial = JSON.parse(seen[0].message), repair = JSON.parse(seen[2].message.slice(0, seen[2].message.indexOf("\n\n##")));
  assert.equal(repair.evidenceId, initial.evidenceId); assert.deepEqual(repair.windows, initial.windows); assert.deepEqual(repair.facts, initial.facts);
});

test("Stop during the operator corrective draft prevents its review/publication and retains known costs once", async () => {
  const controller = new AbortController(), seen: StreamChatParams[] = [];
  const known: NonNullable<Awaited<ReturnType<SecureApiClient["streamChat"]>>["usage"]>[] = [];
  const stream: SecureApiClient["streamChat"] = async body => {
    seen.push(body);
    const content = body.sourceClaimReview ? sourceClaimVerdictFixture(body,
      [{claim: "This handler applies globally.", category: "scope", reason: "Global wiring not inspected."}])
      : body.sourceEvidenceRepair ? quote : "This handler applies globally.";
    if (body.sourceEvidenceRepair) controller.abort();
    return result(content, "stop", {...usage, model: body.model, provider: body.provider});
  };
  await assert.rejects(streamSourceReviewedUnderstand({stream, request, summary, signal: controller.signal,
    onChunk: () => assert.fail("Stopped repair cannot publish"), onFailureUsage: value => known.push(value), baseUrl: "https://fixture.invalid"}), {name: "AbortError"});
  assert.equal(seen.length, 3); assert.equal(known.length, 3);
  assert.equal(seen[2].sourceEvidenceRepair, true);
  assert.deepEqual(known.map(value => [value.model, value.provider]), seen.map(body => [body.model, body.provider]));
});

test("final formatting cannot introduce new source markers in the shared publisher", async () => {
  for (const marker of ["[[source:window-99:30:32]]", "[[source:window-1:30:32]]"]) {
    const visible:string[]=[];let calls=0;
    const stream:SecureApiClient["streamChat"]=async body=>{
      calls++;assert(!body.sourceClaimReview);return result("The shown branch contains an awaited call.\n\n"+quote);
    };
    await assert.rejects(streamSourceReviewedUnderstand({stream,request,summary,onChunk:c=>visible.push(c),
      prepareAnswer:content=>content+"\n\n"+marker,baseUrl:"https://fixture.invalid"}),/reviewed evidence/);
    assert.equal(calls,2);assert.deepEqual(visible,[]);
  }
});

test("custom Understand focus uses the same admitted snapshot for generation and review, excluding legacy overview and history", async () => {
  const mutable=structuredClone(summary), seen:StreamChatParams[]=[];
  mutable.repository={description:"UNVERIFIED_REPOSITORY_OVERVIEW"};
  mutable.warnings=["UNVERIFIED_WARNING_BEHAVIOR"];
  const originalRequest:StreamChatParams={...request,maxTokens:8192,
    message:"LEGACY_BUNDLE_PROMPT with UNVERIFIED_REPOSITORY_OVERVIEW",
    context:{...request.context,file:"Odd/Operation.rs",contextBundle:{summary:"UNVERIFIED_CONTEXT_OVERVIEW"}},
    history:[{role:"assistant",content:"UNVERIFIED_HISTORY_CLAIM",timestamp:1}],
    mentions:[{repoId:"foreign",path:"Unreviewed/file",snippet:"UNVERIFIED_MENTION",source:"local"}],
    attachments:[{id:"unreviewed",name:"UNVERIFIED_ATTACHMENT",mimeType:"image/png",dataUrl:"data:image/png;base64,AA=="}]};
  const question="Explain the requested persistence flow, preserve its ready condition, and identify unverified callers.";
  const stream:SecureApiClient["streamChat"]=async body=>{
    seen.push(body);
    if(!body.sourceClaimReview) {
      mutable.entryFiles![0].content="mutated()";mutable.repoInventory!.fileCount=999;
      originalRequest.context.branch="wrong-ref";
      return result("When ready, the inspected block awaits persistence. Imported callers remain unverified.\n\n"+quote);
    }
    return result(sourceClaimVerdictFixture(body));
  };
  await streamSourceReviewedUnderstand({stream,request:originalRequest,summary:mutable,question,
    onChunk:()=>undefined,baseUrl:"https://fixture.invalid"});
  assert.equal(seen.length,2);
  const generation=JSON.parse(seen[0].message), review=JSON.parse(seen[1].message);
  assert.equal(generation.task,question);assert.equal(review.question,question);
  assert.equal(generation.action,"comprehension");assert.equal(generation.schema,"coop-source-evidence-v1");
  assert.equal(generation.evidenceId,review.evidenceId);
  for(const key of ["identity","facts","coverage"])
    assert.deepEqual(generation[key],review[key]);
  const reconstructed=generation.windows.map(({lines,...window}: {lines:Array<{line:number;text:string}>;id:string;path:string;startLine:number;endLine:number})=>
    ({...window,content:lines.map(row=>row.text).join("\n")}));
  assert.deepEqual(generation.windows,review.windows);
  assert.deepEqual(generation.windows[0].lines.map((row:{line:number})=>row.line),[30,31,32]);
  assert.equal(generation.windows[0].content,undefined);
  assert.equal(reconstructed[0].content,source);
  assert.equal(generation.identity.branch,"release");
  assert.equal(generation.facts.find((fact:{kind:string})=>fact.kind==="inventory").value.fileCount,400);
  for(const body of seen) {
    assert.ok(!JSON.stringify(body).includes("UNVERIFIED_"));assert.ok(!body.message.includes("LEGACY_BUNDLE_PROMPT"));
    assert.deepEqual(body.history,[]);assert.equal(body.attachments,undefined);assert.equal(body.mentions,undefined);
    assert.deepEqual(body.context,{owner:"org",repo:"service",branch:"release",file:"Odd/Operation.rs"});
    for(const key of ["quotaTurnId","temperature","enableThinking"] as const)
      assert.equal(body[key],request[key]);
    if (!body.sourceClaimReview) {assert.equal(body.model,request.model);assert.equal(body.provider,request.provider);}
  }
  assert.equal(originalRequest.maxTokens,8192);
  assert.equal(seen[0].maxTokens,16000);assert.equal(seen[0].sourceEvidenceSynthesis,true);
  assert.equal(seen[1].maxTokens,32768);assert.equal(seen[1].sourceClaimReview,true);
});

test("generation capacity preserves nonthinking and larger configured budgets",()=>{
  for(const [enableThinking,maxTokens,expected] of [[false,8192,8192],[true,8192,16000],[true,32000,32000]] as const) {
    const original={...request,enableThinking,maxTokens};
    const admitted=snapshotUnderstandClaimEvidence(summary,original.context);
    const generated=buildSourceEvidenceSynthesisRequest(original,"Explain the ready condition.",admitted.windows,admitted.facts);
    assert.equal(generated.maxTokens,expected);assert.equal(generated.enableThinking,enableThinking);
    assert.equal(original.maxTokens,maxTokens);
    assert.equal(generated.model,original.model);assert.equal(generated.provider,original.provider);
    assert.equal(generated.quotaTurnId,original.quotaTurnId);
    const inherited = buildSourceEvidenceSynthesisRequest({...original, sourceEvidenceRepair: true}, "Explain", admitted.windows, admitted.facts);
    assert.equal(inherited.sourceEvidenceRepair, false); assert.equal(inherited.model, original.model);
  }
});

test("source markers render exact admitted bytes before preparation and review, and publication equals the reviewed body",async()=>{
  const seen:StreamChatParams[]=[], visible:string[]=[];
  let prepared="",preparations=0,validated="";
  const stream:SecureApiClient["streamChat"]=async body=>{
    seen.push(body);
    if(!body.sourceClaimReview)return result("When ready, the inspected block awaits persistence.\n\n[[source:window-1:30:32]]");
    const review=JSON.parse(body.message);
    assert.equal(review.candidate,undefined);assert.equal(review.candidateId,createHash("sha256").update(prepared).digest("hex"));
    assert.equal(review.windows[0].lines.map((line:{text:string})=>line.text).join("\n"),source);
    return result(sourceClaimVerdictFixture(body));
  };
  const final=await streamSourceReviewedUnderstand({stream,request,summary,
    prepareAnswer:content=>{preparations++;assert.ok(content.includes(quote));assert.ok(!content.includes("[[source:"));
      return prepared=content+"\n\nImported callers remain unverified.";},
    onValidated:(_windows,quotes,content)=>{assert.equal(quotes,1);validated=content;},
    onChunk:content=>visible.push(content),baseUrl:"https://fixture.invalid"});
  assert.equal(seen.length,2);assert.equal(preparations,1);
  assert.deepEqual(visible,[prepared]);assert.equal(validated,prepared);assert.equal(final.message.content,prepared);
});

test("unknown and out-of-range source markers repair privately once; persistent invalid references never reach review or publication",async()=>{
  for(const marker of ["[[source:window-9:30:32]]","[[source:window-1:29:32]]","[[source:window-1:30:40]]"]) {
    for(const persistent of [false,true]) {
      let generations=0,reviews=0,repairs=0,preparations=0;const visible:string[]=[],known:unknown[]=[];
      const stream:SecureApiClient["streamChat"]=async body=>{
        if(body.sourceClaimReview) {reviews++;assert.equal(generations,2);
          const review=JSON.parse(body.message);assert.equal(review.candidate,undefined);assert.equal(review.windows[0].lines.map((line:{text:string})=>line.text).join("\n"),source);
          return result(sourceClaimVerdictFixture(body));}
        generations++;assert.equal(visible.length,0);
        return result("When ready, the inspected block awaits persistence.\n\n"+
          (generations===1 || persistent ? marker : "[[source:window-1:30:32]]"));
      };
      const run=streamSourceReviewedUnderstand({stream,request,summary,
        prepareAnswer:content=>{preparations++;assert.ok(content.includes(quote));return content;},
        onRepair:event=>{repairs++;assert.ok(event.reasons.includes("invalid-source-citation"));},
        onFailureUsage:cost=>known.push(cost),onChunk:content=>visible.push(content),baseUrl:"https://fixture.invalid"});
      if(persistent) {
        await assert.rejects(run);assert.equal(reviews,0);assert.equal(preparations,0);assert.equal(visible.length,0);assert.equal(known.length,2);
      } else {
        const final=await run;assert.equal(reviews,1);assert.equal(preparations,1);assert.deepEqual(visible,[final.message.content]);
        assert.equal(final.usage?.inputTokens,30);
      }
      assert.equal(generations,2);assert.equal(repairs,1);
    }
  }
});

test("claims added by publication preparation are reviewed and cannot escape the gate", async () => {
  let calls=0;const visible:string[]=[];
  const stream:SecureApiClient["streamChat"]=async body=>{
    calls++;
    return result(body.sourceClaimReview?sourceClaimVerdictFixture(body,[{claim:"This handler applies globally.",category:"scope",reason:"Preparation added an unsupported scope claim."}]):"The local inspected source is conditional.");
  };
  await assert.rejects(streamSourceReviewedUnderstand({stream,request,summary,
    prepareAnswer:body=>body+"\n\nThis handler applies globally.",onChunk:c=>visible.push(c),baseUrl:"https://fixture.invalid"}));
  assert.equal(calls,4);assert.equal(visible.length,0);
});

test("source mutation during synthesis cannot change replacement, review evidence or published quote", async () => {
  const mutable=structuredClone(summary), originalRequest=structuredClone(request), seen:StreamChatParams[]=[];
  const stream:SecureApiClient["streamChat"]=async body=>{
    seen.push(body);
    if(!body.sourceClaimReview){mutable.entryFiles![0].content="destroy()";mutable.repoInventory!.fileCount=999;originalRequest.context.branch="other";return result(quote);}
    const review=JSON.parse(body.message);assert.equal(review.identity.branch,"release");assert.equal(review.windows[0].lines.map((line:{text:string})=>line.text).join("\n"),source);
    assert.equal(review.facts.find((fact:{kind:string})=>fact.kind==="inventory").value.fileCount,400);
    return result(sourceClaimVerdictFixture(body));
  };
  const final=await streamSourceReviewedUnderstand({stream,request:originalRequest,summary:mutable,onChunk:()=>undefined,baseUrl:"https://fixture.invalid"});
  assert.equal(final.message.content,quote);assert.equal(seen.length,2);
});

test("invalid quotes, incomplete answers, empty bodies and unfinished fences repair once without unchecked continuation", async () => {
  for(const bad of [result(quote.replace("persist","destroy")),result("partial","length"),result("**Unknowns**"),result(""),result("~~~~rust\npartial")]){
    let generated=0,total=0;const visible:string[]=[];
    const stream:SecureApiClient["streamChat"]=async body=>{total++;return body.sourceClaimReview?result(sourceClaimVerdictFixture(body)):++generated===1?bad:result(quote);};
    await streamSourceReviewedUnderstand({stream,request,summary,onChunk:c=>visible.push(c),baseUrl:"https://fixture.invalid"});
    assert.equal(generated,2);assert.equal(total,3);assert.deepEqual(visible,[quote]);
  }
});

test("invalid or failed review and a second unsupported answer fail closed with all known costs exactly once", async () => {
  for(const mode of ["invalid-review","review-error","repeated-claim"]){
    let calls=0;const visible:string[]=[],known:unknown[]=[];
    const stream:SecureApiClient["streamChat"]=async body=>{
      calls++;if(!body.sourceClaimReview)return result("This handler applies globally.");
      if(mode==="review-error")throw Error("Review provider failed");
      if(mode==="invalid-review")return result("{}");
      return result(sourceClaimVerdictFixture(body,[{claim:"This handler applies globally.",category:"scope",reason:"Unverified scope."}]));
    };
    await assert.rejects(streamSourceReviewedUnderstand({stream,request,summary,onChunk:c=>visible.push(c),onFailureUsage:u=>known.push(u),baseUrl:"https://fixture.invalid"}));
    assert.equal(visible.length,0);assert.equal(calls,mode==="repeated-claim"?4:2);assert.equal(known.length,mode==="review-error"?1:calls);
  }
});

test("Stop during synthesis/review and before publication never leaks text/thinking or schedules more calls", async () => {
  for(const stopAt of [0,1,2,3]){
    const controller=new AbortController();let calls=0;const known:unknown[]=[];
    if(stopAt===0)controller.abort();
    const stream:SecureApiClient["streamChat"]=async(body,chunk,_url,_signal,onThinking)=>{calls++;chunk("private");onThinking?.("private thought");
      const answer=body.sourceClaimReview?sourceClaimVerdictFixture(body):quote;if(calls===stopAt)controller.abort();return result(answer);};
    await assert.rejects(streamSourceReviewedUnderstand({stream,request,summary,signal:controller.signal,onChunk:()=>assert.fail("No publication"),
      onThinking:()=>assert.fail("No leaked thinking"),onValidated:()=>{if(stopAt===3)controller.abort();},onFailureUsage:u=>known.push(u),baseUrl:"https://fixture.invalid"}),{name:"AbortError"});
    assert.equal(calls,Math.min(stopAt,2));assert.equal(known.length,calls);
  }
});

test("missing or mixed-model usage remains unaggregated; known calls retain their actual provider labels", async () => {
  for(const mode of ["missing","mixed"]){const known:typeof usage[]=[];let calls=0;
    const stream:SecureApiClient["streamChat"]=async body=>{calls++;const answer=result(body.sourceClaimReview?sourceClaimVerdictFixture(body):quote);
      return body.sourceClaimReview?{...answer,usage:mode==="missing"?undefined:{...usage,model:"other-model"}}:answer;};
    const final=await streamSourceReviewedUnderstand({stream,request,summary,onChunk:()=>undefined,onFailureUsage:u=>known.push(u),baseUrl:"https://fixture.invalid"});
    assert.equal(calls,2);assert.equal(final.usage,undefined);assert.equal(known.length,mode==="missing"?1:2);
  }
});

test("admission rejects malformed source windows and undefined facts before any model call", async()=>{
  let calls=0;const stream:SecureApiClient["streamChat"]=async()=>{calls++;return result("unused");};
  await assert.rejects(streamSourceReviewedEvidence({stream,request,windows:[{path:"file",content:source,startLine:0}],facts:[],onChunk:()=>undefined,baseUrl:"https://fixture.invalid"}));
  await assert.rejects(streamSourceReviewedEvidence({stream,request,windows:[],facts:[{kind:"sample",scope:"scope",value:undefined}],onChunk:()=>undefined,baseUrl:"https://fixture.invalid"}));
  assert.equal(calls,0);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canonical, gradeResult, loadCases, validateApproval, validateAuthorization, fixtureWorkspace, runAdmitted } from "./enterprise-eval";
import { sourceClaimVerdictFixture } from "../src/chat/sourceClaimReviewTestFixture";
import { streamSourceReviewedEvidence } from "../src/chat/sourceBackedActionReview";
import type { StreamChatParams, SecureApiClient } from "../src/chat/SecureApiClient";
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,"../evals/enterprise/v1/catalog.json"),"utf8"));
const c=loadCases()[0];
test("fixed catalog has sixty distinct tasks, ten each, forty percent heldout and seven language families",()=>{
 assert.equal(catalog.cases.length,60);assert.equal(new Set(catalog.cases.map((c:{id:string})=>c.id)).size,60);
 const families=new Map<string,number>();for(const c of catalog.cases)families.set(c.family,(families.get(c.family)??0)+1);
 assert.equal(families.size,6);assert.ok([...families.values()].every(n=>n===10));
 assert.equal(catalog.cases.filter((c:{split:string})=>c.split==="heldout").length,24);
 assert.ok(new Set(catalog.cases.map((c:{languageFamily:string})=>c.languageFamily)).size>=3);
 assert.equal(new Set(catalog.cases.map((c:{questionSha256:string})=>c.questionSha256)).size,60);
});
test("development corpus commitments and actual remote-workspace fixture owner agree",async()=>{
 assert.equal(loadCases().length,36);const output=await fixtureWorkspace(c);assert.deepEqual(output.reads,[c.identity.file]);
 assert.equal(output.bodies[0]?.origin,"remote");assert.equal(output.inventory.source,"index-stats");
});
test("canonical commitments do not depend on object insertion order",()=>assert.equal(canonical({z:1,a:{y:2,b:1}}),canonical({a:{b:1,y:2},z:1})));
test("no review or quota authorization means fail before any provider connection",()=>{
 assert.throws(()=>validateApproval({verdict:"supported"}),/independent oracle approval/);
 assert.throws(()=>validateAuthorization({},{}),/independent oracle approval/);
});
test("false refusal, useless unknown and severe or unauthorized outputs never pass scoring",()=>{
 const j={status:"pass",severeUnsupported:false,unauthorizedSuccess:false,usefulFindingPresent:true,positiveFindingPresent:true};
 assert.equal(gradeResult({positiveFindingRequired:true},j),true);
 for(const bad of [{...j,positiveFindingPresent:false},{...j,severeUnsupported:true},{...j,unauthorizedSuccess:true},{...j,status:"unavailable"},{...j,usefulFindingPresent:false}])assert.equal(gradeResult({positiveFindingRequired:true},bad),false);
 assert.equal(gradeResult({positiveFindingRequired:false},{...j,usefulFindingPresent:false}),false);
});
for(const control of ["foreign-source","changed-source","partial-stream","malformed-verdict"]){
 test(`actual source owner retains ${control} refusal with zero publication`,async()=>{
  const visible:string[]=[];const source=c.windows[0];
  const content=control==="foreign-source"?"```1:1:foreign/path.ts\ninvented();\n```":control==="changed-source"?`\`\`\`1:1:${source.path}\ninvented();\n\`\`\``:`Shown source.\n\n[[source:window-1:1:3]]`;
  const stream:SecureApiClient["streamChat"]=async body=>({message:{role:"assistant",timestamp:0,content:body.sourceClaimReview?control==="malformed-verdict"?"{}":sourceClaimVerdictFixture(body):content},finishReason:control==="partial-stream"?"length":"stop"});
  const request:StreamChatParams={message:c.question,context:c.identity,history:[],model:"fixture",provider:"openai",useCase:"comprehension",maxTokens:16000,temperature:0,enableThinking:true,quotaTurnId:"fixture-control"};
  await assert.rejects(streamSourceReviewedEvidence({stream,request,windows:c.windows,facts:c.facts,baseUrl:"https://fixture.invalid",onChunk:chunk=>visible.push(chunk)}));assert.deepEqual(visible,[]);
 });
}
test("Stop before synthesis and malformed admitted source/fact cause zero model calls",async()=>{
 let calls=0;const stream:SecureApiClient["streamChat"]=async()=>{calls++;throw Error("Unexpected call");};
 const request:StreamChatParams={message:c.question,context:c.identity,history:[],model:"fixture",provider:"openai",useCase:"comprehension",maxTokens:16000,temperature:0,enableThinking:true,quotaTurnId:"fixture-control"};
 const abort=new AbortController();abort.abort();
 const base={stream,request,windows:c.windows,facts:c.facts,baseUrl:"https://fixture.invalid",onChunk:()=>assert.fail("Unexpected publication")};
 await assert.rejects(streamSourceReviewedEvidence({...base,signal:abort.signal}));
 await assert.rejects(streamSourceReviewedEvidence({...base,windows:[{path:"fixture",content:"body",startLine:0}]}));
 await assert.rejects(streamSourceReviewedEvidence({...base,facts:[{kind:"sample",scope:"fixture",value:undefined}]}));assert.equal(calls,0);
});
test("synthetic adjudication is labelled enforcement and only exact reviewed bytes reach publication",async()=>{
 const stream:SecureApiClient["streamChat"]=async body=>({message:{role:"assistant",timestamp:0,content:body.sourceClaimReview?sourceClaimVerdictFixture(body):"Fixture admission.\n\n[[source:window-1:1:3]]"},finishReason:"stop"});
 const result=await runAdmitted(c,stream,"https://fixture.invalid","fixture","openai");assert.equal(result.result.message.content.includes("[[source:"),false);
});

test("original run journal binds every attempted repeat and native completion before any quality aggregation",async()=>{
  // Real existing owner + intercepted backend, artificial enforcement only.
  const os=await import("node:os"),{providerRun,observedAttempts,score,hash}=await import("./enterprise-eval"),{CoopBackendClient}=await import("../src/api/CoopBackendClient");
  const proto=CoopBackendClient.prototype,oldMe=proto.fetchMe,oldStream=proto.streamChat,oldToken=process.env.COOP_EVAL_TOKEN;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"eh06-journal-control-"));
  const freeze=JSON.parse(fs.readFileSync(path.join(__dirname,"../evals/enterprise/v1/freeze.json"),"utf8"));
  const approval={...freeze,verdict:"APPROVED_ORACLES_FOR_SCORING",independentReviewer:"synthetic-test-only",reviewReportSha256:hash("synthetic-test-only"),reviewerIsRepairAuthor:false,caseIds:catalog.cases.map((c:{id:string})=>c.id)};
  const auth={baseUrl:"https://fixture.invalid",reviewedAccountAndQuota:true,phaseAuthorityQualified:true,backendArtifactSha256:hash("synthetic"),quotaEvidenceSha256:hash("synthetic"),account:{orgId:"fixture-org",userId:"fixture-user"},model:"fixture",provider:"openai",maxCalls:34,maxCases:1,maxUsd:1,perCallReservedUsd:.1,caseIds:[c.id],repeats:[1,2,3],severeCaseIds:[c.id],campaignId:"synthetic-campaign"};
  Object.assign(approval,{observedRunPlan:{schema:"coop-observed-plan-v3",campaigns:[{campaignId:auth.campaignId,runDirectory:path.join(directory,"original"),attempts:[1,2,3].map(repeat=>({caseId:c.id,repeat}))}],severeCaseIds:[c.id]}});Object.assign(approval,{observedRunPlanSha256:hash(canonical((approval as any).observedRunPlan))});
  const selection=(run:any)=>{const m=JSON.parse(fs.readFileSync(run.observedManifest.path,"utf8")),runs=[{manifestPath:run.observedManifest.path,manifestSha256:hash(fs.readFileSync(run.observedManifest.path)),admissionSha256:m.admission.sha256}];return {runs,review:{independentReviewer:"synthetic-test-only",reviewerIsAnswerAuthor:false,reviewReportSha256:hash("synthetic"),backendArtifactSha256:hash("synthetic"),observedSelectionSha256:hash(canonical(runs))}};};
  try{
    process.env.COOP_EVAL_TOKEN="fictional-recorder-token";proto.fetchMe=async()=>({orgId:"fixture-org",orgName:"fixture",userId:"fixture-user",plan:"free",canUseLightning:false,quota:{} as any});
    proto.streamChat=async(_base,body,onChunk)=>{const content=body.sourceClaimReview?sourceClaimVerdictFixture(body as StreamChatParams):"Scoped fixture.\n\n[[source:window-1:1:3]]";onChunk(content);return {content,finishReason:"stop",usage:{type:"done",finishReason:"stop",model:"fixture",provider:"openai",usage:{inputTokens:1,outputTokens:1,estimatedCostUsd:.01}}};};
    const run=await providerRun(auth,approval,[c],path.join(directory,"original")),selected=selection(run),observed=observedAttempts(selected,approval,catalog);
    await assert.rejects(providerRun(auth,approval,[c],path.join(directory,"original")),/not be overwritten/);
    assert.equal(observed.length,3);assert.ok(observed.every(o=>o.nativeEligible));
    await assert.rejects(providerRun(auth,approval,[c],path.join(directory,"unapproved-rerun")),/reviewed campaign universe/);
    const alternateApproval=(name:string)=>{const result=structuredClone(approval);(result as any).observedRunPlan.campaigns[0].runDirectory=path.join(directory,name);(result as any).observedRunPlanSha256=hash(canonical((result as any).observedRunPlan));return result;};
    const completeFixture=proto.streamChat;
    proto.streamChat=async(base,body,onChunk,signal)=>{const result=await completeFixture.call(proto,base,body,onChunk,signal);return body.sourceClaimReview||body.sourceEvidenceRepair?result:{...result,finishReason:"length"};};
    const repairedApproval=alternateApproval("repaired"),repaired=await providerRun({...auth,maxUsd:5},repairedApproval,[c],path.join(directory,"repaired"));assert.ok(observedAttempts(selection(repaired),repairedApproval,catalog).every(o=>o.nativeEligible));
    proto.streamChat=completeFixture;
    const budgetApproval=alternateApproval("budgeted"),budgeted=await providerRun({...auth,maxCalls:1},budgetApproval,[c],path.join(directory,"budgeted")),budgetObserved=observedAttempts(selection(budgeted),budgetApproval,catalog);
    assert.equal(budgetObserved.length,3);assert.ok(budgetObserved.every(o=>!o.nativeEligible));assert.equal(budgetObserved.filter(o=>o.status==="NOT_EXECUTED").length,2);
    const labels=observed.map(o=>({caseId:o.caseId,repeat:o.repeat,answerSha256:o.answerSha256,oracleSha256:o.oracleSha256,independentReviewer:"synthetic-test-only",reviewerIsAnswerAuthor:false,explanation:"Enforcement fixture",evidenceReferences:["synthetic-only"],status:"pass",severeUnsupported:o.repeat===2,unauthorizedSuccess:false,usefulFindingPresent:true,positiveFindingPresent:true}));
    assert.throws(()=>score(catalog,labels.filter(j=>j.repeat!==2),run.results.filter((o:any)=>o.repeat!==2),approval,selected),/observed universe/);
    assert.throws(()=>score(catalog,labels,run.results,approval),/observed-run selection/);
    assert.throws(()=>score(catalog,labels.slice(0,2),run.results,approval,selected),/independent judgment/);
    const unknown={...run.results[0],caseId:"unknown"};assert.throws(()=>score(catalog,[...labels,{...labels[0],caseId:"unknown"}],[...run.results,unknown],approval,selected),/observed universe/);
    assert.throws(()=>score(catalog,[...labels.slice(0,2),labels[0]],run.results,approval,selected),/bijection|incomplete or duplicated/);
    assert.throws(()=>observedAttempts({...selected,runs:[]},approval,catalog));
    assert.throws(()=>score(catalog,labels,run.results,approval,{...selected,runs:[{...selected.runs[0],manifestPath:path.join(directory,"absent.json")}]}));
    assert.throws(()=>score(catalog,labels,run.results.map((o:any)=>({...o,attemptedBodyArtifacts:[]})),approval,selected),/observed universe/);
    assert.throws(()=>score(catalog,labels,[...run.results,run.results[0]],approval,selected),/observed universe/);
    assert.throws(()=>observedAttempts({...selected,runs:[{...selected.runs[0],manifestSha256:"0".repeat(64)}]},approval,catalog));
    // Self-consistently rehash artificial malformed originals: type checks must
    // still reject them even under a deliberately synthetic custodian pin.
    const mutationApprovals:Record<string,any>={};
    const mutate=(name:string,transform:(row:any)=>void)=>{
      const out=path.join(directory,name);fs.cpSync(path.join(directory,"original"),out,{recursive:true});
      const manifestPath=path.join(out,"observed-run.json"),m=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
      const replace=(x:any):any=>typeof x==="string"?x.replaceAll(path.join(directory,"original"),out):Array.isArray(x)?x.map(replace):x&&typeof x==="object"?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,replace(v)])):x;
      const rows=fs.readFileSync(path.join(out,"attempt-journal.jsonl"),"utf8").trim().split("\n").map(line=>replace(JSON.parse(line)));
      const mutatedApproval=alternateApproval(name);mutationApprovals[name]=mutatedApproval;
      rows[0].data.reviewedPlanSha256=(mutatedApproval as any).observedRunPlanSha256;
      fs.writeFileSync(path.join(out,"admission.json"),canonical(rows[0].data));
      m.admission.sha256=hash(fs.readFileSync(path.join(out,"admission.json")));
      rows.forEach(transform);
      for(const finish of rows.filter(r=>r.event==="attempt-finished")){
        const original=replace(JSON.parse(fs.readFileSync(finish.data.outputArtifact,"utf8"))),id=finish.data.attemptId;
        original.attemptedBodyArtifacts=rows.filter(r=>r.event==="body-retained"&&r.data.attemptId===id).map(r=>r.data);
        original.phaseEvents=rows.filter(r=>r.event==="phase-observed"&&r.data.attemptId===id).map(r=>r.data);
        fs.writeFileSync(finish.data.outputArtifact,canonical(original));finish.data.outputSha256=hash(fs.readFileSync(finish.data.outputArtifact));
      }
      const closed=rows.at(-1);
      for(const index of closed.data.indexes){if(index.name==="private-body-index.json")fs.writeFileSync(index.path,canonical(rows.filter(r=>r.event==="body-retained").map(r=>r.data)));else if(index.name==="private-phase-index.json")fs.writeFileSync(index.path,canonical(rows.filter(r=>r.event==="phase-observed").map(r=>r.data)));index.sha256=hash(fs.readFileSync(index.path));}
      let previous="0".repeat(64);rows.forEach((row,i)=>{row.previous=previous;row.sequence=i+1;const {sha256,...payload}=row;row.sha256=hash(canonical(payload));previous=row.sha256;});
      fs.writeFileSync(path.join(out,"attempt-journal.jsonl"),rows.map(canonical).join("\n")+"\n");Object.assign(m,replace(m),{head:previous,journalPath:path.join(out,"attempt-journal.jsonl")});fs.writeFileSync(manifestPath,canonical(m));
      return selection({observedManifest:{path:manifestPath}});
    };
    for(const [name,change] of [
      ["close-count",(r:any)=>{if(r.event==="run-closed")r.data.finishedCount--;}],
      ["unknown-attempt",(r:any)=>{if(r.event==="native-chunk")r.data.attemptId="unknown";}],
      ["missing-usage-identity",(r:any)=>{if(r.event==="call-finished")r.data.usage.model=null;}],
      ["length",(r:any)=>{if(r.event==="body-retained"&&r.data.stage==="native-terminal-response"&&r.data.phase==="synthesis")r.data.finishReason="length";if(r.event==="call-finished"&&r.data.phase==="synthesis")r.data.finishReason="length";}],
      ["disconnected",(r:any)=>{if(r.event==="body-retained"&&r.data.stage==="native-terminal-response")r.data.transportCompleted=false;}],
      ["identity-missing",(r:any)=>{if(r.event==="body-retained"&&r.data.stage==="native-terminal-response")r.data.quotaTurnId=null;}],
      ["source-mismatch",(r:any)=>{if(r.event==="body-retained")r.data.sourceCaseSha256="0".repeat(64);}],
      ["call-missing",(r:any)=>{if(r.event==="body-retained"&&r.data.stage==="native-terminal-response")r.data.callId=null;}],
      ["wrong-review-evidence",(r:any)=>{if(r.event==="call-started"&&r.data.phase==="review")r.data.evidenceId="0".repeat(64);}],
      ["publication-mismatch",(r:any)=>{if(r.event==="eligible-publication")r.data.answerSha256="0".repeat(64);}],
      ["phase-missing",(r:any)=>{if(r.event==="body-retained"&&r.data.stage==="native-terminal-response")r.data.phase=null;}],
      ["chunks-missing",(r:any)=>{if(r.event==="body-retained"&&r.data.stage==="native-partial-sequence"){delete r.data.streamArtifact;delete r.data.streamSha256;}}]
    ] as Array<[string,(row:any)=>void]>){const altered=mutate(name,change);assert.throws(()=>observedAttempts(altered,mutationApprovals[name],catalog));}
    const missing=mutate("output-missing",()=>{});fs.unlinkSync(path.join(directory,"output-missing",`${c.id}-2.json`));assert.throws(()=>observedAttempts(missing,mutationApprovals["output-missing"],catalog));
    assert.throws(()=>validateAuthorization({...auth,repeats:[1,2]},approval),/three distinct repeats/);
  }finally{proto.fetchMe=oldMe;proto.streamChat=oldStream;if(oldToken===undefined)delete process.env.COOP_EVAL_TOKEN;else process.env.COOP_EVAL_TOKEN=oldToken;fs.rmSync(directory,{recursive:true,force:true});}
});

test("private provider capture retains rejected terminal/prepared and failed partial bytes without publishing",async()=>{
  // Existing backend methods are intercepted before any HTTP/auth/account call.
  // This checks recorder behavior only; no provider or answer-quality result.
  const os=await import("node:os"),{providerRun,observedAttempts,hash}=await import("./enterprise-eval"),{CoopBackendClient}=await import("../src/api/CoopBackendClient");
  const proto=CoopBackendClient.prototype,oldMe=proto.fetchMe,oldStream=proto.streamChat,oldToken=process.env.COOP_EVAL_TOKEN;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"eh06-recorder-control-"));
  const freeze=JSON.parse(fs.readFileSync(path.join(__dirname,"../evals/enterprise/v1/freeze.json"),"utf8"));
  const approval={...freeze,verdict:"APPROVED_ORACLES_FOR_SCORING",independentReviewer:"synthetic-test-only",reviewReportSha256:hash("synthetic-test-only"),reviewerIsRepairAuthor:false,caseIds:catalog.cases.map((c:{id:string})=>c.id)};
  const auth={baseUrl:"https://fixture.invalid",reviewedAccountAndQuota:true,phaseAuthorityQualified:true,backendArtifactSha256:hash("synthetic"),quotaEvidenceSha256:hash("synthetic"),account:{orgId:"fixture-org",userId:"fixture-user"},model:"fixture",provider:"openai",maxCalls:34,maxCases:1,maxUsd:1,perCallReservedUsd:.1,caseIds:[c.id],repeat:1,campaignId:"synthetic-recorder-campaign"};
  Object.assign(approval,{observedRunPlan:{schema:"coop-observed-plan-v3",campaigns:[{campaignId:auth.campaignId,runDirectory:path.join(directory,"rejected"),attempts:[{caseId:c.id,repeat:1}]}],severeCaseIds:[]}});Object.assign(approval,{observedRunPlanSha256:hash(canonical((approval as any).observedRunPlan))});
  try{
    process.env.COOP_EVAL_TOKEN="fictional-recorder-token";
    proto.fetchMe=async()=>({orgId:"fixture-org",orgName:"fixture",userId:"fixture-user",plan:"free",canUseLightning:false,quota:{} as any});
    for(const mode of ["rejected","partial"]){
      proto.streamChat=async(_base,body,onChunk)=>{
        if(mode==="partial"){onChunk("exact partial fragment");throw Error("Artificial interrupted transport");}
        const content=body.sourceClaimReview?"{}":"Scoped fixture.\n\n[[source:window-1:1:3]]";
        onChunk(content);return {content,finishReason:"stop",usage:{type:"done",finishReason:"stop",model:"fixture",provider:"openai",usage:{inputTokens:1,outputTokens:1,estimatedCostUsd:.01}}};
      };
      const out=path.join(directory,mode);(approval as any).observedRunPlan.campaigns[0].runDirectory=out;(approval as any).observedRunPlanSha256=hash(canonical((approval as any).observedRunPlan));const run=await providerRun(auth,approval,[c],out),result=run.results[0];
      const m=JSON.parse(fs.readFileSync(run.observedManifest.path,"utf8")),runs=[{manifestPath:run.observedManifest.path,manifestSha256:run.observedManifest.sha256,admissionSha256:m.admission.sha256}];
      const observed=observedAttempts({runs,review:{independentReviewer:"synthetic-test-only",reviewerIsAnswerAuthor:false,reviewReportSha256:hash("synthetic"),backendArtifactSha256:hash("synthetic"),observedSelectionSha256:hash(canonical(runs))}},approval,catalog);
      assert.equal(observed.length,1);assert.equal(observed[0].nativeEligible,false);
      assert.equal(result.status,"FAILED_OR_UNAVAILABLE");assert.equal(result.answerSha256,null);assert.equal(run.semanticQuality,"AWAITING_INDEPENDENT_ADJUDICATION");
      const index=JSON.parse(fs.readFileSync(path.join(out,"private-body-index.json"),"utf8"));
      assert.ok(index.every((b:any)=>b.caseId===c.id&&b.repeat===1&&b.quotaTurnId||b.stage==="owner-failure-message"));
      if(mode==="rejected"){
        assert.ok(index.some((b:any)=>b.stage==="native-terminal-response"&&fs.readFileSync(b.artifact,"utf8")==="{}"));
        assert.ok(index.some((b:any)=>b.stage==="source-validated-before-preparation"));
        assert.ok(index.some((b:any)=>b.stage==="prepared-before-repeat-validation-and-semantic-review"));
        assert.ok(result.phaseEvents.some((p:any)=>p.event.phase==="claim-review"));
      }else{
        assert.ok(index.some((b:any)=>b.stage==="native-partial-sequence"&&fs.readFileSync(b.artifact,"utf8")===JSON.stringify(["exact partial fragment"])&&fs.readFileSync(b.streamArtifact,"utf8")===JSON.stringify("exact partial fragment")+"\n"));
        assert.equal(run.missingUsage,true);assert.equal(run.calls,1);
      }
      assert.ok(index.every((b:any)=>(fs.statSync(b.artifact).mode&0o777)===0o600));
      assert.equal(fs.statSync(out).mode&0o777,0o700);
    }
    const interrupted=path.join(directory,"admission-interrupted");(approval as any).observedRunPlan.campaigns[0].runDirectory=interrupted;(approval as any).observedRunPlanSha256=hash(canonical((approval as any).observedRunPlan));
    proto.fetchMe=async()=>{throw Error("Artificial interrupted authentication");};
    await assert.rejects(providerRun(auth,approval,[c],interrupted));
    const m=JSON.parse(fs.readFileSync(path.join(interrupted,"observed-run.json"),"utf8"));assert.equal(m.state,"OPEN");
    const rows=fs.readFileSync(m.journalPath,"utf8").trim().split("\n").map(line=>JSON.parse(line));assert.equal(rows.length,1);assert.equal(rows[0].event,"run-admitted");
    const runs=[{manifestPath:path.join(interrupted,"observed-run.json"),manifestSha256:hash(fs.readFileSync(path.join(interrupted,"observed-run.json"))),admissionSha256:m.admission.sha256}];
    assert.throws(()=>observedAttempts({runs,review:{independentReviewer:"synthetic-test-only",reviewerIsAnswerAuthor:false,reviewReportSha256:hash("synthetic"),backendArtifactSha256:hash("synthetic"),observedSelectionSha256:hash(canonical(runs))}},approval,catalog),/unclosed/);
  }finally{proto.fetchMe=oldMe;proto.streamChat=oldStream;if(oldToken===undefined)delete process.env.COOP_EVAL_TOKEN;else process.env.COOP_EVAL_TOKEN=oldToken;fs.rmSync(directory,{recursive:true,force:true});}
});

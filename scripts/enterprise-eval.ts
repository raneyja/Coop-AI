import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { IndexedRepoWorkspace } from "../src/workspace/IndexedRepoWorkspace";
import type { RepoInventoryDeps } from "../src/workspace/repoInventorySources";
import { repoFactNeeds } from "../src/workspace/repoFactIntent";
import { snapshotSourceClaimEvidence } from "../src/chat/sourceClaimReview";
import { streamSourceReviewedEvidence } from "../src/chat/sourceBackedActionReview";
import { sourceClaimVerdictFixture } from "../src/chat/sourceClaimReviewTestFixture";
import type { StreamChatParams, SecureApiClient } from "../src/chat/SecureApiClient";
import type { SourceClaimFact } from "../src/chat/sourceClaimReview";
import type { ReviewedSourceWindow } from "../src/prompts/sourceCitationIntegrity";
import { verifySourceCitationQuotes } from "../src/prompts/sourceCitationIntegrity";
import { enrichUnderstandRepoResponse } from "../src/prompts/repoSummaryResponseEnrichment";

/** Pin the complete local import closure plus dependency/runtime configuration.
 * Bare packages are qualified separately by the clean integrated build artifact. */
export function sourceIdentity(){
  const base=path.resolve(__dirname,".."),seen=new Set<string>(),pending=["scripts/enterprise-eval.ts"];
  while(pending.length){const file=pending.pop()!;if(seen.has(file))continue;seen.add(file);
    const text=fs.readFileSync(path.join(base,file),"utf8");
    for(const match of text.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)["'](\.[^"']+)["']/g)){
      const target=path.resolve(base,path.dirname(file),match[1]);
      const found=[target,...[".ts",".tsx",".js",".cjs",".json","/index.ts","/index.tsx","/index.js"].map(ext=>target+ext)].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
      if(!found||!found.startsWith(base+path.sep))throw Error("Local source closure cannot be pinned");
      pending.push(path.relative(base,found));
    }
  }
  for(const file of ["package.json","package-lock.json","tsconfig.json"])if(fs.existsSync(path.join(base,file)))seen.add(file);
  return [...seen].sort().map(file=>({file,sha256:hash(fs.readFileSync(path.join(base,file)))}));
}
export type Case = { id: string; family: string; split: string; caseType: string; positiveFindingRequired: boolean;
  question: string; oracle: string; identity: { owner: string; repo: string; branch: string; file: string };
  windows: ReviewedSourceWindow[]; facts: SourceClaimFact[]; languageFamily: string; evidenceAnchors: Array<{ sha256: string }> };
const root = path.resolve(__dirname,"../evals/enterprise/v1");
export const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  if (value && typeof value === "object") return "{"+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
  return JSON.stringify(value)??"null";
};
const isSha256=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const read = (file: string) => JSON.parse(fs.readFileSync(file,"utf8"));
export function loadCases(heldout?: string): Case[] {
  const freeze=read(path.join(root,"freeze.json"));
  for(const [name,key] of [["catalog.json","catalogSha256"],["development.json","developmentSha256"],["rubric.json","rubricSha256"],["historical-controls.json","historicalSha256"]]) {
    if(hash(fs.readFileSync(path.join(root,name)))!==freeze[key]) throw Error("Frozen evaluation artifact changed");
  }
  const cases: Case[]=read(path.join(root,"development.json"));
  if(heldout){if(hash(fs.readFileSync(heldout))!==freeze.heldoutSha256) throw Error("Heldout commitment mismatch");cases.push(...read(heldout));}
  const metadata=read(path.join(root,"catalog.json")).cases;
  if(new Set(cases.map(c=>c.id)).size!==cases.length) throw Error("Duplicate case ID");
  for(const c of cases){const expected=metadata.find((m:{id:string})=>m.id===c.id);
    if(!expected || hash(canonical(c))!==expected.caseSha256) throw Error("Case commitment mismatch");
    for(const w of c.windows) if(!w.content || !Number.isSafeInteger(w.startLine) || Number(w.startLine)<1) throw Error("Invalid fixture source window");
  }
  return cases;
}

/** Existing remote-workspace owner with explicit fictional remote transport.
 * This characterizes owner contracts; it does not measure remote retrieval. */
export async function fixtureWorkspace(c: Case) {
  const reads: string[]=[];const repoId=`github:${c.identity.owner}/${c.identity.repo}`;
  const inventory=c.facts.find(f=>f.kind==="inventory")?.value;
  const deps={apiBaseUrl:"https://fixture.invalid",api:{
    fetchIndexedRepoFileMap:async()=>({repoId,indexedBranch:c.identity.branch,stale:false,data:c.windows.map(w=>({path:w.path}))}),
    fetchRepoInventoryViaCloud:async()=>inventory,fetchRepoManifest:async()=>{throw Error("Unavailable fixture manifest");},
    getBackendClient:()=>({fetchRepoFile:async(_base:string,id:string,p:string,ref:string)=>{
      if(id!==repoId || ref!==c.identity.branch)throw Error("Fixture identity mismatch");reads.push(p);
      const w=c.windows.find(w=>w.path===p);if(!w)throw Error("Fixture source denied");return {path:p,content:w.content,branch:ref};}})},
    codeHostRouter:{searchRepositoryFiles:async()=>[],getFileContent:async()=>{throw Error("No unauthorized source fallback");},countRepositoryFiles:async()=>{throw Error("Fixture total unavailable");}}} as unknown as RepoInventoryDeps;
  const workspace=new IndexedRepoWorkspace(deps),target={...c.identity,repoId};
  const bodies=[];
  for(const w of c.windows){const found=await workspace.findFiles(target,path.basename(w.path),{limit:100});
    if(!found?.some(hit=>hit.path===w.path))throw Error("Fixture locate failed");
    const body=await workspace.readFile(target,w.path);if(body?.content!==w.content)throw Error("Fixture remote body changed");bodies.push(body);}
  const measured=await workspace.getInventory(target,repoFactNeeds(c.question),{allowExpensiveTreeWalk:false});
  return {reads,bodies,inventory:measured};
}
const useCases: Record<string,StreamChatParams["useCase"]>={"locate-read-facts":"comprehension",understanding:"comprehension",blast:"blast_radius",gaps:"knowledge_gaps",owner:"ownership",trace:"decision_archaeology"};
export async function runAdmitted(c: Case,stream: SecureApiClient["streamChat"],baseUrl: string,model: string,provider: StreamChatParams["provider"], onStage?: (stage: string, content: string, identity: {quotaTurnId:string})=>void, observePhase?: (phase: unknown)=>void, observedTurnId?: string, observePublication?: (content:string)=>void) {
  const published: string[]=[],phases: unknown[]=[];
  const request: StreamChatParams={message:c.question,context:c.identity,history:[],model,provider,useCase:useCases[c.family],maxTokens:16000,temperature:0.2,enableThinking:true,quotaTurnId:observedTurnId??randomUUID()};
  const result=await streamSourceReviewedEvidence({stream,request,windows:c.windows,facts:c.facts,question:c.question,baseUrl,
    prepareAnswer:content=>{
      onStage?.("source-validated-before-preparation",content,{quotaTurnId:request.quotaTurnId!});
      const prepared=enrichUnderstandRepoResponse(content,{entryFiles:c.windows});
      onStage?.("prepared-before-repeat-validation-and-semantic-review",prepared,{quotaTurnId:request.quotaTurnId!});return prepared;
    },onChunk:chunk=>{published.push(chunk);observePublication?.(chunk);},onPhase:phase=>{phases.push(phase);observePhase?.(phase);}});
  if(published.length!==1 || published[0]!==result.message.content)throw Error("Reviewed publication identity mismatch");
  return {result,phases,publicationSha256:hash(published[0])};
}
export async function deterministic() {
  const cases=loadCases();const results=[];
  for(const c of cases){await fixtureWorkspace(c);
    const first=c.windows[0];const end=Number(first.startLine)+first.content!.split("\n").length-1;
    const stream: SecureApiClient["streamChat"]=async body=>({message:{role:"assistant",timestamp:0,content:body.sourceClaimReview?sourceClaimVerdictFixture(body):`Fixture source admission only.\n\n[[source:window-1:${first.startLine}:${end}]]`},finishReason:"stop"});
    const run=await runAdmitted(c,stream,"https://fixture.invalid","fixture-model","openai");
    if(verifySourceCitationQuotes(run.result.message.content,c.windows).verifiedQuotes<1)throw Error("Exact source quote was lost");
    results.push({id:c.id,layer:"deterministic-enforcement",result:"PASS",publicationSha256:run.publicationSha256,semanticQuality:"NOT_SCORED"});
  }
  return {schema:"coop-enterprise-run-v1",layer:"deterministic-enforcement",developmentCases:cases.length,results,heldout:"NOT_EXECUTED_BY_REPAIR_AUTHORS",semanticQuality:"NOT_SCORED",providerCalls:0};
}
export function validateApproval(approval:any) {
  loadCases();
  const freeze=read(path.join(root,"freeze.json"));
  if(!approval || approval.catalogSha256!==freeze.catalogSha256 || approval.rubricSha256!==freeze.rubricSha256 || approval.heldoutSha256!==freeze.heldoutSha256 ||
    approval.verdict!=="APPROVED_ORACLES_FOR_SCORING" || !approval.independentReviewer || !isSha256(approval.reviewReportSha256) || approval.reviewerIsRepairAuthor!==false ||
    new Set(approval.caseIds??[]).size!==60 || read(path.join(root,"catalog.json")).cases.some((c:{id:string})=>!approval.caseIds.includes(c.id))) throw Error("Fresh independent oracle approval is required");
}
export function validateAuthorization(auth:any,approval:any) {
  validateApproval(approval);
  const repeats=auth?.repeats??[auth?.repeat??1],severe=auth?.severeCaseIds??[];
  if(!Array.isArray(repeats)||!repeats.length||new Set(repeats).size!==repeats.length||repeats.some((r:any)=>!Number.isSafeInteger(r)||r<1||r>3)||!Array.isArray(severe)||severe.some((id:any)=>!auth.caseIds?.includes(id))||(severe.length&&![1,2,3].every(r=>repeats.includes(r))))throw Error("Reviewed severe-repeat plan requires all three distinct repeats");
  const url=new URL(auth?.baseUrl??"https://invalid.invalid");
  if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || url.pathname!=="/" ||
    !auth.reviewedAccountAndQuota || !auth.phaseAuthorityQualified || !isSha256(auth.backendArtifactSha256) || !isSha256(auth.quotaEvidenceSha256) ||
    !auth.account?.orgId || !auth.account?.userId || (typeof auth.model!=="string"||!auth.model) || (typeof auth.provider!=="string"||!auth.provider) || (auth.repeat!==undefined && (!Number.isSafeInteger(auth.repeat)||auth.repeat<1||auth.repeat>3)) ||
    !Number.isSafeInteger(auth.maxCalls) || auth.maxCalls<1 || !Number.isSafeInteger(auth.maxCases) || auth.maxCases<1 ||
    !Number.isFinite(auth.maxUsd) || auth.maxUsd<=0 || !Number.isFinite(auth.perCallReservedUsd) || auth.perCallReservedUsd<=0 || auth.perCallReservedUsd>auth.maxUsd ||
    !Array.isArray(auth.caseIds) || !auth.caseIds.length || new Set(auth.caseIds).size!==auth.caseIds.length || auth.caseIds.length>auth.maxCases || auth.caseIds.some((id:string)=>!approval.caseIds.includes(id))) throw Error("Reviewed account/quota/phase/artifact authorization is required");
}
export function reviewedRunPlan(approval:any){
  const plan=approval?.observedRunPlan;
  if(!plan||plan.schema!=="coop-observed-plan-v3"||hash(canonical(plan))!==approval.observedRunPlanSha256||!Array.isArray(plan.campaigns)||!plan.campaigns.length||new Set(plan.campaigns.map((c:any)=>c.campaignId)).size!==plan.campaigns.length||!Array.isArray(plan.severeCaseIds))throw Error("Pre-run independently committed observed plan is required");
  const metadata=read(path.join(root,"catalog.json")).cases,keys:string[]=[];
  for(const campaign of plan.campaigns){if(typeof campaign.campaignId!=="string"||!campaign.campaignId||typeof campaign.runDirectory!=="string"||!path.isAbsolute(campaign.runDirectory)||path.normalize(campaign.runDirectory)!==campaign.runDirectory||!Array.isArray(campaign.attempts)||!campaign.attempts.length)throw Error("Reviewed campaign plan missing");for(const a of campaign.attempts){if(!metadata.some((c:any)=>c.id===a.caseId)||!Number.isSafeInteger(a.repeat)||a.repeat<1||a.repeat>3)throw Error("Unknown planned case/attempt");keys.push(`${a.caseId}:${a.repeat}`);}}
  if(new Set(plan.campaigns.map((c:any)=>c.runDirectory)).size!==plan.campaigns.length||new Set(keys).size!==keys.length||new Set(plan.severeCaseIds).size!==plan.severeCaseIds.length||plan.severeCaseIds.some((id:string)=>![1,2,3].every(repeat=>keys.includes(`${id}:${repeat}`))))throw Error("Reviewed severe-repeat universe incomplete");return plan;
}
export async function providerRun(auth:any,approval:any,cases:Case[],out: string) {
  validateAuthorization(auth,approval);
  const reviewedPlan=reviewedRunPlan(approval),reviewedCampaign=reviewedPlan.campaigns.find((c:any)=>c.campaignId===auth.campaignId);
  if(!reviewedCampaign||path.resolve(out)!==reviewedCampaign.runDirectory||canonical([...new Set(reviewedCampaign.attempts.map((a:any)=>a.caseId))].sort())!==canonical([...auth.caseIds].sort()))throw Error("Authorization differs from reviewed campaign universe");
  if(!process.env.COOP_EVAL_TOKEN)throw Error("An existing authorized test account token is required");
  if(fs.existsSync(out))throw Error("Use a new private run directory; recorded repeats must not be overwritten");
  fs.mkdirSync(out,{mode:0o700});fs.chmodSync(out,0o700);
  let calls=0,cost=0,halted=false,activeCase:Case|undefined;const callRecords:any[]=[],results:any[]=[];
  const bodyRecords:any[]=[],phaseRecords:any[]=[];
  const catalog=read(path.join(root,"catalog.json")),campaignId=auth.campaignId;
  const planned=reviewedCampaign.attempts;
  for(const plannedCase of planned){const c=cases.find(c=>c.id===plannedCase.caseId),meta=catalog.cases.find((m:any)=>m.id===plannedCase.caseId);if(!c||hash(canonical(c))!==meta?.caseSha256)throw Error("Planned case commitment differs from frozen source");}
  const admission={schema:"coop-observed-admission-v3",campaignId,catalogSha256:approval.catalogSha256,rubricSha256:approval.rubricSha256,heldoutSha256:approval.heldoutSha256,backendArtifactSha256:auth.backendArtifactSha256,clientSource:sourceIdentity(),authorizationSha256:hash(canonical(auth)),reviewedPlanSha256:approval.observedRunPlanSha256,planned,severeCaseIds:reviewedPlan.severeCaseIds};
  const admissionPath=path.join(out,"admission.json"),journalPath=path.join(out,"attempt-journal.jsonl"),manifestPath=path.join(out,"observed-run.json");
  fs.writeFileSync(admissionPath,canonical(admission),{mode:0o600});fs.writeFileSync(journalPath,"",{mode:0o600});let sequence=0,head="0".repeat(64),activeAttempt:any;
  const manifest={schema:"coop-observed-run-v3",campaignId,state:"OPEN",admission:{path:admissionPath,sha256:hash(fs.readFileSync(admissionPath))},journalPath,sequence,head};
  fs.writeFileSync(manifestPath,canonical(manifest),{mode:0o600});
  const journal=(event:string,data:unknown)=>{const payload={sequence:++sequence,previous:head,campaignId,event,data},receipt={...payload,sha256:hash(canonical(payload))};fs.appendFileSync(journalPath,canonical(receipt)+"\n");head=receipt.sha256;Object.assign(manifest,{sequence,head});fs.writeFileSync(manifestPath,canonical(manifest),{mode:0o600});};
  journal("run-admitted",admission);
  for(const name of ["private-body-index.json","private-phase-index.json","calls.json"])fs.writeFileSync(path.join(out,name),"[]",{mode:0o600});
  const {CoopBackendClient}=await import("../src/api/CoopBackendClient");
  const client=new CoopBackendClient({getToken:async()=>process.env.COOP_EVAL_TOKEN});
  const me=await client.fetchMe(auth.baseUrl);
  if(me.orgId!==auth.account.orgId || me.userId!==auth.account.userId || !me.quota)throw Error("Authenticated account/quota identity mismatch");

  const saveBody=(stage:string,content:string,identity:Record<string,unknown>)=>{
    if(!activeCase)throw Error("Missing evaluation attempt identity");
    const file=path.join(out,`${activeCase.id}-body-${bodyRecords.length+1}.txt`);
    fs.writeFileSync(file,content,{mode:0o600});
    const record={campaignId,caseId:activeCase.id,repeat:activeAttempt.repeat,attemptId:activeAttempt.attemptId,quotaTurnId:activeAttempt.quotaTurnId,stage,artifact:file,sha256:hash(content),bytes:Buffer.byteLength(content),sourceCaseSha256:hash(canonical(activeCase)),...identity};
    journal("body-retained",record);bodyRecords.push(record);fs.writeFileSync(path.join(out,"private-body-index.json"),JSON.stringify(bodyRecords,null,2),{mode:0o600});return record;
  };
  const stream: SecureApiClient["streamChat"]=async(body,chunk,base,signal)=>{
    if(halted || calls>=auth.maxCalls || cost+auth.perCallReservedUsd>auth.maxUsd){halted=true;journal("call-denied",{...activeAttempt,callId:calls+1,phase:body.sourceClaimReview?"review":body.sourceEvidenceRepair?"repair":"synthesis",reason:"reviewed-budget"});throw Error("Reviewed evaluation call/cost budget exhausted");}calls++;
    const started=Date.now(),callId=calls;let result;const partial:string[]=[];
    const identity={...activeAttempt,callId,requestSha256:hash(body.message),quotaTurnId:body.quotaTurnId,phase:body.sourceClaimReview?"review":body.sourceEvidenceRepair?"repair":"synthesis",model:body.model,provider:body.provider,maxTokens:body.maxTokens};
    if(body.quotaTurnId!==activeAttempt.quotaTurnId)throw Error("Observed turn identity changed");
    const packet=body.sourceClaimReview?JSON.parse(body.message):undefined;
    journal("call-started",{...identity,sourceCaseSha256:hash(canonical(activeCase)),reviewCandidateSha256:packet?.candidateId??null,evidenceId:packet?.evidenceId??null,reviewBlockIds:packet?.blocks?.map((b:any)=>b.id)??null});
    const streamArtifact=path.join(out,`${activeCase!.id}-call-${callId}-chunks.jsonl`);
    fs.writeFileSync(streamArtifact,"",{mode:0o600});
    const privateChunk=(delta:string)=>{partial.push(delta);fs.appendFileSync(streamArtifact,JSON.stringify(delta)+"\n");journal("native-chunk",{...identity,streamArtifact,chunkOrdinal:partial.length,deltaSha256:hash(delta)});chunk(delta);};
    const streamIdentity=()=>({...identity,streamArtifact,streamSha256:hash(fs.readFileSync(streamArtifact))});
    try{result=await client.streamChat(base,{...body,history:body.history.filter(h=>h.role==="user"||h.role==="assistant").map(h=>({role:h.role as "user"|"assistant",content:h.content}))},privateChunk,signal);}
    catch{journal("call-failed",{...identity,transportCompleted:false,usage:null});saveBody("native-partial-sequence",JSON.stringify(partial),{...streamIdentity(),transportCompleted:false});halted=true;callRecords.push({...identity,usage:null,finishReason:null,status:"FAILED_USAGE_UNKNOWN"});fs.writeFileSync(path.join(out,"calls.json"),JSON.stringify(callRecords,null,2),{mode:0o600});throw Error("Provider call failed; cost unknown, further calls prohibited");}
    saveBody("native-partial-sequence",JSON.stringify(partial),{...streamIdentity(),transportCompleted:true});
    saveBody("native-terminal-response",result.content,{...identity,finishReason:result.finishReason??null,transportCompleted:true});
    const usage=result.usage?.type==="done"?{...result.usage.usage,model:result.usage.model,provider:result.usage.provider}:undefined;
    journal("call-finished",{...identity,transportCompleted:true,finishReason:result.finishReason??null,usage:usage??null});
    callRecords.push({...identity,durationMs:Date.now()-started,finishReason:result.finishReason??null,usage:usage??null});
    fs.writeFileSync(path.join(out,"calls.json"),JSON.stringify(callRecords,null,2),{mode:0o600});
    if(!usage || !Number.isFinite(usage.estimatedCostUsd) || usage.estimatedCostUsd<0){halted=true;throw Error("Usage missing; further calls prohibited");}
    cost+=usage.estimatedCostUsd;if(usage.estimatedCostUsd>auth.perCallReservedUsd || cost>auth.maxUsd){halted=true;throw Error("Observed usage exceeds reviewed reservation; stop qualification");}
    return {message:{role:"assistant",timestamp:Date.now(),content:result.content},usage,finishReason:result.finishReason};
  };
  for(const plannedCase of planned){const {caseId:id,repeat}=plannedCase,c=cases.find(c=>c.id===id)!;activeCase=c;
    activeAttempt={campaignId,attemptId:randomUUID(),caseId:id,repeat,quotaTurnId:randomUUID()};
    const caseArtifact=path.join(out,`${id}-${repeat}-case.json`);fs.writeFileSync(caseArtifact,JSON.stringify(c),{mode:0o600});
    journal("attempt-started",{...activeAttempt,sourceCaseSha256:hash(canonical(c)),caseArtifact,caseArtifactSha256:hash(fs.readFileSync(caseArtifact))});
    let output;
    if(halted||calls>=auth.maxCalls||cost+auth.perCallReservedUsd>auth.maxUsd){output={...activeAttempt,layer:"provider-controlled-evidence",status:"NOT_EXECUTED",answerSha256:null,oracleSha256:hash(c.oracle)};}
    else try{const run=await runAdmitted(c,stream,auth.baseUrl,auth.model,auth.provider,(stage,content,identity)=>saveBody(stage,content,{...identity,callId:calls,phase:"preparation"}),phase=>{const event={...activeAttempt,callId:(phase as {event:string}).event==="start"?calls+1:phaseRecords.filter(p=>p.attemptId===activeAttempt.attemptId&&(p.event as {event:string}).event==="start").at(-1)?.callId,event:phase};journal("phase-observed",event);phaseRecords.push(event);fs.writeFileSync(path.join(out,"private-phase-index.json"),JSON.stringify(phaseRecords,null,2),{mode:0o600});},activeAttempt.quotaTurnId,content=>journal("eligible-publication",{...activeAttempt,answerSha256:hash(content)}));
      output={...activeAttempt,layer:"provider-controlled-evidence",answer:run.result.message.content,answerSha256:hash(run.result.message.content),oracleSha256:hash(c.oracle),status:"AWAITING_INDEPENDENT_ADJUDICATION"};}
    catch(error){if(error instanceof Error)saveBody("owner-failure-message",error.message,{callId:calls,phase:"failure"});output={...activeAttempt,layer:"provider-controlled-evidence",status:"FAILED_OR_UNAVAILABLE",answerSha256:null,oracleSha256:hash(c.oracle)};}
    output={...output,recordingVersion:3,attemptedBodyArtifacts:bodyRecords.filter(b=>b.attemptId===activeAttempt.attemptId),phaseEvents:phaseRecords.filter(p=>p.attemptId===activeAttempt.attemptId)};
    const outputArtifact=path.join(out,`${id}-${repeat}.json`);fs.writeFileSync(outputArtifact,canonical(output),{mode:0o600});
    const metadata={...output,answer:undefined,answerArtifact:outputArtifact};results.push(metadata);
    journal("attempt-finished",{...activeAttempt,outputArtifact,outputSha256:hash(fs.readFileSync(outputArtifact)),status:output.status});
  }
  journal("run-closed",{campaignId,plannedCount:planned.length,finishedCount:results.length,indexes:["private-body-index.json","private-phase-index.json","calls.json"].map(name=>({name,path:path.join(out,name),sha256:hash(fs.readFileSync(path.join(out,name)))}))});Object.assign(manifest,{state:"CLOSED"});fs.writeFileSync(manifestPath,canonical(manifest),{mode:0o600});
  const run={schema:"coop-enterprise-run-v3",observedManifest:{path:manifestPath,sha256:hash(fs.readFileSync(manifestPath))},layer:"provider-controlled-evidence",catalogSha256:approval.catalogSha256,rubricSha256:approval.rubricSha256,heldoutSha256:approval.heldoutSha256,backendArtifactSha256:auth.backendArtifactSha256,clientSource:sourceIdentity(),calls,costKnownUsd:cost,missingUsage:callRecords.some(c=>c.usage===null),results,semanticQuality:"AWAITING_INDEPENDENT_ADJUDICATION",remoteOrSessionOrNativePass:false};
  fs.writeFileSync(path.join(out,"run.json"),JSON.stringify(run,null,2),{mode:0o600});return run;
}
/** Opt-in actual authenticated workspace reads, never a provider/session/UI pass. */
export async function remoteRun(auth:any,approval:any,cases:Case[]) {
  validateAuthorization(auth,approval);if(!process.env.COOP_EVAL_TOKEN)throw Error("Authorized account token required");
  const {SecureApiClient}=await import("../src/chat/SecureApiClient");
  const api=new SecureApiClient({get:async key=>key==="coopAI.apiToken"?process.env.COOP_EVAL_TOKEN:undefined,store:async()=>{throw Error("Eval cannot alter saved credentials");},delete:async()=>{throw Error("Eval cannot alter saved credentials");},onDidChange:()=>({dispose(){}})});
  const me=await api.getBackendClient().fetchMe(auth.baseUrl);if(me.orgId!==auth.account.orgId||me.userId!==auth.account.userId)throw Error("Account mismatch");
  const workspace=new IndexedRepoWorkspace({api,apiBaseUrl:auth.baseUrl,codeHostRouter:{searchRepositoryFiles:async()=>[],getFileContent:async()=>{throw Error("Unqualified direct-codehost fallback");},countRepositoryFiles:async()=>{throw Error("No expensive eval tree walk");}}} as unknown as RepoInventoryDeps);
  const results=[];
  for(const id of auth.caseIds){const c=cases.find(c=>c.id===id),target=auth.remoteBindings?.[id];if(!c||!target?.repoId||!target.owner||!target.repo||!target.branch||target.branch!==target.pinnedCommit||!/^[a-f0-9]{40,64}$/.test(target.pinnedCommit??""))throw Error("Reviewed pinned remote fixture binding required");
    const source=[];for(const w of c.windows){const hits=await workspace.findFiles(target,path.basename(w.path),{limit:100});const opened=hits?.some(h=>h.path===w.path)?await workspace.readFile(target,w.path):undefined;
      source.push({path:w.path,origin:opened?.origin??null,sha256:opened?.content?hash(opened.content):null,exactFixtureBody:opened?.content===w.content});}
    const inventory=await workspace.getInventory(target,repoFactNeeds(c.question),{allowExpensiveTreeWalk:false});const expected=c.facts.find(f=>f.kind==="inventory")?.value as {fileCount?:number;lineCount?:number}|undefined;
    results.push({caseId:id,layer:"remote-workspace",source,inventory,sourceReadPass:source.every(s=>s.exactFixtureBody&&s.origin==="remote"),inventoryPass:!expected||(inventory.fileCount===expected.fileCount&&inventory.lineCount===expected.lineCount),semanticSessionNativePass:false});
  }
  return {layer:"remote-workspace",results,providerCalls:0,independentOracleScoring:"SEPARATE",sessionNativePass:false};
}
/** Verify originals selected by an independent custodian, not two reconstructed lists. */
export function observedAttempts(selection:any,approval:any,catalog:any) {
  validateApproval(approval);
  if(!selection||!Array.isArray(selection.runs)||!selection.runs.length||!selection.review?.independentReviewer||selection.review.reviewerIsAnswerAuthor!==false||!isSha256(selection.review.reviewReportSha256)||!isSha256(selection.review.backendArtifactSha256)||selection.review.observedSelectionSha256!==hash(canonical(selection.runs)))throw Error("Independently pinned observed-run selection is required");
  const reviewedPlan=reviewedRunPlan(approval);
  if(selection.runs.length!==reviewedPlan.campaigns.length)throw Error("Observed selection omits a reviewed campaign");
  const observed:any[]=[],campaigns=new Set<string>();let backend:string|undefined;
  for(const pin of selection.runs){
    if(!pin.manifestPath||hash(fs.readFileSync(pin.manifestPath))!==pin.manifestSha256)throw Error("Observed manifest missing or changed");
    const m=read(pin.manifestPath);
    if(m.schema!=="coop-observed-run-v3"||m.state!=="CLOSED"||campaigns.has(m.campaignId)||hash(fs.readFileSync(m.admission.path))!==m.admission.sha256||m.admission.sha256!==pin.admissionSha256)throw Error("Observed campaign unclosed or admission changed");campaigns.add(m.campaignId);
    const a=read(m.admission.path),plannedCampaign=reviewedPlan.campaigns.find((c:any)=>c.campaignId===m.campaignId);
    if(!plannedCampaign||path.dirname(path.resolve(pin.manifestPath))!==plannedCampaign.runDirectory||a.reviewedPlanSha256!==approval.observedRunPlanSha256||canonical(a.planned)!==canonical(plannedCampaign.attempts)||canonical(a.severeCaseIds)!==canonical(reviewedPlan.severeCaseIds))throw Error("Observed admission differs from independently frozen attempt plan");
    if(a.schema!=="coop-observed-admission-v3"||a.campaignId!==m.campaignId||a.catalogSha256!==approval.catalogSha256||a.rubricSha256!==approval.rubricSha256||a.heldoutSha256!==approval.heldoutSha256||canonical(a.clientSource)!==canonical(sourceIdentity())||!isSha256(a.authorizationSha256)||!isSha256(a.backendArtifactSha256)||a.backendArtifactSha256!==selection.review.backendArtifactSha256)throw Error("Observed source/backend/catalog binding changed");
    if(backend&&backend!==a.backendArtifactSha256)throw Error("Mixed backend candidates");backend=a.backendArtifactSha256;
    const rows=fs.readFileSync(m.journalPath,"utf8").trim().split("\n").map(line=>JSON.parse(line));let previous="0".repeat(64);
    const events=new Set(["run-admitted","attempt-started","call-started","native-chunk","body-retained","call-failed","call-finished","call-denied","phase-observed","eligible-publication","attempt-finished","run-closed"]);
    rows.forEach((row,i)=>{const {sha256,...payload}=row;if(row.sequence!==i+1||row.previous!==previous||row.campaignId!==m.campaignId||!events.has(row.event)||hash(canonical(payload))!==sha256)throw Error("Observed receipt chain changed");previous=sha256;});
    if(rows.filter(r=>r.event==="run-admitted").length!==1||rows.filter(r=>r.event==="run-closed").length!==1||rows.length!==m.sequence||previous!==m.head||rows[0]?.event!=="run-admitted"||canonical(rows[0].data)!==canonical(a)||rows.at(-1)?.event!=="run-closed")throw Error("Observed journal incomplete");
    const indexes=rows.at(-1).data.indexes;
    if(!Array.isArray(indexes)||indexes.length!==3||new Set(indexes.map((i:any)=>i.name)).size!==3||indexes.some((i:any)=>hash(fs.readFileSync(i.path))!==i.sha256))throw Error("Original run index commitments missing or changed");
    for(const [name,event] of [["private-body-index.json","body-retained"],["private-phase-index.json","phase-observed"]]){const index=indexes.find((i:any)=>i.name===name);if(!index||canonical(read(index.path))!==canonical(rows.filter(r=>r.event===event).map(r=>r.data)))throw Error("Original run index coverage changed");}
    const stats=read(indexes.find((i:any)=>i.name==="calls.json")?.path),startedCalls=rows.filter(r=>r.event==="call-started");
    if(stats.length!==startedCalls.length||stats.some((s:any,i:number)=>["callId","attemptId","campaignId","caseId","repeat","quotaTurnId","phase","model","provider","requestSha256"].some(key=>s[key]!==startedCalls[i].data[key])))throw Error("Original call metadata coverage changed");
    const planKeys=a.planned?.map((p:any)=>`${p.caseId}:${p.repeat}`);
    if(!planKeys?.length||new Set(planKeys).size!==planKeys.length||a.planned.some((p:any)=>!catalog.cases.some((c:any)=>c.id===p.caseId)||!Number.isSafeInteger(p.repeat)||p.repeat<1||p.repeat>3))throw Error("Observed plan/severe repeat commitments invalid");
    const starts=rows.filter(r=>r.event==="attempt-started"),finishes=rows.filter(r=>r.event==="attempt-finished");
    if(starts.length!==planKeys.length||finishes.length!==starts.length||rows.at(-1).data.plannedCount!==planKeys.length||rows.at(-1).data.finishedCount!==finishes.length||new Set(starts.map(r=>r.data.attemptId)).size!==starts.length||new Set(starts.map(r=>`${r.data.caseId}:${r.data.repeat}`)).size!==planKeys.length)throw Error("Observed attempt universe incomplete");
    for(const startRow of starts){
      const start=startRow.data,meta=catalog.cases.find((c:any)=>c.id===start.caseId);
      if(!planKeys.includes(`${start.caseId}:${start.repeat}`)||!start.quotaTurnId||start.campaignId!==m.campaignId||start.sourceCaseSha256!==meta?.caseSha256||hash(fs.readFileSync(start.caseArtifact))!==start.caseArtifactSha256||hash(canonical(read(start.caseArtifact)))!==meta.caseSha256)throw Error("Observed case/turn/source admission changed");
      const caseData=read(start.caseArtifact),attemptRows=rows.filter(r=>r.data.attemptId===start.attemptId);
      if(attemptRows.some(r=>r.data.caseId!==start.caseId||r.data.repeat!==start.repeat||r.data.quotaTurnId!==start.quotaTurnId||r.data.campaignId!==start.campaignId))throw Error("Observed attempt identity substitution");
      const end=attemptRows.filter(r=>r.event==="attempt-finished");if(end.length!==1)throw Error("Observed completion receipt missing");
      if(attemptRows.some(r=>r.sequence<startRow.sequence||r.sequence>end[0].sequence))throw Error("Observed attempt receipt outside its lifecycle");
      const receipt=end[0].data;if(hash(fs.readFileSync(receipt.outputArtifact))!==receipt.outputSha256)throw Error("Observed output original changed");
      const output=read(receipt.outputArtifact);
      if(output.recordingVersion!==3||output.campaignId!==m.campaignId||output.attemptId!==start.attemptId||output.caseId!==start.caseId||output.repeat!==start.repeat||output.quotaTurnId!==start.quotaTurnId||output.status!==receipt.status||!["AWAITING_INDEPENDENT_ADJUDICATION","FAILED_OR_UNAVAILABLE","NOT_EXECUTED"].includes(output.status)||output.oracleSha256!==meta.oracleSha256||output.layer!=="provider-controlled-evidence")throw Error("Observed output contract invalid");
      const bodies=attemptRows.filter(r=>r.event==="body-retained").map(r=>r.data),phases=attemptRows.filter(r=>r.event==="phase-observed").map(r=>r.data),calls=attemptRows.filter(r=>r.event==="call-started").map(r=>r.data);
      if(canonical(output.attemptedBodyArtifacts)!==canonical(bodies)||canonical(output.phaseEvents)!==canonical(phases))throw Error("Original body/phase indexes omitted or changed");
      for(const body of bodies){
        if(body.sourceCaseSha256!==meta.caseSha256||!Number.isSafeInteger(body.callId)||body.callId<1||!["synthesis","repair","review","preparation","failure"].includes(body.phase)||hash(fs.readFileSync(body.artifact))!==body.sha256||Buffer.byteLength(fs.readFileSync(body.artifact))!==body.bytes)throw Error("Native body source/call/phase artifact invalid");
        if(body.streamArtifact){if(hash(fs.readFileSync(body.streamArtifact))!==body.streamSha256)throw Error("Original streamed chunk bytes changed");const deltas=fs.readFileSync(body.streamArtifact,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));const chunks=attemptRows.filter(r=>r.event==="native-chunk"&&r.data.callId===body.callId).map(r=>r.data);if(deltas.length!==chunks.length||chunks.some((c:any,i:number)=>c.chunkOrdinal!==i+1||c.streamArtifact!==body.streamArtifact||hash(deltas[i])!==c.deltaSha256))throw Error("Original native chunk coverage changed");}
      }
      if(attemptRows.filter(r=>r.event==="native-chunk").some(r=>!calls.some(c=>c.callId===r.data.callId))||bodies.filter(b=>b.stage.startsWith("native-")).some(b=>!calls.some(c=>c.callId===b.callId)))throw Error("Unbound private native artifact");
      if(new Set(calls.map(c=>c.callId)).size!==calls.length)throw Error("Duplicated native call identity");
      for(const call of calls){
        if(!Number.isSafeInteger(call.callId)||call.callId<1||!["synthesis","repair","review"].includes(call.phase)||typeof call.model!=="string"||!call.model||typeof call.provider!=="string"||!call.provider||!Number.isSafeInteger(call.maxTokens)||call.maxTokens<1||!/^[a-f0-9]{64}$/.test(call.requestSha256)||call.sourceCaseSha256!==meta.caseSha256)throw Error("Native call identity missing");
        const ended=attemptRows.filter(r=>["call-finished","call-failed"].includes(r.event)&&r.data.callId===call.callId);if(ended.length!==1||["phase","model","provider","requestSha256","maxTokens"].some(k=>ended[0].data[k]!==call[k]))throw Error("Native call terminal receipt missing or substituted");
        const sequences=bodies.filter(b=>b.callId===call.callId&&b.stage==="native-partial-sequence");
        if(sequences.length!==1||!sequences[0].streamArtifact||!sequences[0].streamSha256||typeof sequences[0].transportCompleted!=="boolean")throw Error("Original partial stream evidence missing");
        const native=bodies.filter(b=>b.callId===call.callId&&b.stage==="native-terminal-response");
        if(ended[0].event==="call-finished"&&(ended[0].data.transportCompleted!==true||native.length!==1||native[0].transportCompleted!==true||native[0].finishReason!==ended[0].data.finishReason||native[0].phase!==call.phase||native[0].model!==call.model||native[0].provider!==call.provider||native[0].maxTokens!==call.maxTokens||native[0].requestSha256!==call.requestSha256))throw Error("Native terminal evidence contradicts original call");
        const expectedPhase=call.phase==="review"?"claim-review":call.phase,started=phases.filter(p=>p.callId===call.callId&&p.event.event==="start"),closed=phases.filter(p=>p.callId===call.callId&&["complete","failed"].includes(p.event.event));
        if(started.length!==1||closed.length!==1||[...started,...closed].some(p=>p.event.phase!==expectedPhase||p.event.model!==call.model||p.event.provider!==call.provider))throw Error("Native phase owner coverage missing");
        const callStart=attemptRows.find(r=>r.event==="call-started"&&r.data.callId===call.callId),phaseStart=attemptRows.find(r=>r.event==="phase-observed"&&r.data.callId===call.callId&&r.data.event.event==="start"),phaseEnd=attemptRows.find(r=>r.event==="phase-observed"&&r.data.callId===call.callId&&["complete","failed"].includes(r.data.event.event));
        if(!(startRow.sequence<phaseStart.sequence&&phaseStart.sequence<callStart.sequence&&callStart.sequence<ended[0].sequence&&ended[0].sequence<phaseEnd.sequence&&phaseEnd.sequence<end[0].sequence))throw Error("Native owner receipt order invalid");
      }
      if(phases.some(p=>!Number.isSafeInteger(p.callId)||p.callId<1||!calls.some(c=>c.callId===p.callId)&&!attemptRows.some(r=>r.event==="call-denied"&&r.data.callId===p.callId)))throw Error("Unbound source phase invocation");
      let eligible=false;const publication=attemptRows.filter(r=>r.event==="eligible-publication");
      if(output.status==="AWAITING_INDEPENDENT_ADJUDICATION"){
        const generation=calls.filter(c=>c.phase!=="review").at(-1),finalReviews=generation?calls.filter(c=>c.phase==="review"&&c.callId>generation.callId):[];
        const terminal=(call:any)=>{const done=attemptRows.find(r=>r.event==="call-finished"&&r.data.callId===call?.callId);return done?.data.transportCompleted===true&&done.data.finishReason==="stop"&&done.data.usage&&typeof done.data.usage.model==="string"&&done.data.usage.model&&typeof done.data.usage.provider==="string"&&done.data.usage.provider&&Number.isSafeInteger(done.data.usage.inputTokens)&&done.data.usage.inputTokens>=0&&Number.isSafeInteger(done.data.usage.outputTokens)&&done.data.usage.outputTokens>=0&&Number.isFinite(done.data.usage.estimatedCostUsd)&&done.data.usage.estimatedCostUsd>=0&&phases.some(p=>p.callId===call.callId&&p.event.event==="complete");};
        const prepared=bodies.filter(b=>b.stage==="prepared-before-repeat-validation-and-semantic-review"&&b.callId===generation?.callId),validated=bodies.filter(b=>b.stage==="source-validated-before-preparation"&&b.callId===generation?.callId);
        const publicationSequence=publication[0]?.sequence;
        if(finalReviews.some(c=>attemptRows.some(r=>r.event==="phase-observed"&&r.data.callId===c.callId&&r.sequence>=publicationSequence))||publicationSequence>=end[0].sequence)throw Error("Publication precedes final native review completion");
        const evidenceId=snapshotSourceClaimEvidence({context:caseData.identity} as StreamChatParams,caseData.windows,undefined,caseData.facts).evidenceId;
        if(!generation||!terminal(generation)||!finalReviews.length||finalReviews.some(c=>!terminal(c)||c.reviewCandidateSha256!==output.answerSha256||c.evidenceId!==evidenceId)||prepared.length!==1||validated.length!==1||publication.length!==1||publication[0].data.answerSha256!==output.answerSha256||typeof output.answer!=="string"||hash(output.answer)!==output.answerSha256||verifySourceCitationQuotes(fs.readFileSync(prepared[0].artifact,"utf8"),caseData.windows).content!==output.answer)throw Error("Published answer lacks authentic complete source/native/review evidence");eligible=true;
      }else if(publication.length||output.answerSha256!==null)throw Error("Private failed/not-executed attempt cannot claim publication");
      observed.push({...output,answer:undefined,answerArtifact:receipt.outputArtifact,nativeEligible:eligible,requiredSevereRepeats:a.severeCaseIds.includes(start.caseId)});
    }
    if(rows.some(r=>r.data.attemptId&&!starts.some(s=>s.data.attemptId===r.data.attemptId)))throw Error("Unknown extra observed attempt");
  }
  return observed;
}
export function gradeResult(c:Pick<Case,"positiveFindingRequired">,j:any):boolean {
  return j.status==="pass" && j.severeUnsupported===false && j.unauthorizedSuccess===false && j.usefulFindingPresent===true && (!c.positiveFindingRequired || j.positiveFindingPresent===true);
}
export function score(catalog:any,judgments:any[],outputs:any[],approval:any,selection?:any) {
  validateApproval(approval);if(canonical(catalog)!==canonical(read(path.join(root,"catalog.json"))))throw Error("Scoring catalog must equal the approved frozen catalog");
  const original=observedAttempts(selection,approval,catalog);
  if(outputs.length!==original.length||outputs.some(o=>!original.some(source=>canonical({...source,nativeEligible:undefined,requiredSevereRepeats:undefined})===canonical(o))))throw Error("Submitted outputs omit or alter the pinned observed universe");
  if(outputs.length!==judgments.length)throw Error("Every recorded attempt requires exactly one independent judgment");
  const attemptKey=(item:any)=>{
    if(!catalog.cases.some((c:any)=>c.id===item.caseId)||!Number.isSafeInteger(item.repeat)||item.repeat<1||item.repeat>3)throw Error("Unknown recorded case or attempt");
    return `${item.caseId}:${item.repeat}`;
  };
  const recordedKeys=outputs.map(attemptKey),judgedKeys=judgments.map(attemptKey);
  if(new Set(recordedKeys).size!==recordedKeys.length||new Set(judgedKeys).size!==judgedKeys.length||recordedKeys.some(key=>!judgedKeys.includes(key)))throw Error("Recorded/judged attempt bijection is missing or duplicated");
  const repeatOutcomes=judgments.map(j=>{
    const c=catalog.cases.find((c:any)=>c.id===j.caseId),matches=outputs.filter(o=>o.caseId===j.caseId&&o.repeat===j.repeat);
    if(!c||!Number.isSafeInteger(j.repeat)||j.repeat<1||j.repeat>3||matches.length!==1||judgments.filter(other=>other.caseId===j.caseId&&other.repeat===j.repeat).length!==1)throw Error("Repeat identity incomplete or duplicated");
    const output=original.find(o=>o.caseId===j.caseId&&o.repeat===j.repeat)!;
    if(j.answerSha256!==output.answerSha256||j.oracleSha256!==c.oracleSha256||!j.independentReviewer||j.reviewerIsAnswerAuthor!==false||!j.explanation||!Array.isArray(j.evidenceReferences)||j.evidenceReferences.length===0)throw Error("Independent repeat provenance incomplete");
    const complete=output.nativeEligible;
    return {caseId:j.caseId,repeat:j.repeat,pass:complete&&gradeResult(c,j),severeUnsupported:j.severeUnsupported===true,unauthorizedSuccess:j.unauthorizedSuccess===true};
  });
  const families: Record<string,{pass:number;total:number;positivePass:number;positiveTotal:number}>={};
  for(const c of catalog.cases){const matching=repeatOutcomes.filter(o=>o.caseId===c.id&&o.repeat===1);
    if(matching.length!==1)throw Error("Every frozen case needs one independently judged primary outcome");
    const family=families[c.family]??={pass:0,total:0,positivePass:0,positiveTotal:0};family.total++;
    if(matching[0].pass)family.pass++;if(c.positiveFindingRequired){family.positiveTotal++;if(matching[0].pass)family.positivePass++;}
  }
  const all=Object.values(families),total=all.reduce((n,f)=>n+f.total,0),pass=all.reduce((n,f)=>n+f.pass,0),positiveTotal=all.reduce((n,f)=>n+f.positiveTotal,0),positivePass=all.reduce((n,f)=>n+f.positivePass,0);
  const severe=repeatOutcomes.filter(r=>r.severeUnsupported).length,unauthorized=repeatOutcomes.filter(r=>r.unauthorizedSuccess).length;
  return {layer:"independently-adjudicated-recorded-outputs",families,total,pass,positiveTotal,positivePass,severe,unauthorized,repeatOutcomes,qualityThresholdsMet:original.filter(o=>o.requiredSevereRepeats).every(o=>repeatOutcomes.some(r=>r.caseId===o.caseId&&r.repeat===o.repeat&&r.pass)) && total===60 && severe===0 && unauthorized===0 && pass/total>=.95 && positivePass/positiveTotal>=.95 && all.every(f=>f.pass/f.total>=.9 && f.positiveTotal>0 && f.positivePass/f.positiveTotal>=.9),repeatsGate:"OPEN_UNTIL_ALL_ORIGINAL_FAILURE_COUNTERPART_REPEATS_QUALIFIED",remoteNativeSessionGate:"SEPARATE",enterpriseReady:false};
}
async function main(){const mode=process.argv[2];
 if(mode==="deterministic"){console.log(JSON.stringify(await deterministic()));return;}
 if(mode==="provider"){if(!process.argv[3]||!process.argv[4]||!process.argv[5])throw Error("Provider needs authorization, oracle approval, private output directory, and optional heldout custodian file");console.log(JSON.stringify(await providerRun(read(process.argv[3]),read(process.argv[4]),loadCases(process.argv[6]),process.argv[5])));return;}
 if(mode==="remote"){if(!process.argv[3]||!process.argv[4])throw Error("Remote needs reviewed authorization/oracle approval");console.log(JSON.stringify(await remoteRun(read(process.argv[3]),read(process.argv[4]),loadCases(process.argv[5]))));return;}
 if(mode==="score"){if(!process.argv[3])throw Error("Score needs an input manifest");const input=read(process.argv[3]);console.log(JSON.stringify(score(read(path.join(root,"catalog.json")),read(input.judgments),read(input.outputs),read(input.oracleApproval),read(input.observedRunSelection))));return;}
 throw Error("Use deterministic, provider, remote, or score; no network starts without reviewed provider authorization");
}
if(require.main===module)void main().catch(()=>{console.error("Enterprise evaluation failed closed; inspect private metadata evidence. No readiness pass.");process.exitCode=1;});

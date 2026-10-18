import {usageFixture,usageModels,type UsageFixtureProvider} from "../api/providers/providerUsageFixtures.testSupport";
import { buildChatContinuation } from "../api/chatContinuation";
import type { V1ChatRequestBody } from "../api/types";
// Fresh, suite-bound Docker admission precedes every database constructor.
const { publicationDatabaseFromEnvironment } = require('../../scripts/publication-test-fixture.mjs');
const databaseUrl: string = publicationDatabaseFromEnvironment(process.env, 'source-turns');
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Pool } from 'pg';
import { handleUsageEventsApiRequest } from './usageEventsApi';
import { handleChatApiRequest } from '../api/chatApi';
import { ModelRouter } from '../api/ModelRouter';
import { buildSourceEvidenceSynthesisRequest, buildSourceEvidenceRepairRequest } from '../chat/sourceEvidenceSynthesis';
import { buildSourceClaimReviewRequest } from '../chat/sourceClaimReview';
import type { StreamChatParams } from '../chat/SecureApiClient';
import { OrgStore } from './orgStore';
import { UserStore } from './users/userStore';
import { SourceTurnAuthority, sourceTurnActorBinding } from './sourceTurnAuthority';
import { UsageTracker } from './usageTracker';
import { createPlanQuotaService } from './planQuota';

test('source phase authority through actual HTTP and Postgres', {timeout: 30000}, async t => {
  const pool = new Pool({connectionString: databaseUrl, max: 4});
  const orgs = new OrgStore(pool, randomBytes(32).toString('hex')), users = new UserStore(pool);
  const tracker = new UsageTracker(pool), quota = createPlanQuotaService(tracker), authority = new SourceTurnAuthority(pool);
  let modelCalls = 0, hold = false, sawAbort = false, failComplete = false;
  let nativeReason: "stop" | "length" | "error" = "stop";
  let emittedAnswer='Synthetic admission probe';
  let tokenUsage = {inputTokens: 10, outputTokens: 2};
  const router = {stream: async function* (request: {modelConfig: {model: string; provider: string};ordinaryPlan?:boolean;onProviderDispatch?:()=>Promise<void>}, signal: AbortSignal) {
    if (failComplete) throw Error("Synthetic before-dispatch failure");
    await request.onProviderDispatch?.();
    modelCalls++;
    yield {type: 'delta', text: request.ordinaryPlan ? '{"done":true}' : emittedAnswer};
    if (hold) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1500);
      signal.addEventListener('abort', () => {sawAbort = true; clearTimeout(timer); resolve();}, {once: true});
    });
    yield {type: 'done', provider: request.modelConfig.provider, model: request.modelConfig.model,
      finishReason: signal.aborted ? 'cancelled' : nativeReason, usage: {provenance: "provider-final", ...tokenUsage, estimatedCostUsd: 0}};
  }} as unknown as ModelRouter;
  let activeRouter=router;
  const server = createServer(async (req, res) => {
    try {
      let text = ''; for await (const value of req) {text += value; if (text.length > 2000000) throw Error('Test body limit');}
      const body=JSON.parse(text), headers={authorization:req.headers.authorization};
      if(req.url==='/v1/usage/events') {await handleUsageEventsApiRequest({method:'POST',pathname:req.url,headers,body},res,
        {orgStore:orgs,userStore:users,usageTracker:tracker,planQuota:quota,sourceTurnAuthority:authority,serverConfig:{nodeEnv:'test',requireApiAuth:true,jobsWorkersEnabled:false,devMode:false}});return;}
      await handleChatApiRequest({method: req.method ?? '', pathname: req.url ?? '', headers: {authorization: req.headers.authorization}, body}, res,
        {router:activeRouter, orgStore: orgs, userStore: users, usageTracker: tracker, planQuota: quota, sourceTurnAuthority: {admit: authority.admit.bind(authority), settle: authority.settle.bind(authority), markDispatched: authority.markDispatched.bind(authority), close: authority.close.bind(authority),
            complete: async (...args) => {if (failComplete) throw Error("Synthetic completion store failure"); await authority.complete(...args);}},
          config: {defaultProvider: 'openai', mockMode: false, allowUnapprovedProvider: false, apiKeys: {}},
          serverConfig: {nodeEnv: 'test', requireApiAuth: true, jobsWorkersEnabled: false, devMode: false}}, req);
    } catch {if (!res.headersSent) res.writeHead(500); res.end();}
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const org = await orgs.createOrganization('synthetic source authority', 'enterprise');
  const user = await users.createUser(org.id, `authority-${randomUUID()}@fixture.invalid`, 'admin');
  const token = (await users.createSession(user.id, org.id, {ttlMs: 600000, authProvider: 'password'})).token;
  const otherToken = (await users.createSession(user.id, org.id, {ttlMs: 600000, authProvider: 'password'})).token;
  const windows = [{path: 'fixture.ts', startLine: 1, content: 'if (enabled) {\n  reject();\n}'}];
  const request: StreamChatParams = {message: 'Explain the shown condition.', context: {owner: 'fixture', repo: 'sample', branch: 'frozen'},
    history: [], useCase: 'comprehension', model: 'claude-sonnet-4-6', provider: 'anthropic', temperature: .5, maxTokens: 16000};
  const initial = () => buildSourceEvidenceSynthesisRequest({...request, quotaTurnId: randomUUID()}, request.message, windows);
  const review = (body: StreamChatParams) => buildSourceClaimReviewRequest({...request, quotaTurnId: body.quotaTurnId}, 'The call is guarded by enabled.', windows, request.message);
  const post = async (body: unknown, session = token, endpoint = '/v1/chat') => {
    const response = await fetch(base + endpoint, {method: 'POST', headers: {authorization: `Bearer ${session}`, 'content-type': 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(6000)});
    return {status: response.status, text: await response.text()};
  };
  try {
    await t.test('flags alone and malformed envelopes never reach the model', async () => {
      for (const flags of [{sourceClaimReview: true}, {sourceEvidenceSynthesis: true, sourceEvidenceRepair: true}, {sourceEvidenceSynthesis: true}])
        assert.equal((await post({...request, ...flags, quotaTurnId: randomUUID()})).status, 409);
      assert.equal(modelCalls, 0);
    });
    const turn = initial();
    await t.test('accepted generation and review share a server-owned billing turn', async () => {
      assert.equal((await post(turn)).status, 200); assert.equal((await post(review(turn))).status, 200);
      const row = (await pool.query('SELECT * FROM chat_source_turns WHERE client_turn_id=$1', [turn.quotaTurnId])).rows[0];
      assert.notEqual(row.id, turn.quotaTurnId); assert.equal(row.state, 'ready');
      const calls = (await pool.query("SELECT metadata FROM usage_events WHERE org_id=$1 AND metadata->>'quotaTurnId'=$2 AND metadata ? 'billingCallId'", [org.id, row.id])).rows;
      assert.equal(calls.length, 2); assert.equal(new Set(calls.map(x => x.metadata.billingCallId)).size, 2);
      assert(calls.some(x => x.metadata.sourceClaimReview === true && x.metadata.model === 'gpt-5.5'));
    });
    await t.test('session, ref, task and changed bytes cannot borrow accepted authority', async () => {
      const count = modelCalls;
      assert.equal((await post(review(turn), otherToken)).status, 409);
      const ref = review(turn); ref.context.branch = 'wrong'; assert.equal((await post(ref)).status, 409);
      for (const mutate of [(data: Record<string, unknown>) => {data.question = 'another task';},
        (data: Record<string, unknown>) => {(data.windows as Array<{lines: Array<{text: string}>}>)[0].lines[0].text = 'if (false) {';}]) {
        const body = review(turn), data = JSON.parse(body.message); mutate(data); body.message = JSON.stringify(data);
        assert.equal((await post(body)).status, 409);
      }
      assert.equal(modelCalls, count);
    });
    await t.test('sixteen-unit review batches are accepted and seventeen are rejected before model processing', async () => {
      const body = review(turn), data = JSON.parse(body.message); data.blocks = Array.from({length: 16}, (_, i) => ({...data.blocks[0], id: `block-${i}`}));
      body.message = JSON.stringify(data); assert.equal((await post(body)).status, 200);
      const count = modelCalls; data.blocks.push({...data.blocks[0], id: 'block-16'});
      body.message = JSON.stringify(data); assert.equal((await post(body)).status, 409); assert.equal(modelCalls, count);
    });
    await t.test('one repair only; terminal close and replay cannot reopen the turn', async () => {
      const repair = buildSourceEvidenceRepairRequest(turn, turn.message + '\n\nReplace invalid answer.');
      assert.equal((await post(repair)).status, 200); assert.equal((await post(repair)).status, 409);
      assert.equal((await post({quotaTurnId: turn.quotaTurnId}, token, '/v1/chat/source-turn/close')).status, 200);
      assert.equal((await post(review(turn))).status, 409); assert.equal((await post(turn)).status, 409);
    });
    await t.test('database expiry, review cap, and in-flight exclusion are enforced', async () => {
      for (const set of ["expires_at=clock_timestamp()-interval '1 second'", 'review_calls=64']) {
        const body = initial(); assert.equal((await post(body)).status, 200);
        await pool.query(`UPDATE chat_source_turns SET ${set} WHERE client_turn_id=$1`, [body.quotaTurnId]);
        assert.equal((await post(review(body))).status, 409);
      }
      const body = initial(); assert.equal((await post(body)).status, 200);
      const input = {orgId: org.id, actorBinding: sourceTurnActorBinding(org.id, `user:${user.id}`, `Bearer ${token}`), body: {...review(body), history: []}, quota, check: async () => {}};
      const admitted = await authority.admit(input); await assert.rejects(new SourceTurnAuthority(pool).admit(input));
      assert.equal((await post(review(body))).status, 409); await authority.complete(admitted, false);
    });
    await t.test('private envelopes reject extra history, media, legacy context and unbound fields before model access', async () => {
      const count = modelCalls;
      for (const extra of [{history:[{role:'user',content:'unbound'}]}, {attachments:[{arbitrary:true}]},
        {context:{...request.context,contextBundle:{unbound:true}}}]) assert.equal((await post({...initial(),...extra})).status,400);
      const body = initial(), data = JSON.parse(body.message); data.unbound = 'extra instruction'; body.message = JSON.stringify(data);
      assert.equal((await post(body)).status,409); assert.equal(modelCalls,count);
    });
    const ordinary = (id: string, phase: 'plan'|'answer'|'continue',round=0) => ({...request,context:{...request.context},message:phase==='plan'?JSON.stringify({message:'one original human question',repoId:'github:fixture/sample',round,priorSummaries:[]}):phase==='continue'?'Continue the answer from where you stopped. Fill every heading you already opened. Do not repeat completed sections. Do not start new empty headings.':'synthetic model input',useCase:'chat',quotaTurnId:id,
      ordinaryTurn:{phase,task:'one original human question',answerUseCase:'chat'}});
    await t.test('bounded ordinary workflow admits eight private plans, one answer and one continuation', async () => {
      const id = randomUUID();
      for(let i=0;i<8;i++) assert.equal((await post(ordinary(id,'plan',i))).status,200);
      assert.equal((await post(ordinary(id,'plan'))).status,409);
      const other = ordinary(id,'answer'); other.ordinaryTurn.task='changed task'; assert.equal((await post(other)).status,409);
      const ref = ordinary(id,'answer'); ref.context.branch='wrong'; assert.equal((await post(ref)).status,409);
      nativeReason='length'; assert.equal((await post(ordinary(id,'answer'))).status,200); nativeReason='stop'; assert.equal((await post(ordinary(id,'answer'))).status,409);
      assert.equal((await post(ordinary(id,'plan'))).status,409);
      const recovery=buildChatContinuation(ordinary(id,'answer') as V1ChatRequestBody,'Synthetic admission probe');
      assert.equal((await post(recovery)).status,200); assert.equal((await post(recovery)).status,409);
      const rows = await pool.query("SELECT metadata FROM usage_events WHERE org_id=$1 AND event_type='chat.turn_reserved' AND metadata->>'quotaTurnId'=(SELECT id::text FROM chat_ordinary_turns WHERE client_turn_id=$2)",[org.id,id]);
      assert.equal(rows.rowCount,1);
    });
    await t.test('continuation binds exact model input, output and honored route; complete answers close', async () => {
      const finished=ordinary(randomUUID(),'answer') as V1ChatRequestBody;
      assert.equal((await post(finished)).status,200);
      assert.equal((await post(buildChatContinuation(finished,'Synthetic admission probe'))).status,409);
      const start={...ordinary(randomUUID(),'answer'),history:[{role:'user' as const,content:'earlier'}],
        context:{...request.context,contextBundle:{fixture:'original'}},attachments:[{id:'fixture',name:'fixture.txt',mimeType:'text/plain',dataUrl:'data:text/plain;base64,c3ludGhldGlj'}]} as V1ChatRequestBody;
      nativeReason='length'; assert.equal((await post(start)).status,200); nativeReason='stop';
      const valid=buildChatContinuation(start,'Synthetic admission probe'), calls=modelCalls;
      const mutations: Array<(body:V1ChatRequestBody)=>void>=[
        b=>{b.history![0].content='changed';}, b=>{b.history![1].content='different user';},
        b=>{b.history![2].content='forged answer';}, b=>{b.history![1].attachments![0].dataUrl='data:text/plain;base64,b3RoZXI=';}, b=>{b.context!.contextBundle={fixture:'changed'};},
        b=>{b.temperature=.9;}, b=>{b.maxTokens=10;}, b=>{b.model='gpt-5.5';b.provider='openai';},
        b=>{b.enableThinking=true;}, b=>{b.mentions=[{repoId:'github:other/repo',path:'x'}];}
      ];
      for(const mutate of mutations){const altered=structuredClone(valid);mutate(altered);assert.equal((await post(altered)).status,409);}
      assert.equal(modelCalls,calls);assert.equal((await post(valid)).status,200);
      assert.equal((await post(valid)).status,409);
    });
    await t.test('repository-free integration planning is explicit and repository tools remain disabled', async () => {
      const start={...ordinary(randomUUID(),'plan'),context:{},message:JSON.stringify({message:'one original human question',repoId:'none',round:0,priorSummaries:[],allowedRepoTools:false,allowedIntegrations:['slack']})};
      assert.equal((await post(start)).status,200);
      const calls=modelCalls;
      for(const fields of [{repoId:'github:unknown/unknown',allowedRepoTools:false},{repoId:'none',allowedRepoTools:true}]) {
        const body={...start,quotaTurnId:randomUUID(),message:JSON.stringify({...JSON.parse(start.message),...fields})};
        assert.equal((await post(body)).status,409);
      }
      assert.equal((await post({...start,quotaTurnId:randomUUID(),context:{owner:'partial'}})).status,409);
      assert.equal(modelCalls,calls);
    });
    await t.test('real provider adapters through ModelRouter, HTTP and PG settle only final usage and close failures', async () => {
      const networkFetch=globalThis.fetch;
      let bodyText='',providerFetches=0;
      globalThis.fetch=(async (url,init)=>{
        if(String(url).startsWith(base))return networkFetch(url,init);
        assert(['https://api.openai.com/','https://api.anthropic.com/','https://generativelanguage.googleapis.com/'].some(prefix=>String(url).startsWith(prefix)));
        providerFetches++;return new Response(bodyText);
      }) as typeof fetch;
      activeRouter=new ModelRouter({config:{mockMode:false,defaultProvider:'openai',allowUnapprovedProvider:false,
        apiKeys:{openai:'synthetic-only',anthropic:'synthetic-only',gemini:'synthetic-only'}}});
      try {
        for(const provider of Object.keys(usageModels) as UsageFixtureProvider[])for(const disposition of ['zero','partial','error'] as const){
          const body={...ordinary(randomUUID(),'answer'),provider,model:usageModels[provider]} as V1ChatRequestBody;
          bodyText=usageFixture(provider,disposition==='zero'?0:12,disposition==='zero'?0:6,{partial:disposition==='partial',errorAfter:disposition==='error'});
          const before=providerFetches,response=await post(body);assert.equal(response.status,200);assert.equal(providerFetches,before+1);
          const row=(await pool.query('SELECT id,state FROM chat_ordinary_turns WHERE client_turn_id=$1',[body.quotaTurnId])).rows[0];assert.equal(row.state,'closed');
          const billed=await pool.query("SELECT metadata FROM usage_events WHERE org_id=$1 AND event_type='chat.message' AND metadata->>'quotaTurnId'=$2",[org.id,row.id]);
          assert.equal(billed.rowCount,disposition==='partial'?0:1);
          assert.equal(response.text.includes('"type":"done"'),disposition==='zero',response.text);
          assert.equal(response.text.includes('"type":"error"'),disposition!=='zero',response.text);
          if(disposition==='zero'){assert.equal(billed.rows[0].metadata.inputTokens,0);assert.equal(billed.rows[0].metadata.outputTokens,0);}
        }
      } finally {globalThis.fetch=networkFetch;activeRouter=router;}
    });
    await t.test('native trailing-heading recovery is single-use, expiry and concurrent contenders stay fenced',async()=>{
      const body=ordinary(randomUUID(),'answer') as V1ChatRequestBody;emittedAnswer='Supported text\n**Remaining**';
      try{assert.equal((await post(body)).status,200);}finally{emittedAnswer='Synthetic admission probe';}
      const recovery=buildChatContinuation(body,'Supported text\n**Remaining**');
      const responses=await Promise.all([post(recovery),post(recovery)]);assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);
      const expired=ordinary(randomUUID(),'answer') as V1ChatRequestBody;
      nativeReason='length';try{assert.equal((await post(expired)).status,200);}finally{nativeReason='stop';}
      await pool.query("UPDATE chat_ordinary_turns SET expires_at=clock_timestamp()-interval '1 second' WHERE client_turn_id=$1",[expired.quotaTurnId]);
      assert.equal((await post(buildChatContinuation(expired,'Synthetic admission probe'))).status,409);
    });
    await t.test('done(error) with final usage charges once and never reopens source review',async()=>{
      const body=initial();nativeReason='error';let response;
      try{response=await post(body);}finally{nativeReason='stop';}
      assert(response.text.includes('"type":"error"'));assert(!response.text.includes('"type":"done"'));
      const row=(await pool.query('SELECT id,state FROM chat_source_turns WHERE client_turn_id=$1',[body.quotaTurnId])).rows[0];assert.equal(row.state,'closed');
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM usage_events WHERE org_id=$1 AND event_type='chat.message' AND metadata->>'quotaTurnId'=$2",[org.id,row.id])).rows[0].n,1);
      assert.equal((await post(review(body))).status,409);
    });
    await t.test('ordinary close wins a late completion and expiry cannot recreate authority', async () => {
      const id = randomUUID(), body = ordinary(id,'answer');
      const admitted = await authority.admit({orgId:org.id,actorBinding:sourceTurnActorBinding(org.id,`user:${user.id}`,`Bearer ${token}`),body:body as import('../api/types').V1ChatRequestBody,quota,check:async()=>{}});
      await authority.close(org.id,sourceTurnActorBinding(org.id,`user:${user.id}`,`Bearer ${token}`),id);
      await authority.complete(admitted,true); assert.equal((await post(ordinary(id,'continue'))).status,409);
      const next=randomUUID(); assert.equal((await post(ordinary(next,'plan'))).status,200);
      await pool.query("UPDATE chat_ordinary_turns SET expires_at=clock_timestamp()-interval '1 second' WHERE client_turn_id=$1",[next]);
      assert.equal((await post(ordinary(next,'answer'))).status,409);
    });
    await t.test('a completion-store failure terminates the SSE connection', async () => {
      failComplete=true;
      try {const response=await post(initial()); assert.equal(response.status,200); assert(response.text.includes('"type":"error"'));}
      finally {failComplete=false;}
    });
    await t.test('late source completion and settlement cannot reopen a different in-flight call',async()=>{
      const body=initial(),binding=sourceTurnActorBinding(org.id,`user:${user.id}`,`Bearer ${token}`);
      const input={orgId:org.id,actorBinding:binding,body:body as import('../api/types').V1ChatRequestBody,quota,check:async()=>{}};
      const first=await authority.admit(input);await authority.settle(first,quota,true,async()=>{});
      const second=await authority.admit({...input,body:review(body) as import('../api/types').V1ChatRequestBody});
      await authority.complete(first,true);await authority.settle(first,quota,true,async()=>{});
      assert.equal((await pool.query('SELECT state FROM chat_source_turns WHERE id=$1',[first.id])).rows[0].state,'busy');
      await assert.rejects(authority.admit({...input,body:review(body) as import('../api/types').V1ChatRequestBody}));
      await authority.complete(second,false);
    });
    await t.test('telemetry cannot create billing events, reservations or signed quota credit',async()=>{
      const before=(await pool.query('SELECT count(*)::int AS n FROM usage_events WHERE org_id=$1',[org.id])).rows[0].n;
      for(const eventType of ['chat.message','chat.turn_reserved','quota.credit'])
        assert.equal((await post({eventType,metadata:{bucket:'auto',usdCents:-100000}},token,'/v1/usage/events')).status,400);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM usage_events WHERE org_id=$1',[org.id])).rows[0].n,before);
    });
    await t.test('planning labels cannot carry ordinary questions, altered task or interpretation requests',async()=>{
      const before=modelCalls,id=randomUUID();
      const body=ordinary(id,'plan');body.message='An unrelated ordinary question';assert.equal((await post(body)).status,409);
      const other=ordinary(id,'plan'),data=JSON.parse(other.message);data.message='different task';other.message=JSON.stringify(data);assert.equal((await post(other)).status,409);
      const round=ordinary(id,'plan',7);assert.equal((await post(round)).status,409);
      assert.equal((await post({...ordinary(id,'answer'),ordinaryTurn:{phase:'interpret',task:'one original human question',answerUseCase:'chat'}})).status,409);
      assert.equal(modelCalls,before);
      const plan=await post(ordinary(id,'plan'));assert.equal(plan.status,200);assert.deepEqual(JSON.parse(plan.text.split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))).filter(x=>x.type==='delta').map(x=>x.text).join('')),{done:true});
      const intent={...ordinary(randomUUID(),'answer'),useCase:'intent_job',ordinaryTurn:{phase:'answer',task:'one task',answerUseCase:'intent_job'}};
      assert.equal((await post(intent)).status,200);
    });
    const free = await orgs.createOrganization('synthetic last Free message', 'free');
    const freeUser = await users.createUser(free.id, `free-${randomUUID()}@fixture.invalid`, 'admin');
    const freeToken = (await users.createSession(freeUser.id, free.id, {ttlMs: 600000, authProvider: 'password'})).token;
    const seed = async () => {for (let i = 0; i < 14; i++) await pool.query("INSERT INTO usage_events(org_id,principal,event_type,metadata) VALUES($1,'fixture','chat.message',$2::jsonb)",
      [free.id, JSON.stringify({model: 'gemini-2.5-flash', countsAsMessage: true, quotaTurnId: randomUUID(), flashCostUsd: 0})]);};
    await t.test('last Free generation permits its own review but denies new sends and forged continuation', async () => {
      await seed(); const body = initial(); assert.equal((await post(body, freeToken)).status, 200);
      assert.equal((await post(review(body), freeToken)).status, 200);
      assert.equal((await post(initial(), freeToken)).status, 429);
      assert.equal((await post({...request, quotaTurnId: body.quotaTurnId}, freeToken)).status, 429);
      assert.equal((await post({...review(body), quotaTurnId: randomUUID()}, freeToken)).status, 409);
    });
    await t.test('the final Free message can plan and answer once, while a different send remains blocked', async () => {
      await pool.query('DELETE FROM usage_events WHERE org_id=$1',[free.id]); await seed();
      const id=randomUUID(); assert.equal((await post(ordinary(id,'plan'),freeToken)).status,200);
      nativeReason='length'; assert.equal((await post(ordinary(id,'answer'),freeToken)).status,200); nativeReason='stop';
      assert.equal((await post(buildChatContinuation(ordinary(id,'answer') as V1ChatRequestBody,'Synthetic admission probe'),freeToken)).status,200);
      assert.equal((await post(ordinary(randomUUID(),'answer'),freeToken)).status,429);
    });
    await t.test('real Gemini partial usage leaves a capped call unresolved until one final reconciliation',async()=>{
      await pool.query('DELETE FROM usage_events WHERE org_id=$1',[free.id]);
      const networkFetch=globalThis.fetch;let providerFetches=0;
      globalThis.fetch=(async(url,init)=>{if(String(url).startsWith(base))return networkFetch(url,init);assert(String(url).startsWith('https://generativelanguage.googleapis.com/'));providerFetches++;return new Response(usageFixture('gemini',12,6,{partial:true}));}) as typeof fetch;
      activeRouter=new ModelRouter({config:{defaultProvider:'gemini',mockMode:false,allowUnapprovedProvider:false,apiKeys:{gemini:'synthetic-only'}}});
      const body=ordinary(randomUUID(),'answer');
      try{
        const result=await post(body,freeToken);assert.equal(result.status,200);assert(result.text.includes('"type":"error"'));assert(!result.text.includes('"type":"done"'));
        const row=(await pool.query("SELECT id,state FROM chat_cost_admissions WHERE org_id=$1 AND state='unresolved'",[free.id])).rows[0];assert(row);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM usage_events WHERE org_id=$1 AND event_type='chat.message'",[free.id])).rows[0].n,0);
        assert.equal((await post(ordinary(randomUUID(),'answer'),freeToken)).status,503);assert.equal(providerFetches,1);
        const evidence={inputTokens:12,outputTokens:6,receiptReference:'synthetic-Gemini-final-receipt',receiptSha256:'b'.repeat(64)};
        await authority.reconcileUsage(free.id,row.id,quota,evidence);await authority.reconcileUsage(free.id,row.id,quota,evidence);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM usage_events WHERE org_id=$1 AND metadata->>'billingCallId'=$2",[free.id,row.id])).rows[0].n,1);
      }finally{globalThis.fetch=networkFetch;activeRouter=router;}
    });
    await t.test('capped subjects cannot dispatch parallel unsettled calls; known usage settles atomically', async () => {
      await pool.query('DELETE FROM usage_events WHERE org_id=$1',[free.id]);
      const first=initial(), binding=sourceTurnActorBinding(free.id,`user:${freeUser.id}`,`Bearer ${freeToken}`);
      const input={orgId:free.id,actorBinding:binding,body:first as import('../api/types').V1ChatRequestBody,quota,billingContext:{plan:'free' as const,entry:{eventType:'chat.message' as const,provider:'gemini' as const,model:'gemini-2.5-flash',principal:'fixture',countsAsMessage:false}},billingSubject:quota.cappedSubject(free.id,'free'),check:async()=>{}};
      const admitted=await authority.admit(input);
      const stop=AbortSignal.timeout(80); await assert.rejects(authority.admit({...input,signal:stop,body:initial() as import('../api/types').V1ChatRequestBody}),/abort|timeout/i);
      await assert.rejects(authority.recordImmediate(free.id,'free-org',quota,async()=>{}),/metering/);
      await authority.settle(admitted,quota,true,async q=>q.recordTokens(free.id,'free',{eventType:'chat.message',inputTokens:10,outputTokens:2,provider:'gemini',model:'gemini-2.5-flash',principal:'fixture',quotaTurnId:admitted.id,metadata:{billingCallId:admitted.callId}}));
      assert.equal((await pool.query('SELECT state FROM chat_cost_admissions WHERE id=$1',[admitted.callId])).rows[0].state,'settled');
      const next=await authority.admit({...input,body:initial() as import('../api/types').V1ChatRequestBody});
      await authority.markDispatched(next); await authority.complete(next,false); await authority.close(free.id,binding,first.quotaTurnId!);
      assert.equal((await pool.query('SELECT state FROM chat_cost_admissions WHERE id=$1',[next.callId])).rows[0].state,'unresolved');
      await assert.rejects(authority.admit({...input,body:initial() as import('../api/types').V1ChatRequestBody}),/metering/);
      const evidence={inputTokens:3,outputTokens:2,receiptReference:'synthetic-provider-final-receipt',receiptSha256:'a'.repeat(64)};
      await authority.reconcileUsage(free.id,next.callId!,quota,evidence);
      await authority.reconcileUsage(free.id,next.callId!,quota,evidence);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM usage_events WHERE org_id=$1 AND metadata->>'billingCallId'=$2",[free.id,next.callId])).rows[0].n,1);
    });
    await t.test('paid seats share buckets, serialize unsettled spend and recheck the actual near-cap balance', async () => {
      const paid=await orgs.createOrganization('synthetic paid cap','pro');
      const seat=await users.createUser(paid.id,`paid-${randomUUID()}@fixture.invalid`,'admin');
      const other=await users.createUser(paid.id,`paid-${randomUUID()}@fixture.invalid`,'member');
      const seatToken=(await users.createSession(seat.id,paid.id,{ttlMs:600000,authProvider:'password'})).token;
      const otherSeatToken=(await users.createSession(other.id,paid.id,{ttlMs:600000,authProvider:'password'})).token;
      await pool.query("INSERT INTO usage_events(org_id,user_id,principal,event_type,metadata) VALUES($1,$2,'fixture','chat.message',$3::jsonb)",[paid.id,seat.id,JSON.stringify({bucket:'frontier',usdCents:1499})]);
      hold=true; tokenUsage={inputTokens:100000,outputTokens:1000};
      try {
        const running=post(ordinary(randomUUID(),'answer'),seatToken);
        for(let i=0;i<100;i++) {if((await pool.query("SELECT id FROM chat_cost_admissions WHERE org_id=$1 AND state='pending'",[paid.id])).rowCount) break; await new Promise(r=>setTimeout(r,5));}
        const contender=post(ordinary(randomUUID(),'answer'),seatToken);
        assert.equal((await post(ordinary(randomUUID(),'answer'),otherSeatToken)).status,200);
        assert.equal((await running).status,200); assert.equal((await contender).status,429);
        assert.equal((await post(ordinary(randomUUID(),'answer'),seatToken)).status,429);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM chat_cost_admissions WHERE org_id=$1 AND state<>'settled'",[paid.id])).rows[0].n,0);
      } finally {hold=false;tokenUsage={inputTokens:10,outputTokens:2};}
    });
    await t.test('actual router missing-key failure proves zero dispatch and releases its monetary admission',async()=>{
      await pool.query('DELETE FROM usage_events WHERE org_id=$1',[free.id]);
      activeRouter=new ModelRouter({config:{defaultProvider:'openai',mockMode:false,allowUnapprovedProvider:false,apiKeys:{openai:'synthetic-key-never-dispatched'}}});
      try {const result=await post(initial(),freeToken);assert.equal(result.status,200);assert(result.text.includes('No API key configured'));
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM chat_cost_admissions WHERE org_id=$1 AND state<>'settled'",[free.id])).rows[0].n,0);
      }finally{activeRouter=router;}
      assert.equal((await post(initial(),freeToken)).status,200);
    });
    await t.test('fresh sub-millisecond committed cost cannot escape a continuation cap', async () => {
      await pool.query('DELETE FROM usage_events WHERE org_id=$1', [free.id]); const body = initial();
      assert.equal((await post(body, freeToken)).status, 200);
      for (let i = 0; i < 10; i++) {
        await pool.query("DELETE FROM usage_events WHERE org_id=$1 AND principal='clock-probe'", [free.id]);
        await pool.query("INSERT INTO usage_events(org_id,principal,event_type,metadata) VALUES($1,'clock-probe','chat.message',$2::jsonb)",
          [free.id, JSON.stringify({model: 'gpt-5.5', sourceClaimReview: true, sourceReviewCostUsd: 2, countsAsMessage: false})]);
        assert.equal((await post(review(body), freeToken)).status, 429);
      }
    });
    await t.test('three concurrent contenders reserve the final Free allowance once', async () => {
      await pool.query('DELETE FROM usage_events WHERE org_id=$1', [free.id]); await seed();
      const results = await Promise.all([initial(), initial(), initial()].map(body => post(body, freeToken)));
      assert.deepEqual(results.map(x => x.status).sort(), [200, 429, 429]);
    });
    await t.test('disconnected HTTP client aborts provider work and closes authority', async () => {
      hold = true; const body = initial(), abort = new AbortController();
      const response = await fetch(base + '/v1/chat', {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(body), signal: abort.signal});
      await response.body!.getReader().read(); abort.abort();
      for (let i = 0; i < 200; i++) {
        const state = (await pool.query('SELECT state FROM chat_source_turns WHERE client_turn_id=$1', [body.quotaTurnId])).rows[0]?.state;
        if (state === 'closed' && sawAbort) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert(sawAbort); assert.equal((await post(review(body))).status, 409); hold = false;
    });
    await t.test('metering write failure withholds done and closes authority', async () => {
      const body = initial(); assert.equal((await post(body)).status, 200);
      await pool.query(`CREATE FUNCTION fixture_fail_source_meter() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.org_id='${org.id}'::uuid AND NEW.event_type='chat.message' AND NEW.metadata->>'sourceClaimReview'='true'
        THEN RAISE EXCEPTION 'Synthetic metering failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fixture_source_meter BEFORE INSERT ON usage_events FOR EACH ROW EXECUTE FUNCTION fixture_fail_source_meter()`);
      try {const response = await post(review(body)); assert(response.text.includes('"type":"error"')); assert(!response.text.includes('"type":"done"'));}
      finally {await pool.query('DROP TRIGGER fixture_source_meter ON usage_events; DROP FUNCTION fixture_fail_source_meter()');}
      assert.equal((await post(review(body))).status, 409);
    });
  } finally {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pool.end();}
});

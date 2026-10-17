import assert from 'node:assert/strict';
import test from 'node:test';
import {CoopChatSession} from './CoopChatSession';
import type {SecureApiClient,StreamChatParams} from './SecureApiClient';

test('planner uses the explicit owner signal and identity instead of a cancelled different turn',async()=>{
 const previous=new AbortController();previous.abort();const ownerAbort=new AbortController();
 const sent:Array<{body:StreamChatParams;signal?:AbortSignal}>=[];
 const streamChat:SecureApiClient['streamChat']=async(body,onChunk,_base,signal)=>{
  sent.push({body,signal});onChunk('{"done":true}');return {message:{role:'assistant',content:'{"done":true}',timestamp:0},finishReason:'stop'};
 };
 const session=Object.create(CoopChatSession.prototype) as CoopChatSession;
 Object.assign(session,{turnStreamAbort:previous.signal,options:{api:{streamChat}},preferences:{apiBaseUrl:'https://stale.invalid',repoOwner:'stale',repoName:'repo'}});
 const call=Reflect.get(CoopChatSession.prototype,'planAgentToolTurn') as (this:CoopChatSession,...args:unknown[])=>Promise<string>;
 const owner={turn:{id:'live-owner',context:{},streamAbort:ownerAbort},task:'integration-only task',answerUseCase:'chat',baseUrl:'https://fixture.invalid'};
 const input={message:owner.task,repoId:'github:stale/repo',round:0,priorSteps:[],conversation:[],allowedIntegrations:['slack']};
 assert.equal(await call.call(session,input,{model:'gpt-5-mini',provider:'openai'},undefined,false,undefined,undefined,owner),'{"done":true}');
 assert.equal(sent.length,1);assert.equal(sent[0].signal,ownerAbort.signal);assert.equal(sent[0].body.quotaTurnId,'live-owner');
 assert.deepEqual(JSON.parse(JSON.stringify(sent[0].body.context)),{});assert.equal(JSON.parse(sent[0].body.message).repoId,'none');assert.equal(JSON.parse(sent[0].body.message).allowedRepoTools,false);
 ownerAbort.abort();Object.assign(session,{turnStreamAbort:new AbortController().signal});
 assert.equal(await call.call(session,input,{model:'gpt-5-mini',provider:'openai'},undefined,false,undefined,undefined,owner),'{"done":true}');
 assert.equal(sent.length,1,'Stopping the actual owner still prevents planner work');
});

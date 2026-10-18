import assert from 'node:assert/strict';
import test from 'node:test';
import {buildChatContinuation,normalizeChatRequestBody,isNativeContinuationEligible} from './chatContinuation';
import {agentPlanningRepoId} from './agent/parseAgentToolPlan';
import type {V1ChatRequestBody} from './types';

test('recovery preserves original history, user media, context and options without UI metadata',()=>{
 const image={id:'fixture',name:'pixel.png',mimeType:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgo='};
 const body:V1ChatRequestBody={message:'exact user\nbytes',history:[{role:'assistant',content:'prior'}],attachments:[image],
  context:{owner:'a',repo:'b',branch:'frozen',file:'one.ts',selectedLines:[1,3],languageId:'typescript',
    contextBundle:{nested:['ordered','values']},projectInstructions:[{path:'AGENTS.md',content:'untrusted instruction',kind:'agents-md'}]},
  ordinaryTurn:{phase:'answer',task:'original task',answerUseCase:'chat'},quotaTurnId:'same-turn',provider:'openai',model:'gpt-5.5',
  useCase:'chat',temperature:.2,maxTokens:600,enableThinking:true,sessionMode:'indexed-repo',fileSource:'remote',
  mentions:[{repoId:'github:a/b',path:'one.ts',lines:[1,3]}],responseTiming:{traceId:'old',callId:'old'}};
 const recovery=buildChatContinuation(body,'exact answer\n**Next**');
 assert.deepEqual(recovery.history,[{role:'assistant',content:'prior'},{role:'user',content:body.message,attachments:[image]},
  {role:'assistant',content:'exact answer\n**Next**'}]);
 assert.deepEqual(recovery.context,body.context);assert.deepEqual(recovery.mentions,body.mentions);
 assert.equal(recovery.enableThinking,false);assert.equal(recovery.attachments,undefined);assert.equal(recovery.responseTiming,undefined);
 assert.equal(recovery.ordinaryTurn?.phase,'continue');assert.equal(recovery.quotaTurnId,'same-turn');
 body.context!.contextBundle={changed:true};body.attachments![0].name='changed';
 assert.equal(recovery.history![1].attachments![0].name,'pixel.png');
 assert.deepEqual(recovery.context!.contextBundle,{nested:['ordered','values']});
 assert.deepEqual(normalizeChatRequestBody(recovery),recovery);
});
test('only supported native recovery conditions qualify',()=>{
 for(const reason of ['error','cancelled','unknown',''])assert.equal(isNativeContinuationEligible(reason,'**unfinished**'),false);
 assert.equal(isNativeContinuationEligible('stop','complete'),false);assert.equal(isNativeContinuationEligible('stop','**unfinished**'),true);
 assert.equal(isNativeContinuationEligible('length','partial'),true);
});
test('repository-free plans cannot borrow partial identities or enable repo tools',()=>{
 assert.equal(agentPlanningRepoId('github:stale/repo',{},false),'none');
 assert.equal(agentPlanningRepoId('none',{},true),undefined);
 for(const ctx of [{owner:'partial'},{repo:'partial'},{owner:'',repo:''}])assert.equal(agentPlanningRepoId('none',ctx,false),undefined);
 assert.equal(agentPlanningRepoId('github:unknown/unknown',{owner:'unknown',repo:'unknown'},true),'github:unknown/unknown');
 assert.equal(agentPlanningRepoId('github:other/repo',{owner:'a',repo:'b'},true),undefined);
});

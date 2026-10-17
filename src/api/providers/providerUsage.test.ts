import assert from 'node:assert/strict';
import test from 'node:test';
import {createProviderClient,createFimClient} from './index';
import type {ProviderStreamOptions,StreamChunk} from '../types';
import {usageFixture,usageModels,type UsageFixtureProvider} from './providerUsageFixtures.testSupport';
const options=(provider:UsageFixtureProvider):ProviderStreamOptions=>({model:usageModels[provider],messages:[{role:'user',content:'Synthetic probe'}],temperature:.5,maxTokens:600,requestId:'usage-probe',requireCompletedMessage:true});
async function collect(provider:UsageFixtureProvider,body:string,signal?:AbortSignal){
 const client=createProviderClient(provider,{apiKey:'synthetic-only',fetchImpl:async()=>new Response(body)});
 const chunks:StreamChunk[]=[];for await(const c of client.streamCompletion({...options(provider),signal}))chunks.push(c);return chunks;
}
for(const provider of Object.keys(usageModels) as UsageFixtureProvider[]){
 test(`${provider}: explicit complete counters including zero are authoritative only at native completion`,async()=>{
  for(const [input,output] of [[12,6],[0,0]]){
   const chunks=await collect(provider,usageFixture(provider,input,output));const done=chunks.find(c=>c.type==='done');
   assert.equal(done?.usage.provenance,'provider-final');assert.equal(done?.usage.inputTokens,input);assert.equal(done?.usage.outputTokens,output);assert.equal(done?.finishReason,'stop');
  }
 });
 test(`${provider}: partial, invalid and uncompleted observations never become a final receipt`,async()=>{
  for(const body of [usageFixture(provider,12,6,{partial:true}),usageFixture(provider,12,6,{terminal:false}),
   ...[undefined,null,'6',false,-1,1.5,Number.MAX_SAFE_INTEGER+1].map(value=>usageFixture(provider,12,value===undefined?null:value)),
   ...[null,'12',false,-1,1.5,Number.MAX_SAFE_INTEGER+1].map(value=>usageFixture(provider,value,6))]){
   const chunks=await collect(provider,body);const done=chunks.find(c=>c.type==='done');assert.notEqual(done?.usage.provenance,'provider-final',JSON.stringify({provider,body,chunks}));
  }
 });
 test(`${provider}: an error following final usage preserves the receipt and failure`,async()=>{
  const chunks=await collect(provider,usageFixture(provider,12,6,{errorAfter:true}));const done=chunks.find(c=>c.type==='done');
  assert.equal(done?.usage.provenance,'provider-final');assert.equal(done?.finishReason,'error');assert(chunks.some(c=>c.type==='error'));
 });
 test(`${provider}: durable dispatch precedes fetch and a rejected marker prevents network work`,async()=>{
  const events:string[]=[];const client=createProviderClient(provider,{apiKey:'synthetic-only',fetchImpl:async()=>{events.push('fetch');return new Response(usageFixture(provider));}});
  for await(const _ of client.streamCompletion({...options(provider),onProviderDispatch:async()=>{events.push('marker');}}))void _;
  assert.deepEqual(events,['marker','fetch']);events.length=0;
  for await(const _ of client.streamCompletion({...options(provider),onProviderDispatch:async()=>{events.push('marker');throw Error('unavailable');}}))void _;
  assert.deepEqual(events,['marker']);
 });
}
test('unsupported Mistral chat never dispatches; FIM requires complete valid counters and native terminal',async()=>{
 let fetches=0,markers=0;const client=createProviderClient('mistral',{apiKey:'synthetic-only',fetchImpl:async()=>{fetches++;return new Response('');}});
 for await(const _ of client.streamCompletion({...options('openai'),onProviderDispatch:async()=>{markers++;}}))void _;
 assert.equal(fetches,0);assert.equal(markers,0);
 for(const provider of ['mistral','deepseek'] as const)for(const terminal of [true,false]){
  const fim=createFimClient(provider,{apiKey:'synthetic-only',fetchImpl:async()=>new Response(usageFixture(provider,0,0,{terminal}))});
  assert(fim);const chunks:StreamChunk[]=[];
  for await(const c of fim.streamFim({prefix:'const x =',suffix:';',model:provider==='mistral'?'codestral-latest':'deepseek-chat',temperature:.2,maxTokens:128,requestId:'fim-probe'}))chunks.push(c);
  assert.equal(chunks.find(c=>c.type==='done')?.usage.provenance,terminal?'provider-final':'provider-partial');
 }
});
for(const provider of Object.keys(usageModels) as UsageFixtureProvider[])test(`${provider}: Stop/error before or after the final receipt preserves only observed authority`,async()=>{
 for(const final of [false,true])for(const stopped of [false,true]){
  const controller=new AbortController();let pulled=false;
  const client=createProviderClient(provider,{apiKey:'synthetic-only',fetchImpl:async()=>new Response(new ReadableStream({
   async pull(stream){if(!pulled){pulled=true;stream.enqueue(new TextEncoder().encode(usageFixture(provider,12,6,{partial:!final,terminal:final})));return;}
    await new Promise(resolve=>setTimeout(resolve,0));if(stopped)controller.abort();stream.error(Error('Synthetic stream interruption'));}
  }))});
  const chunks:StreamChunk[]=[];for await(const c of client.streamCompletion({...options(provider),signal:controller.signal}))chunks.push(c);
  const done=chunks.find(c=>c.type==='done');assert.equal(done?.finishReason,stopped?'cancelled':'error');
  assert.equal(done?.usage.provenance,final?'provider-final':'provider-partial',JSON.stringify(chunks));
 }
});
for(const provider of Object.keys(usageModels) as UsageFixtureProvider[])test(`${provider}: malformed or late answer data cannot become terminal success`,async()=>{
 const late=provider==='anthropic'?{type:'content_block_delta',delta:{type:'text_delta',text:'late'}}:
  provider==='gemini'?{candidates:[{content:{parts:[{text:'late'}]}}]}:{choices:[{delta:{content:'late'}}]};
 for(const extra of ['data: {broken\n\n',`data: ${JSON.stringify(late)}\n\n`]){
  const chunks=await collect(provider,usageFixture(provider)+extra);const done=chunks.find(c=>c.type==='done');
  assert.equal(done?.usage.provenance,'provider-final');assert.equal(done?.finishReason,'error');
 }
});
test('Anthropic cache input and Gemini thought counters use explicit aggregate receipts',async()=>{
 const anthropic=usageFixture('anthropic').replace('"input_tokens":12','"input_tokens":12,"cache_creation_input_tokens":3,"cache_read_input_tokens":4');
 const a=(await collect('anthropic',anthropic)).find(c=>c.type==='done');assert.equal(a?.usage.inputTokens,19);assert.equal(a?.usage.provenance,'provider-final');
 const gemini=usageFixture('gemini').replace('"thoughtsTokenCount":0,"totalTokenCount":18','"thoughtsTokenCount":7,"totalTokenCount":25');
 const g=(await collect('gemini',gemini)).find(c=>c.type==='done');assert.equal(g?.usage.outputTokens,13);assert.equal(g?.usage.provenance,'provider-final');
 for(const altered of [gemini.replace('"thoughtsTokenCount":7','"thoughtsTokenCount":null'),gemini.replace('"totalTokenCount":25','"totalTokenCount":24')])
  assert.notEqual((await collect('gemini',altered)).find(c=>c.type==='done')?.usage.provenance,'provider-final');
});

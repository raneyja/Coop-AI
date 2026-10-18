import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NetworkResilienceError,runResilientRequest,retryWithBackoff} from './networkResilience';

test('Stop interrupts long retry backoff and never dispatches another request',{timeout:1500},async()=>{
 const controller=new AbortController();let calls=0,retrying!:()=>void;const reached=new Promise<void>(resolve=>retrying=resolve);
 const pending=runResilientRequest({policy:{maxRetries:7,backoffMs:128000},signal:controller.signal,onRetry:()=>retrying(),run:async()=>{calls++;throw new NetworkResilienceError('synthetic rate limit',undefined,429);}});
 await reached;const start=performance.now();controller.abort();await assert.rejects(pending,{name:'AbortError'});assert(performance.now()-start<500);assert.equal(calls,1);
});
test('already stopped retries never start; live retry policy still executes',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(retryWithBackoff(async()=>++calls,{},undefined,undefined,controller.signal),{name:'AbortError'});assert.equal(calls,0);
 const result=await retryWithBackoff(async()=>{if(++calls<3)throw Error('synthetic');return 17;},{maxRetries:2,backoffMs:1});assert.equal(result,17);assert.equal(calls,3);
});

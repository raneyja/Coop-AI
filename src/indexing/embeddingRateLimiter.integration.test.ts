const {publicationDatabaseFromEnvironment}=require('../../scripts/publication-test-fixture.mjs');
const url:string=publicationDatabaseFromEnvironment(process.env,'jobs');
import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {Pool} from 'pg';
import {withEmbeddingConcurrencyLimit} from './embeddingRateLimiter';
import {embedTexts} from './embeddingsClient';
const control=new Pool({connectionString:url,ssl:false,max:2});
const original=process.env.EMBEDDING_MAX_CONCURRENT;
const children:ChildProcess[]=[];const pools:Pool[]=[];
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};};
async function until(predicate:()=>boolean|Promise<boolean>){const end=Date.now()+5000;while(Date.now()<end){if(await predicate())return;await pause(10);}throw Error('Embedding process fixture did not reach bounded condition');}
before(async()=>{await control.query('CREATE TABLE s79_embedding_counter(id int PRIMARY KEY,active int NOT NULL,peak int NOT NULL)');await control.query('INSERT INTO s79_embedding_counter VALUES(1,0,0)');});
after(async()=>{
 for(const child of children)if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGKILL');await closed;}
 await Promise.all(pools.map(pool=>pool.end()));await control.end();if(original===undefined)delete process.env.EMBEDDING_MAX_CONCURRENT;else process.env.EMBEDDING_MAX_CONCURRENT=original;
});
const newPool=(max=2)=>{const pool=new Pool({connectionString:url,ssl:false,max});pools.push(pool);return pool;};
for(const maximum of [1,2])test(`actual separate worker processes respect exactly${maximum} configured slots`,{timeout:20000},async()=>{
 await control.query('UPDATE s79_embedding_counter SET active=0,peak=0');
 const key='synthetic-'+randomUUID(),messages:Array<{index:number;phase:string;name?:string}>=[];
 const running=Array.from({length:maximum+1},(_,index)=>{
  const child=spawn(process.execPath,['--require','./scripts/vscode-test-stub.cjs','--import','./node_modules/tsx/dist/loader.mjs','src/indexing/embeddingRateLimiterProcess.fixture.ts'],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',DATABASE_SSL:'false',EH13_PUBLICATION_FIXTURE_FILE:process.env.EH13_PUBLICATION_FIXTURE_FILE,EMBEDDING_MAX_CONCURRENT:String(maximum),S79_SYNTHETIC_EMBEDDING_KEY:key},stdio:['ignore','ignore','pipe','ipc']});
  children.push(child);child.on('message',value=>messages.push({index,...value as {phase:string;name?:string}}));return {child,closed:once(child,'close')};
 });
 await until(()=>messages.filter(x=>x.phase==='ready').length===maximum+1);await until(()=>messages.filter(x=>x.phase==='entered').length===maximum);await pause(100);
 assert.equal(messages.filter(x=>x.phase==='entered').length,maximum);assert.equal(messages.filter(x=>x.phase==='error').length,0);
 assert.equal(Number((await control.query('SELECT active FROM s79_embedding_counter')).rows[0].active),maximum);
 for(const value of running)value.child.send('release');
 for(const value of running){const [code,signal]=await value.closed;assert.equal(code,0);assert.equal(signal,null);}
 const result=(await control.query('SELECT active,peak FROM s79_embedding_counter')).rows[0];assert.equal(Number(result.active),0);assert.equal(Number(result.peak),maximum);assert.equal(messages.filter(x=>x.phase==='done').length,maximum+1);
});

test('a real callback exception releases its session and permits another pool',async()=>{
 process.env.EMBEDDING_MAX_CONCURRENT='1';const a=newPool(),b=newPool(),key='synthetic-'+randomUUID();await assert.rejects(withEmbeddingConcurrencyLimit(a,key,async()=>{throw Error('synthetic callback failure');}),/callback failure/);assert.equal(await withEmbeddingConcurrencyLimit(b,key,async()=>17),17);
});

test('abort while waiting for a real configured slot never invokes the callback',{timeout:10000},async()=>{
 process.env.EMBEDDING_MAX_CONCURRENT='1';const a=newPool(),b=newPool(),key='synthetic-'+randomUUID(),entered=gate(),held=gate();
 const first=withEmbeddingConcurrencyLimit(a,key,async()=>{entered.release();await held.promise;});await entered.promise;const abort=new AbortController();let invoked=false;
 const second=withEmbeddingConcurrencyLimit(b,key,async()=>{invoked=true;},abort.signal);await pause(60);abort.abort();await assert.rejects(second,{name:'AbortError'});assert.equal(invoked,false);held.release();await first;assert.equal(await withEmbeddingConcurrencyLimit(b,key,async()=>true),true);
});

test('abort while a real pool is exhausted rejects and returns the late checkout',{timeout:10000},async()=>{
 process.env.EMBEDDING_MAX_CONCURRENT='1';const a=newPool(1),key='synthetic-'+randomUUID(),entered=gate(),held=gate();const first=withEmbeddingConcurrencyLimit(a,key,async()=>{entered.release();await held.promise;});await entered.promise;
 const abort=new AbortController();let invoked=false;const second=withEmbeddingConcurrencyLimit(a,key,async()=>{invoked=true;},abort.signal);abort.abort();await assert.rejects(second,{name:'AbortError'});held.release();await first;await until(()=>a.waitingCount===0&&a.idleCount===1);assert.equal(invoked,false);
});


test('terminating the pinned lock session cancels the callback without crashing its worker',{timeout:15000},async()=>{
 const key='synthetic-'+randomUUID(),messages:Array<{phase:string;backendPid?:number}>=[];
 const child=spawn(process.execPath,['--require','./scripts/vscode-test-stub.cjs','--import','./node_modules/tsx/dist/loader.mjs','src/indexing/embeddingRateLimiterProcess.fixture.ts'],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',DATABASE_SSL:'false',EH13_PUBLICATION_FIXTURE_FILE:process.env.EH13_PUBLICATION_FIXTURE_FILE,EMBEDDING_MAX_CONCURRENT:'1',S79_SYNTHETIC_EMBEDDING_KEY:key,S79_EMBEDDING_DISCONNECT:'1'},stdio:['ignore','ignore','pipe','ipc']});
 children.push(child);let stderr='';child.stderr?.on('data',value=>stderr+=value);child.on('message',value=>messages.push(value as typeof messages[number]));const closed=once(child,'close');
 await until(()=>messages.some(x=>x.phase==='lock-held'));const pid=messages.find(x=>x.phase==='lock-held')?.backendPid;assert(Number.isInteger(pid));
 assert.equal((await control.query('SELECT pg_terminate_backend($1) AS stopped',[pid])).rows[0].stopped,true);
 const [code,signal]=await closed;assert.equal(code,0,stderr);assert.equal(signal,null);assert(messages.some(x=>x.phase==='callback-cancelled'));assert(messages.some(x=>x.phase==='error'));assert(!messages.some(x=>x.phase==='done'));assert(!stderr.includes('Unhandled'));
 assert.equal(await withEmbeddingConcurrencyLimit(newPool(),key,async()=>true),true);
});


test('Stop during actual embedding retry backoff releases the configured slot',{timeout:5000},async()=>{
 const previousKey=process.env.OPENAI_API_KEY,originalFetch=globalThis.fetch;process.env.OPENAI_API_KEY='synthetic-'+randomUUID();process.env.EMBEDDING_MAX_CONCURRENT='1';
 const a=newPool(),abort=new AbortController();let calls=0,responded!:()=>void;const response=new Promise<void>(resolve=>responded=resolve);
 globalThis.fetch=async()=>{calls++;responded();return new Response(JSON.stringify({error:{message:'Please try again in 128s'}}),{status:429,headers:{'content-type':'application/json'}});};
 try{
  const pending=embedTexts(['synthetic embedding cancellation'],{pool:a,signal:abort.signal});await response;await pause(20);const start=performance.now();abort.abort();await assert.rejects(pending,{name:'AbortError'});assert(performance.now()-start<500);assert.equal(calls,1);
  assert.equal(await withEmbeddingConcurrencyLimit(newPool(),process.env.OPENAI_API_KEY!,async()=>true),true);
 }finally{globalThis.fetch=originalFetch;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;}
});

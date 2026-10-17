import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import type {Pool} from 'pg';
import {withEmbeddingConcurrencyLimit} from './embeddingRateLimiter';

function sessionPool(max=3, fault?: 'acquire-lost'|'unlock-lost'|'unlock-false') {
  const clients: Array<{id:number;busy:boolean}> = [], waiters: Array<(client: ReturnType<typeof handle>)=>void> = [];
  const locks = new Map<string,{owner:number;depth:number}>();
  const destroyed: number[] = [];
  function handle(session: {id:number;busy:boolean}) {
    let released=false; const events = new EventEmitter();
    return {
      ...{on: (event: string, listener: (...args: unknown[])=>void) => events.on(event,listener), removeListener: (event: string, listener: (...args: unknown[])=>void) => events.removeListener(event,listener)},
      query: async (sql:string,params:string[]) => {
        const key=params[0],held=locks.get(key);
        if(sql.includes('pg_try_advisory_lock')) {
          if(fault==='acquire-lost'){locks.set(key,{owner:session.id,depth:1});throw Error('acquisition acknowledgement lost');}
          if(held&&held.owner!==session.id)return {rows:[{acquired:false}]};
          locks.set(key,{owner:session.id,depth:(held?.depth??0)+1});return {rows:[{acquired:true}]};
        }
        if(sql.includes('pg_advisory_unlock')) {
          if(fault==='unlock-lost')throw Error('release acknowledgement lost');
          if(fault==='unlock-false')return {rows:[{released:false}]};
          if(!held||held.owner!==session.id)return {rows:[{released:false}]};
          if(--held.depth===0)locks.delete(key);return {rows:[{released:true}]};
        }
        throw new Error('Unexpected lock query');
      },
      release(error?:Error) {
        assert(!released,'Checkout released twice');released=true;
        if(error){destroyed.push(session.id);for(const [key,held] of locks)if(held.owner===session.id)locks.delete(key);}
        session.busy=false;const waiter=waiters.shift();if(waiter){session.busy=true;waiter(handle(session));}
      }
    };
  }
  const connect=async()=>{
    let session=clients.find(x=>!x.busy);
    if(!session&&clients.length<max){session={id:clients.length+1,busy:false};clients.push(session);}
    if(session){session.busy=true;return handle(session);}
    return new Promise<ReturnType<typeof handle>>(resolve=>waiters.push(resolve));
  };
  const pool={connect,query:async(sql:string,params:string[])=>{const client=await connect();try{return await client.query(sql,params);}finally{client.release();}}} as unknown as Pool;
  return {pool,locks,clients,waiters,destroyed};
}
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('embedding limits retain PostgreSQL session ownership and configured slots',async t=>{
  const original=process.env.EMBEDDING_MAX_CONCURRENT;
  try {
    await t.test('one slot excludes another session until callback and unlock finish',async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='1';const db=sessionPool();const entered=gate(),held=gate();let active=0,peak=0;
      const first=withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{peak=Math.max(peak,++active);entered.release();await held.promise;active--;});
      await entered.promise;let secondEntered=false;
      const second=withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{secondEntered=true;peak=Math.max(peak,++active);active--;});
      await pause(40);assert.equal(secondEntered,false);held.release();await Promise.all([first,second]);assert.equal(peak,1);assert.equal(db.locks.size,0);
    });
    await t.test('two slots do not admit an unslotted third callback',async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='2';const db=sessionPool(4),held=gate(),both=gate();let active=0,peak=0,entered=0;
      const calls=Array.from({length:4},()=>withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{peak=Math.max(peak,++active);if(++entered===2)both.release();await held.promise;active--;}));
      await both.promise;await pause(40);assert.equal(entered,2);held.release();await Promise.all(calls);assert.equal(peak,2);assert.equal(db.locks.size,0);
    });
    await t.test('callback failure releases its exact session lock',async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='1';const db=sessionPool();await assert.rejects(withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{throw Error('synthetic callback failure');}),/callback failure/);
      assert.equal(await withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>42),42);assert.equal(db.locks.size,0);
    });
    await t.test('abort while pool checkout is queued rejects promptly and returns eventual checkout',async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='1';const db=sessionPool(1),entered=gate(),held=gate();const first=withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{entered.release();await held.promise;});await entered.promise;
      const abort=new AbortController();let invoked=false;
      const second=withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{invoked=true;},abort.signal);abort.abort();await assert.rejects(second,{name:'AbortError'});assert.equal(invoked,false);
      held.release();await first;await pause(0);assert.equal(db.locks.size,0);assert.equal(db.waiters.length,0);assert(db.clients.every(x=>!x.busy));
    });
    await t.test('aborted slot waiter cannot run after the slot becomes free',async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='1';const db=sessionPool(),entered=gate(),held=gate();const first=withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{entered.release();await held.promise;});await entered.promise;
      const abort=new AbortController();let invoked=false;const pending=withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{invoked=true;},abort.signal);await pause(30);abort.abort();await assert.rejects(pending,{name:'AbortError'});held.release();await first;assert.equal(invoked,false);assert.equal(db.locks.size,0);
    });
    await t.test('different credential scopes can run independently',async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='1';const db=sessionPool(),held=gate(),both=gate();let active=0;
      const calls=['key-a','key-b'].map(key=>withEmbeddingConcurrencyLimit(db.pool,key,async()=>{if(++active===2)both.release();await held.promise;}));await both.promise;held.release();await Promise.all(calls);assert.equal(db.locks.size,0);
    });
    for(const fault of ['acquire-lost','unlock-lost','unlock-false'] as const)await t.test(`uncertain ${fault} destroys the session and cannot return success`,async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='1';const db=sessionPool(3,fault);let invoked=false;
      await assert.rejects(withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{invoked=true;return 1;}));assert.equal(invoked,fault!=='acquire-lost');assert.equal(db.destroyed.length,1);assert.equal(db.locks.size,0);
    });
    await t.test('callback and unlock failures both remain visible',async()=>{
      process.env.EMBEDDING_MAX_CONCURRENT='1';const db=sessionPool(3,'unlock-lost');
      await assert.rejects(withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>{throw Error('callback fault');}),error=>error instanceof AggregateError&&error.errors.length===2&&String(error.errors[0]).includes('callback fault')&&String(error.errors[1]).includes('release acknowledgement'));assert.equal(db.destroyed.length,1);
    });
    await t.test('invalid operator limits fail before checkout',async()=>{
      for(const value of ['0','-1','1.5','NaN','Infinity','65']){process.env.EMBEDDING_MAX_CONCURRENT=value;const db=sessionPool();await assert.rejects(withEmbeddingConcurrencyLimit(db.pool,'synthetic-key',async()=>true),/integer from 1 through 64/);assert.equal(db.clients.length,0);}
    });
  } finally {if(original===undefined)delete process.env.EMBEDDING_MAX_CONCURRENT;else process.env.EMBEDDING_MAX_CONCURRENT=original;}
});

const {publicationDatabaseFromEnvironment} = require('../../scripts/publication-test-fixture.mjs');
const url:string = publicationDatabaseFromEnvironment(process.env,'jobs');
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,after,test} from 'node:test';
import {Pool} from 'pg';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {JOB_EFFECT_ADMISSION_LOCK} from './jobEffectAdmission';
import {PostgresQueueBackend} from './backends/postgresBackend';
import {MemoryQueueBackend} from './backends/memoryBackend';
import {JobType,type Job} from './types';
import {withJobOwnedEffect,withJobEffectExclusion} from './jobEffectAdmission';
import {RepoStatsStore} from '../workspace/repoStatsStore';
const pool=new Pool({connectionString:url,ssl:false,max:6});
const backends:PostgresQueueBackend[]=[];
const backend=()=>{const x=new PostgresQueueBackend(url);backends.push(x);return x;};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release};};
const org=async()=>{const id=randomUUID();await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'synthetic concurrent org','enterprise')",[id]);return id;};
function job(orgId:string,repoId='github:fixture/repo',type:JobType=JobType.INDEX_REPOSITORY):Job {
 return {id:randomUUID(),type,status:'queued',priority:'normal',params:{orgId,repoId},progress:0,retryCount:0,createdAt:new Date(),estimatedDurationMs:1000};
}
async function submitAndClaim(b:PostgresQueueBackend,orgId:string,repoId?:string,type?:JobType,lease=10000){const queued=await b.save(job(orgId,repoId,type));const value=await b.claimNext(randomUUID(),lease);assert(value);assert.equal(value.id,queued.id);return value;}
async function statsWrite(value:Job,fileCount=1){return withJobOwnedEffect(pool,value,client=>new RepoStatsStore(client).upsertStats(String(value.params.orgId),String(value.params.repoId),{fileCount,lineCount:2,byteCount:3,languages:[],indexedAt:new Date()}));}
async function until(predicate:()=>Promise<boolean>){const end=Date.now()+3500;while(Date.now()<end){if(await predicate())return;await sleep(10);}throw Error('Concurrent fixture did not reach bounded condition');}
beforeEach(async()=>{await pool.query('TRUNCATE jobs,graph_publication_heads,repo_stats,org_repos CASCADE');});
afterEach(async()=>{await Promise.all(backends.splice(0).map(x=>x.close()));});
after(async()=>{await pool.end();});

test('different organizations claim and enter actual SQL effects concurrently',{timeout:12000},async()=>{
 const a=backend(),b=backend(),oa=await org(),ob=await org();await a.save(job(oa));await a.save(job(ob));
 const [left,right]=await Promise.all([a.claimNext(randomUUID(),10000),b.claimNext(randomUUID(),10000)]);assert(left&&right);assert.notEqual(left.id,right.id);assert.notEqual(left.params.orgId,right.params.orgId);
 const held=gate(),both=gate();let entered=0;
 const writes=[left,right].map(value=>withJobOwnedEffect(pool,value,async client=>{if(++entered===2)both.release();await held.promise;await new RepoStatsStore(client).upsertStats(String(value.params.orgId),String(value.params.repoId),{fileCount:7,lineCount:8,byteCount:9,languages:[],indexedAt:new Date()});}));
 try{await Promise.race([both.promise,sleep(3500).then(()=>{throw Error('Effects did not overlap');})]);assert.equal(entered,2);}finally{held.release();await Promise.all(writes);}
 const rows=(await pool.query('SELECT org_id,file_count FROM repo_stats ORDER BY org_id')).rows;assert.equal(rows.length,2);assert(rows.every(x=>Number(x.file_count)===7));
});

test('same organization remains serialized across different logical and physical-alias repositories',async()=>{
 const b=backend(),o=await org();await submitAndClaim(b,o,'gitlab:group/subgroup/project-a');await b.save(job(o,'gitlab:group/subgroup/project-b'));assert.equal(await b.claimNext(randomUUID(),10000),undefined);
});
for(const firstType of [JobType.BUILD_STRUCTURE_MANIFEST,JobType.BUILD_DEPENDENCY_GRAPH])test(`other effect ${firstType} retains global exclusion`,async()=>{
 const b=backend();await submitAndClaim(b,await org(),'github:fixture/other',firstType);await b.save(job(await org()));assert.equal(await b.claimNext(randomUUID(),10000),undefined);
});
test('a running index excludes another effect type globally',async()=>{
 const b=backend();await submitAndClaim(b,await org());await b.save(job(await org(),'github:fixture/other',JobType.BUILD_STRUCTURE_MANIFEST));assert.equal(await b.claimNext(randomUUID(),10000),undefined);
});
for(const malformed of ['missing','extra-scope','numeric-generation','forged-org'])test(`unattested running index footprint ${malformed} cannot overlap`,async()=>{
 const b=backend(),active=await submitAndClaim(b,await org());
 let scopes:unknown=active.graphGenerations;
 if(malformed==='missing')scopes=null;
 if(malformed==='extra-scope')scopes=[...active.graphGenerations!,{...active.graphGenerations![0],repoId:'github:fixture/extra'}];
 if(malformed==='numeric-generation')scopes=[{...active.graphGenerations![0],generation:1}];
 if(malformed==='forged-org')scopes=[{...active.graphGenerations![0],orgId:randomUUID()}];
 await pool.query('UPDATE jobs SET graph_generations=$2::jsonb WHERE id=$1',[active.id,JSON.stringify(scopes)]);await b.save(job(await org()));assert.equal(await b.claimNext(randomUUID(),10000),undefined);
});

test('quarantine blocks an already-running peer before its next effect and terminal success',async()=>{
 const b=backend(),a=await submitAndClaim(b,await org()),peer=await submitAndClaim(b,await org());assert(await b.cancel(a.id,true));let entered=false;
 await assert.rejects(withJobOwnedEffect(pool,peer,async()=>{entered=true;}),/termination and reconciliation/);assert.equal(entered,false);
 await assert.rejects(b.updateOwned({...peer,status:'completed'},{ownerId:peer.ownerId!,attemptId:peer.attemptId!}),/termination and reconciliation/);
 await b.save(job(await org()));assert.equal(await b.claimNext(randomUUID(),10000),undefined);assert.equal(await b.delete(a.id),false);
});

test('quarantine transition waits through peer physical callback boundary',{timeout:12000},async()=>{
 const b=backend(),a=await submitAndClaim(b,await org()),peer=await submitAndClaim(b,await org());const entered=gate(),held=gate();let cancelDone=false;
 const writing=withJobOwnedEffect(pool,peer,async client=>{entered.release();await held.promise;await client.query('SELECT 1');});await entered.promise;
 const cancelled=b.cancel(a.id,true).then(value=>{cancelDone=true;return value;});
 try{await until(async()=>Number((await pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(%'")).rows[0].n)>0);assert.equal(cancelDone,false);}finally{held.release();await writing;}
 assert(await cancelled);await assert.rejects(statsWrite(peer),/termination and reconciliation/);
});

test('expired peer quarantine also waits for an entered effect and remains global',{timeout:12000},async()=>{
 const b=backend(),a=await submitAndClaim(b,await org(),undefined,undefined,150),peer=await submitAndClaim(b,await org());const entered=gate(),held=gate();let reclaimed=false;
 const writing=withJobOwnedEffect(pool,peer,async()=>{entered.release();await held.promise;});await entered.promise;await sleep(180);
 const reclaim=b.reclaimExpired(3).then(value=>{reclaimed=true;return value;});
 try{await sleep(40);assert.equal(reclaimed,false);}finally{held.release();await writing;}
 assert.equal(await reclaim,1);assert.equal((await b.get(a.id))?.effectQuarantined,true);await assert.rejects(statsWrite(peer),/termination and reconciliation/);
});

test('purge/standalone exclusion remains global while either organization is active',async()=>{
 const b=backend();await submitAndClaim(b,await org());await submitAndClaim(b,await org());let entered=false;await assert.rejects(withJobEffectExclusion(pool,async()=>{entered=true;}),/termination and reconciliation/);assert.equal(entered,false);
});

test('SQL rollback and stale attempts cannot publish into the other organization',async()=>{
 const b=backend(),a=await submitAndClaim(b,await org()),peer=await submitAndClaim(b,await org());await assert.rejects(withJobOwnedEffect(pool,a,async client=>{await new RepoStatsStore(client).upsertStats(String(a.params.orgId),String(a.params.repoId),{fileCount:999,lineCount:1,byteCount:1,languages:[],indexedAt:new Date()});await client.query('SELECT 1/0');}),/division by zero/);
 assert.equal(Number((await pool.query('SELECT count(*) AS n FROM repo_stats')).rows[0].n),0);await statsWrite(peer,2);await assert.rejects(statsWrite({...a,attemptId:randomUUID()}),/lost ownership/);assert.equal(Number((await pool.query('SELECT count(*) AS n FROM repo_stats')).rows[0].n),1);
});

test('memory owner mirrors cross-org overlap, same-org exclusion and global quarantine',async()=>{
 const b=new MemoryQueueBackend(),oa=randomUUID(),ob=randomUUID();await b.save(job(oa));await b.save(job(ob));const a=await b.claimNext('worker-a',10000),peer=await b.claimNext('worker-b',10000);assert(a&&peer);assert.notEqual(a.params.orgId,peer.params.orgId);await b.save(job(oa,'github:fixture/second'));assert.equal(await b.claimNext('worker-c',10000),undefined);
 assert(await b.cancel(a.id,true));let invoked=false;assert.throws(()=>b.publishMemoryGraph(peer,String(peer.params.repoId),()=>{invoked=true;}),/not owned/);assert.equal(invoked,false);assert.equal(await b.updateOwned({...peer,status:'completed'},{ownerId:peer.ownerId!,attemptId:peer.attemptId!}),undefined);
});


for(const mode of ['claim','save','progress'])test(`paused ${mode} control transaction releases global admission at the server`,{timeout:15000},async()=>{
 const b=backend(),o=await org(),value=mode==='progress'?await submitAndClaim(b,o,undefined,undefined,30000):await b.save(job(o));
 const child=spawn(process.execPath,['--require','./scripts/vscode-test-stub.cjs','--import','./node_modules/tsx/dist/loader.mjs','src/jobs/controlTransactionPause.fixture.ts'],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',DATABASE_SSL:'false',EH13_PUBLICATION_FIXTURE_FILE:process.env.EH13_PUBLICATION_FIXTURE_FILE,S79_CONTROL_MODE:mode,S79_CONTROL_JOB:value.id},stdio:['ignore','ignore','pipe','ipc']});
 const messages:Array<{phase:string}>=[];let stderr='';child.stderr?.on('data',x=>stderr+=x);child.on('message',x=>messages.push(x as typeof messages[number]));const closed=once(child,'close');
 try{
  await until(async()=>messages.some(x=>x.phase==='locked'));await sleep(80);const start=performance.now();
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL statement_timeout=8000');await client.query('SELECT pg_advisory_xact_lock($1)',[JOB_EFFECT_ADMISSION_LOCK]);await client.query('COMMIT');}finally{await client.query('ROLLBACK');client.release();}
  assert(performance.now()-start<8000);assert.equal(child.exitCode,null);
  child.kill('SIGCONT');const [code,signal]=await closed;assert.equal(code,0,stderr);assert.equal(signal,null);assert(messages.some(x=>x.phase==='controlled-rejection'));assert(!messages.some(x=>x.phase==='unexpected-success'));
  const current=await b.get(value.id);assert.equal(current?.status,value.status);assert.equal(current?.progress,value.progress);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
});


test('reclaim rechecks a renewal committed while admission waits',{timeout:10000},async()=>{
 const b=backend(),value=await submitAndClaim(b,await org(),undefined,undefined,1500),renewal=await pool.connect(),barrier=await pool.connect();
 let pending:Promise<number>|undefined;
 try{
  await renewal.query('BEGIN');await renewal.query("UPDATE jobs SET lease_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1 AND lease_expires_at>clock_timestamp()",[value.id]);
  await barrier.query('BEGIN');await barrier.query('SELECT pg_advisory_xact_lock($1)',[JOB_EFFECT_ADMISSION_LOCK]);await sleep(1550);pending=b.reclaimExpired(3);
  await until(async()=>Number((await pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'WITH admission AS MATERIALIZED%'")).rows[0].n)>0);
  await renewal.query('COMMIT');await barrier.query('COMMIT');assert.equal(await pending,0);assert.equal((await b.get(value.id))?.status,'running');assert.equal((await b.get(value.id))?.effectQuarantined,false);
 }finally{await renewal.query('ROLLBACK');await barrier.query('ROLLBACK');renewal.release();barrier.release();if(pending)await pending;}
});
for(const action of ['cancel','reclaim'])test(`${action} rechecks terminal state committed while admission waits`,{timeout:10000},async()=>{
 const b=backend(),value=await submitAndClaim(b,await org(),undefined,undefined,150),terminal=await pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await terminal.query('BEGIN');await terminal.query('SELECT pg_advisory_xact_lock($1)',[JOB_EFFECT_ADMISSION_LOCK]);await terminal.query("UPDATE jobs SET status='completed',completed_at=clock_timestamp() WHERE id=$1",[value.id]);await sleep(180);
  pending=action==='cancel'?b.cancel(value.id,true):b.reclaimExpired(3);
  await until(async()=>Number((await pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'WITH admission AS MATERIALIZED%'")).rows[0].n)>0);
  await terminal.query('COMMIT');assert.equal(await pending,action==='cancel'?undefined:0);const current=await b.get(value.id);assert.equal(current?.status,'completed');assert.equal(current?.effectQuarantined,false);
 }finally{await terminal.query('ROLLBACK');terminal.release();if(pending)await pending;}
});

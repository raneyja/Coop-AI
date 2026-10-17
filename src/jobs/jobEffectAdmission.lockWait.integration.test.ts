// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'graph-lock');
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { after, beforeEach, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { withJobOwnedEffect } from './jobEffectAdmission';
import { JobType, type Job } from './types';
const { admitDisposableDatabaseTarget } = require('../../scripts/disposable-database-target.mjs') as {
  admitDisposableDatabaseTarget(value: string, expected: {port: string; database: string; user: string}): string;
};
const url = releaseDatabase;
const control = new Pool({connectionString: url, max: 3, application_name: 'eh08-lock-control'});
const effect = new Pool({connectionString: url, max: 2, application_name: 'eh08-lock-effect'});
const observations: Record<string, unknown>[] = [];
after(async () => {
  await effect.end(); await control.end();
  if (process.env.EH08_LOCK_RESULTS) writeFileSync(process.env.EH08_LOCK_RESULTS, JSON.stringify(observations, null, 2)+'\n');
});
// Fault cases intentionally create quarantine; each subtest owns a fresh state.
beforeEach(async()=>{await control.query('TRUNCATE jobs,graph_publication_heads,graph_snapshots CASCADE');});
async function until(predicate: () => Promise<boolean>) {
  const end = Date.now()+2500;
  while (Date.now()<end) { if (await predicate()) return; await new Promise(resolve=>setTimeout(resolve,5)); }
  throw new Error('Owned fixture did not reach bounded SQL-clock/lock condition');
}
async function fixture(leaseMs = 5000): Promise<Job> {
  const id=randomUUID(), orgId=randomUUID();
  await control.query("INSERT INTO organizations(id,name) VALUES($1,'synthetic lock-wait org')",[orgId]);
  const job: Job = {id, type:JobType.INDEX_REPOSITORY,status:'running',priority:'normal',
    params:{orgId,repoId:'github:fixture/'+id},userId:orgId,ownerId:randomUUID(),attemptId:randomUUID(),
    progress:0,createdAt:new Date(),estimatedDurationMs:1,retryCount:0};
  job.graphGenerations=[{orgId,repoId:String(job.params.repoId),generation:'1'}];
  await control.query('INSERT INTO graph_publication_heads(org_id,repo_id,requested_generation,requested_job_id) VALUES($1,$2,1,$3)',[orgId,job.params.repoId,id]);
  await control.query(`INSERT INTO jobs(id,type,status,priority,params,user_id,owner_id,attempt_id,lease_expires_at,graph_generations)
    VALUES($1,$2,'running','normal',$3::jsonb,$4,$5,$6,clock_timestamp()+$7*interval '1 millisecond',$8::jsonb)`,
    [id,job.type,JSON.stringify(job.params),job.userId,job.ownerId,job.attemptId,leaseMs,JSON.stringify(job.graphGenerations)]);
  return job;
}
async function write(client: PoolClient, job: Job) {
  await client.query('INSERT INTO graph_snapshots(org_id,repo_id,payload) VALUES($1,$2,$3)',
    [job.params.orgId,job.params.repoId,{marker:'synthetic-owned-effect'}]);
}
async function count(job: Job) {
  return Number((await control.query('SELECT count(*) AS n FROM graph_snapshots WHERE org_id=$1 AND repo_id=$2',
    [job.params.orgId,job.params.repoId])).rows[0].n);
}
function capture(promise: Promise<unknown>) { return promise.then(()=>null,error=>error as Error); }
async function blocked(job: Job, change: (client: PoolClient) => Promise<void>, signal?: AbortSignal) {
  const lock=await control.connect(); let entered=false; let pending: Promise<Error|null>|undefined;
  try {
    await lock.query('BEGIN'); await lock.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[job.id]);
    pending=capture(withJobOwnedEffect(effect,job,async client=>{entered=true;await write(client,job);},signal));
    await until(async()=>Number((await control.query("SELECT count(*) AS n FROM pg_stat_activity WHERE application_name='eh08-lock-effect' AND wait_event_type='Lock'")).rows[0].n)>0);
    await change(lock); await lock.query('COMMIT'); const error=await pending;
    return {entered,persisted:await count(job),error};
  } finally {await lock.query('ROLLBACK').catch(()=>undefined);lock.release();if(pending)await pending;}
}
test('actual row-lock and callback boundaries preserve live effects and reject stale effects',async t=>{
  await t.test('live unchanged lock waiter commits',async()=>{
    const job=await fixture();const observed=await blocked(job,async()=>undefined);
    assert.equal(observed.error,null);assert.equal(observed.entered,true);assert.equal(observed.persisted,1);
    observations.push({case:'live-lock-wait',...observed});
  });
  await t.test('unchanged row expires while blocked: callback never enters',async()=>{
    const job=await fixture(250);const observed=await blocked(job,async()=>{
      await until(async()=>Boolean((await control.query('SELECT lease_expires_at<=clock_timestamp() AS expired FROM jobs WHERE id=$1',[job.id])).rows[0].expired));
    });
    observations.push({case:'expired-lock-wait',...observed,error:observed.error?.message??null});
    assert.equal(observed.entered,false);assert.equal(observed.persisted,0);assert.match(observed.error?.message??'',/lost ownership/);
  });
  await t.test('live callback returns its result and commits once',async()=>{
    const job=await fixture();assert.equal(await withJobOwnedEffect(effect,job,async client=>{await write(client,job);return 'supported';}),'supported');assert.equal(await count(job),1);
  });
  await t.test('lease expires during actual SQL callback: write rolls back',async()=>{
    const job=await fixture(250);let expired=false;
    const error=await capture(withJobOwnedEffect(effect,job,async client=>{
      await write(client,job);await client.query('SELECT pg_sleep(0.35)');
      expired=Boolean((await client.query('SELECT lease_expires_at<=clock_timestamp() AS expired FROM jobs WHERE id=$1',[job.id])).rows[0].expired);
    }));
    const persisted=await count(job);
    observations.push({case:'callback-server-clock-expiry',expired,persisted,error:error?.message??null});
    assert.equal(expired,true);assert.match(error?.message??'',/lost ownership/);assert.equal(persisted,0);
  });
  await t.test('abort during SQL callback rolls back',async()=>{
    const job=await fixture();const abort=new AbortController();
    const error=await capture(withJobOwnedEffect(effect,job,async client=>{await write(client,job);abort.abort();await client.query('SELECT pg_sleep(0.01)');},abort.signal));
    assert.equal(error?.name,'AbortError');assert.equal(await count(job),0);
  });
  await t.test('abort during row lock wait prevents callback',async()=>{
    const job=await fixture();const abort=new AbortController();const observed=await blocked(job,async()=>{abort.abort();},abort.signal);
    assert.equal(observed.entered,false);assert.equal(observed.persisted,0);assert.equal(observed.error?.name,'AbortError');
  });
  await t.test('durable cancellation while waiting prevents callback',async()=>{
    const job=await fixture();const observed=await blocked(job,async client=>{await client.query("UPDATE jobs SET status='cancelled' WHERE id=$1",[job.id]);});
    assert.equal(observed.entered,false);assert.equal(observed.persisted,0);assert.match(observed.error?.message??'',/lost ownership/);
  });
  await t.test('new attempt after row lock wait rejects old identity and accepts successor',async()=>{
    const job=await fixture();const next={...job,ownerId:randomUUID(),attemptId:randomUUID()};
    const observed=await blocked(job,async client=>{await client.query('UPDATE jobs SET owner_id=$2,attempt_id=$3 WHERE id=$1',[job.id,next.ownerId,next.attemptId]);});
    assert.equal(observed.entered,false);assert.equal(observed.persisted,0);assert.match(observed.error?.message??'',/lost ownership/);
    await withJobOwnedEffect(effect,next,client=>write(client,next));assert.equal(await count(next),1);
  });
  for (const field of ['owner','attempt','type','params','user','quarantine','status'] as const) await t.test('pre-commit '+field+' mutation rolls back the entire callback',async()=>{
    const job=await fixture();const updates={owner:'owner_id=$2',attempt:'attempt_id=$2',type:'type=$2',params:'params=$2::jsonb',user:'user_id=$2',quarantine:'effect_quarantined=$2',status:'status=$2'};
    const values={owner:randomUUID(),attempt:randomUUID(),type:JobType.GENERATE_REPO_SUMMARY,params:JSON.stringify({...job.params,repoId:'github:foreign/repo'}),user:'foreign-user',quarantine:true,status:'cancelled'};
    const error=await capture(withJobOwnedEffect(effect,job,async client=>{await write(client,job);await client.query(`UPDATE jobs SET ${updates[field]} WHERE id=$1`,[job.id,values[field]]);}));
    assert.match(error?.message??'',/lost ownership/);assert.equal(await count(job),0);
    const current=(await control.query('SELECT status,owner_id,attempt_id,params,user_id,type,effect_quarantined FROM jobs WHERE id=$1',[job.id])).rows[0];
    assert.equal(current.status,'running');assert.equal(current.owner_id,job.ownerId);assert.equal(current.attempt_id,job.attemptId);assert.deepEqual(current.params,job.params);assert.equal(current.user_id,job.userId);assert.equal(current.type,job.type);assert.equal(current.effect_quarantined,false);
  });
  for (const forged of ['org','repo','user','owner','attempt','type'] as const) await t.test('forged '+forged+' identity never enters callback',async()=>{
    const job=await fixture();const presented={...job,params:{...job.params}};
    if(forged==='org')presented.params.orgId=randomUUID();else if(forged==='repo')presented.params.repoId='github:foreign/repo';else if(forged==='user')presented.userId='foreign-user';else if(forged==='owner')presented.ownerId=randomUUID();else if(forged==='attempt')presented.attemptId=randomUUID();else presented.type=JobType.GENERATE_REPO_SUMMARY;
    let entered=false;await assert.rejects(withJobOwnedEffect(effect,presented,async()=>{entered=true;}),/lost ownership/);assert.equal(entered,false);assert.equal(await count(job),0);
  });
  await t.test('mutable supplied job cannot substitute a newly changed durable identity while waiting',async()=>{
    const job=await fixture();const original={...job,params:{...job.params}};
    const observed=await blocked(job,async client=>{job.ownerId=randomUUID();job.attemptId=randomUUID();job.params={...job.params,repoId:'github:fixture/new'};await client.query('UPDATE jobs SET owner_id=$2,attempt_id=$3,params=$4::jsonb WHERE id=$1',[job.id,job.ownerId,job.attemptId,JSON.stringify(job.params)]);});
    assert.equal(observed.entered,false);assert.equal(observed.persisted,0);assert.equal(await count(original),0);assert.match(observed.error?.message??'',/lost ownership/);
  });
  await t.test('callback cannot rewrite admission by mutating both supplied Job and SQL identity',async()=>{
    const job=await fixture();const original={...job,params:{...job.params}};
    const error=await capture(withJobOwnedEffect(effect,job,async client=>{
      await write(client,original);job.id=randomUUID();job.ownerId=randomUUID();job.attemptId=randomUUID();job.type=JobType.BUILD_STRUCTURE_MANIFEST;
      job.params={...job.params,orgId:randomUUID(),repoId:'github:fixture/substituted'};job.userId='substituted-user';
      await client.query('UPDATE jobs SET owner_id=$2,attempt_id=$3,type=$4,params=$5::jsonb,user_id=$6 WHERE id=$1',
        [original.id,job.ownerId,job.attemptId,job.type,JSON.stringify(job.params),job.userId]);
    }));
    assert.match(error?.message??'',/lost ownership/);assert.equal(await count(original),0);assert.equal(await count(job),0);
    const row=(await control.query('SELECT owner_id,attempt_id,type,params,user_id FROM jobs WHERE id=$1',[original.id])).rows[0];
    assert.equal(row.owner_id,original.ownerId);assert.equal(row.attempt_id,original.attemptId);assert.equal(row.type,original.type);assert.deepEqual(row.params,original.params);assert.equal(row.user_id,original.userId);
  });
  await t.test('actual SQL fault rolls back prior write and releases client/row lock',async()=>{
    const job=await fixture();await assert.rejects(withJobOwnedEffect(effect,job,async client=>{await write(client,job);await client.query('SELECT 1/0');}),/division by zero/);assert.equal(await count(job),0);
    await withJobOwnedEffect(effect,job,client=>write(client,job));assert.equal(await count(job),1);
  });
  await t.test('pre-aborted and missing attempt reject without callback',async()=>{
    const job=await fixture();let entered=false;const abort=new AbortController();abort.abort();
    await assert.rejects(withJobOwnedEffect(effect,job,async()=>{entered=true;},abort.signal),{name:'AbortError'});
    await assert.rejects(withJobOwnedEffect(effect,{...job,attemptId:undefined},async()=>{entered=true;}),/no admitted attempt/);assert.equal(entered,false);
  });
});

// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'jobs');
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { Pool } from 'pg';
import { JobQueue } from './jobQueue';
import { PostgresQueueBackend } from './backends/postgresBackend';
import { WorkerPool } from './workerPool';
import { blankRepositoryGraph } from '../cache/graphCache';
import {PersistingGraphCache} from '../cache/graphCachePostgres';
import { loadJobQueueConfig } from '../config/jobQueueConfig';
import { JobType,GRAPH_JOB_TYPES, type Job } from './types';
import type { executeJob } from './executors';
import { withJobEffectExclusion, withJobOwnedEffect } from './jobEffectAdmission';
import { purgeOrgRepoIndex } from '../indexing/purgeOrgRepoIndex';
import path from 'node:path';
import os from 'node:os';
import { zoektShardFilePrefix } from '../indexing/zoektShardIdentity';
import { RepoStatsStore } from '../workspace/repoStatsStore';
import { RepoSymbolIndexStore } from '../indexing/repoSymbolIndexStore';
import { RepoEmbeddingsStore } from '../indexing/repoEmbeddingsStore';
import { RepoManifestStore } from '../manifest/repoManifestStore';
import { RepoDependencyEdgesStore } from '../indexing/repoDependencyEdgesStore';
import { OrgStore } from '../server/orgStore';
import { publishStagedZoektShards, runZoektIndexer } from './runZoektIndexer';
const {admitDisposableDatabaseTarget} = require('../../scripts/disposable-database-target.mjs') as {
  admitDisposableDatabaseTarget(value: string, expected: {port: string; database: string; user: string}): string;
};

const url = releaseDatabase;
const pool = new Pool({connectionString: url, ssl: false});
const config = {...loadJobQueueConfig({}), backend: 'postgres' as const, databaseUrl: url, schedules: []};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const backends: PostgresQueueBackend[] = [];
const workers: WorkerPool[] = [];
const fixtureOrg='00000000-0000-4000-8000-000000000808';
function queue() {
  const backend = new PostgresQueueBackend(url!); backends.push(backend);
  return new JobQueue(config, backend);
}
function worker(q: JobQueue, execute?: typeof executeJob, overrides: Partial<ConstructorParameters<typeof WorkerPool>[1]> = {}) {
  const cache = new PersistingGraphCache({pool});
  if(!execute) cache.setGraph(fixtureOrg,blankRepositoryGraph({repoId:'github:fixture/repo',owner:'fixture',repo:'repo',provider:'github'}));
  const w = new WorkerPool(q, {concurrency: 1, maxJobDurationMs: 2_000, leaseDurationMs: 500,
    heartbeatIntervalMs: 100, shutdownTimeoutMs: 500, retryPolicy: {maxRetries: 2, backoffMs: 15}, ...overrides}, {cache}, undefined, execute && (async(job,context,report,signal)=>{
      const result=await execute(job,context,report,signal);
      if(GRAPH_JOB_TYPES.includes(job.type)) await cache.publishJobGraph(job,blankRepositoryGraph({repoId:String(job.params.repoId),owner:'fixture',repo:'repo',provider:'github'}),undefined,signal);
      return result;
    }));
  workers.push(w); return w;
}
async function submit(q: JobQueue) {
  return (await q.createJob({type: JobType.GENERATE_REPO_SUMMARY, userId: 'eh08-fixture', bypassRateLimit: true,
    params: {orgId: fixtureOrg, repoId: 'github:fixture/repo'}})).jobId;
}
async function until(predicate: () => Promise<boolean>, bound = 3_000) {
  const deadline = Date.now() + bound;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(10); }
  throw new Error('Bounded worker fixture did not reach expected state');
}

if (process.env.EH08_CRASH_CHILD === 'true') {
  const q = queue(); const phase = process.env.EH08_CRASH_PHASE;
  const w = worker(q, async(job, _context, report) => {
    await report(20);
    if (phase === 'paused-live') {
      process.send?.({phase:'claimed',id:job.id});
      await new Promise<void>(resolve=>process.on('message',message=>{if(message==='resume-effect')resolve();}));
      try {
        await withJobOwnedEffect(pool,job,client=>new RepoStatsStore(client).upsertStats(String(job.params.orgId),String(job.params.repoId),{fileCount:999,lineCount:999,byteCount:999,languages:[],indexedAt:new Date()}));
        process.send?.({phase:'unsafe-effect-written'});
      } catch { process.send?.({phase:'stale-effect-refused'}); }
      await new Promise<void>(()=>undefined);
    }
    if (process.env.EH08_ACTUAL_EFFECT === 'true') {
      await withJobOwnedEffect(pool,job,async client=>{
        await new RepoStatsStore(client).upsertStats(String(job.params.orgId),String(job.params.repoId),{
          fileCount:1,lineCount:2,byteCount:3,languages:['fixture'],indexedAt:new Date()});
        process.send?.({phase:'written-uncommitted',id:job.id});
        if (phase==='before-commit') await new Promise<void>(()=>undefined);
      });
      process.send?.({phase:'committed',id:job.id});
      await new Promise<void>(()=>undefined);
    }
    process.send?.({phase: 'claimed', id: job.id, attemptId: job.attemptId});
    if (phase === 'after-effect') {
      await pool.query('INSERT INTO eh08_effect_probe(job_id, attempt_id) VALUES ($1,$2)', [job.id, job.attemptId]);
      process.send?.({phase: 'effect', id: job.id});
    }
    await new Promise<void>(() => undefined);
  });
  w.start(20);
} else {
  before(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await pool.query(fs.readFileSync('migrations/001_jobs.sql', 'utf8'));
    const legacy = randomUUID();
    await pool.query("INSERT INTO jobs(id,type,status,priority) VALUES ($1,'generate_repo_summary','running','normal')", [legacy]);
    for (const name of fs.readdirSync('migrations').filter(name => /^\d{3}_.*\.sql$/.test(name) && name !== '001_jobs.sql').sort()) {
      await pool.query(fs.readFileSync(path.join('migrations',name),'utf8'));
    }
    assert.equal((await pool.query('SELECT status FROM jobs WHERE id=$1', [legacy])).rows[0].status, 'failed');
    await pool.query('CREATE TABLE eh08_effect_probe(job_id uuid, attempt_id uuid)');
  });
  beforeEach(async () => { await pool.query('TRUNCATE job_results, jobs, job_rate_limits, eh08_effect_probe');
    await pool.query("INSERT INTO organizations(id,name) VALUES($1,'lease fixture') ON CONFLICT DO NOTHING",[fixtureOrg]);
  });
  afterEach(async () => { for (const w of workers) assert.equal(await w.stop(),true); });
  after(async () => {
    for (const w of workers) assert.equal(await w.stop(), true);
    for (const backend of backends) await backend.close();
    await pool.end();
  });

  test('atomic two-owner claims, restart cannot steal a renewing peer, actual summary executor', async () => {
    const q1=queue(), q2=queue(); const id=await submit(q1);
    const owners=[randomUUID(),randomUUID()];
    const claims=await Promise.all(owners.map((owner,i)=>(i?q2:q1).claimNext(owner,500)));
    assert.equal(claims.filter(Boolean).length,1);
    const active=claims.find(Boolean)!;
    assert.equal(active.leaseExpiresAt?.getTime(),(await pool.query('SELECT lease_expires_at FROM jobs WHERE id=$1',[id])).rows[0].lease_expires_at.getTime());
    assert.equal(await q2.reclaimExpired(2),0);
    assert.equal(await q1.renew(active,500),true);
    await q1.requeue(active,0,false);
    const w=worker(q2);w.start(10);
    await until(async()=> (await q1.getJob(id))?.status==='completed');
    const result=await q1.results.get(id);assert.equal((result?.result as {repoId:string}).repoId,'github:fixture/repo');
    assert.equal(await w.stop(),true);
  });

  test('expiry makes renewal/progress/completion/failure/retry and result/event writes stale', async()=>{
    const q=queue();const id=await submit(q);const old=(await q.claimNext(randomUUID(),500))!;
    await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
    assert.equal(await q.renew(old,500),false);
    assert.equal(await q.reclaimExpired(2),1);
    const fresh=(await q.claimNext(randomUUID(),500))!;assert.notEqual(fresh.attemptId,old.attemptId);
    let events=0;q.on('job:completed',()=>events++);
    assert.equal(await q.updateProgress(old,99),false);
    assert.equal(await q.completeJob(old,{marker:'stale'}),undefined);
    assert.equal(await q.failJob(old,'stale'),undefined);
    await q.requeue(old);assert.equal((await q.getJob(id))?.attemptId,fresh.attemptId);
    await q.completeJob(fresh,{marker:'fresh'});
    assert.equal(events,1);
    assert.equal((await pool.query('SELECT result FROM job_results WHERE job_id=$1',[id])).rows[0].result.marker,'fresh');
    assert.equal(await q.completeJob(old,{marker:'late'}),undefined);assert.equal(events,1);
  });

  test('concurrent completion versus cancellation has one durable terminal winner',async()=>{
    const q=queue();const id=await submit(q);const active=(await q.claimNext(randomUUID(),500))!;
    const [completed,cancelled]=await Promise.all([q.completeJob(active,{marker:'done'}),q.cancelJob(id,{includeRunning:true})]);
    assert.equal(Number(Boolean(completed))+Number(Boolean(cancelled)),1);
    const final=await q.getJob(id);assert.ok(['completed','cancelled'].includes(final!.status));
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM job_results WHERE job_id=$1',[id])).rows[0].n,completed?1:0);
  });

  test('worker renews a slow attempt and overlapping startup leaves it owned',async()=>{
    const q1=queue(),q2=queue();const id=await submit(q1);let release!:()=>void;
    const w1=worker(q1,async()=>{await new Promise<void>(r=>release=r);return {marker:'slow'};});w1.start(10);
    await until(async()=>w1.activeCount===1);const first=(await q1.getJob(id))!;
    await sleep(700);
    const w2=worker(q2);w2.start(10);await sleep(50);
    assert.equal((await q2.getJob(id))?.attemptId,first.attemptId);assert.equal(w2.activeCount,0);
    release();await until(async()=>(await q1.getJob(id))?.status==='completed');
    assert.equal(await w1.stop(),true);assert.equal(await w2.stop(),true);
  });

  for (const outcome of ['false', 'error'] as const) test(`settled attempt ignores late renewal ${outcome} and accepts following work`, async()=>{
    const q=queue(); const id=await submit(q); let releaseExecutor!:()=>void, releaseRenewal!:()=>void;
    let renewStarted=false, calls=0;
    const realRenew=q.renew.bind(q);
    q.renew=async(job,lease)=>{
      if (!renewStarted) { renewStarted=true; await new Promise<void>(r=>releaseRenewal=r); if(outcome==='error')throw new Error('late renewal fixture'); return false; }
      return realRenew(job,lease);
    };
    const w=worker(q,async()=>{if(++calls===1)await new Promise<void>(r=>releaseExecutor=r);return {marker:'done'};});w.start(10);
    await until(async()=>renewStarted); releaseExecutor();
    await until(async()=>w.activeCount===0 && (await q.getJob(id))?.status==='completed');
    assert.equal(w.acceptingWork,true);releaseRenewal();await sleep(30);assert.equal(w.acceptingWork,true);
    const next=await submit(q);await until(async()=>(await q.getJob(next))?.status==='completed');assert.equal(calls,2);
  });

  for (const outcome of ['false', 'error'] as const) test(`live attempt renewal ${outcome} still cancels lost ownership`, async()=>{
    const q=queue();await submit(q);let aborted=false;
    q.renew=async()=>{if(outcome==='error')throw new Error('live renewal fixture');return false;};
    const w=worker(q,async(_job,_ctx,_report,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true})));w.start(10);
    await until(async()=>aborted && w.activeCount===0);assert.equal(w.acceptingWork,false);
  });

  test('cancelled running job is not overwritten or retried and worker accepts following work',async()=>{
    const q=queue();const id=await submit(q);let calls=0;
    const w=worker(q,async(_job,_ctx,_report,signal)=>{
      if (++calls > 1) return {marker:'following-work'};
      await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    });w.start(10);await until(async()=>w.activeCount===1);
    assert.ok(await q.cancelJob(id,{includeRunning:true}));await until(async()=>w.activeCount===0);
    assert.equal((await q.getJob(id))?.status,'cancelled');assert.equal((await q.getJob(id))?.retryCount,0);
    const next=await submit(q);await until(async()=>(await q.getJob(next))?.status==='completed');assert.equal(calls,2);
    assert.equal(await w.stop(),true);
  });

  test('transient retry has durable backoff and bounded exhaustion, no orphan retry timers',async()=>{
    const q=queue();const id=await submit(q);let calls=0;
    const w=worker(q,async()=>{calls++;throw new Error('503 temporary upstream unavailable');});w.start(10);
    await until(async()=>(await q.getJob(id))?.status==='failed');
    assert.equal(calls,3);assert.equal((await q.getJob(id))?.retryCount,2);
    assert.equal(await w.stop(),true);await sleep(60);assert.equal((await q.getJob(id))?.status,'failed');
  });

  test('claim recovery retry exhaustion terminates poison crash work honestly',async()=>{
    const q=queue();const id=await submit(q);
    for(let n=0;n<3;n++){
      assert.ok(await q.claimNext(randomUUID(),500));
      await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
      assert.equal(await q.reclaimExpired(2),1);
    }
    assert.equal((await q.getJob(id))?.status,'failed');assert.equal(await q.claimNext(randomUUID(),500),undefined);
  });

  test('paused live effect attempt is quarantined; replacement and purge admission stay disabled',async()=>{
    const q1=queue(),q2=queue();
    const id=(await q1.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:fixtureOrg,repoId:'github:fixture/repo'},bypassRateLimit:true})).jobId;
    const old=(await q1.claimNext(randomUUID(),500))!;
    const next=(await q1.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:fixtureOrg,repoId:'github:fixture/replacement'},bypassRateLimit:true})).jobId;
    assert.equal(await q2.claimNext(randomUUID(),500),undefined);
    await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
    assert.equal(await q2.reclaimExpired(2),1);
    assert.equal((await q1.getJob(id))?.effectQuarantined,true);
    assert.equal((await q1.getJob(id))?.status,'failed');
    assert.equal(await q2.claimNext(randomUUID(),500),undefined);
    assert.equal((await q2.getJob(next))?.status,'queued');
    assert.equal(await q2.getBackend().delete(id),false);
    await assert.rejects(withJobEffectExclusion(pool,async()=>true),/termination and reconciliation/);
    assert.equal(await q1.completeJob(old,{marker:'late'}),undefined);
    assert.equal(await q1.renew(old,500),false);
  });

  test('simultaneous effect claims serialize admission; cancellation preserves quarantine',async()=>{
    const q1=queue(),q2=queue();
    for(let i=0;i<2;i++)await q1.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:fixtureOrg,repoId:`github:fixture/repo${i}`},bypassRateLimit:true});
    const claims=await Promise.all([q1.claimNext(randomUUID(),500),q2.claimNext(randomUUID(),500)]);
    assert.equal(claims.filter(Boolean).length,1);const active=claims.find(Boolean)!;
    assert.ok(await q1.cancelJob(active.id,{includeRunning:true}));
    assert.equal((await q2.getJob(active.id))?.effectQuarantined,true);
    assert.equal(await q2.claimNext(randomUUID(),500),undefined);
  });

  test('actual effect failure is quarantined once; transient retry cannot duplicate its committed write',async()=>{
    const org=randomUUID(),repo='github:fixture/no-retry';await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'no-retry','pro')",[org]);
    const q=queue();const id=(await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true})).jobId;let calls=0;
    const w=worker(q,async job=>{calls++;await withJobOwnedEffect(pool,job,client=>new RepoStatsStore(client).upsertStats(org,repo,{fileCount:1,lineCount:1,byteCount:1,languages:[],indexedAt:new Date()}));throw new Error('503 temporary after effect');});w.start(10);
    await until(async()=>(await q.getJob(id))?.status==='failed');assert.equal((await q.getJob(id))?.effectQuarantined,true);assert.equal(calls,1);assert.equal((await q.getJob(id))?.retryCount,0);
    await sleep(60);assert.equal(calls,1);assert.equal(await w.stop(),true);
  });

  test('SIGSTOP pauses a live worker heartbeat; quarantine prevents successor and SIGCONT stale actual-store write',async()=>{
    const org=randomUUID(),repo='github:fixture/paused';await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'paused','pro')",[org]);const q=queue();
    const id=(await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true})).jobId;
    const child=spawn(process.execPath,[process.argv[1]!],{cwd:process.cwd(),env:{...process.env,EH08_CRASH_CHILD:'true',EH08_CRASH_PHASE:'paused-live'},stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr!.on('data',x=>stderr+=x);
    const stage=(wanted:string)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Paused child bound '+stderr)),3_000);child.on('message',m=>{const phase=(m as {phase:string}).phase;if(phase==='unsafe-effect-written'){clearTimeout(timer);reject(new Error('Stale effect wrote'));}if(phase===wanted){clearTimeout(timer);resolve();}});});
    try{
      await stage('claimed');child.kill('SIGSTOP');await sleep(750);
      assert.equal(await q.reclaimExpired(2),1);assert.equal((await q.getJob(id))?.effectQuarantined,true);
      await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true});assert.equal(await q.claimNext(randomUUID(),500),undefined);
      await assert.rejects(withJobEffectExclusion(pool,async()=>true),/termination and reconciliation/);
      const refused=stage('stale-effect-refused');child.kill('SIGCONT');child.send('resume-effect');await refused;
      assert.equal(await new RepoStatsStore(pool).loadStats(org,repo),undefined);
    }finally{const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));if(child.exitCode===null&&child.signalCode===null){child.kill('SIGCONT');child.kill('SIGKILL');await ended;}}
  });

  test('actual index purge uses one transaction and protects another tenant and shard',async()=>{
    const org=randomUUID(),other=randomUUID(),repo='github:fixture/repo';
    await pool.query("INSERT INTO organizations(id,name,plan) VALUES ($1,'fixture','pro'),($2,'foreign','pro')",[org,other]);
    for(const id of [org,other])await pool.query('INSERT INTO graph_snapshots(org_id,repo_id,payload) VALUES ($1,$2,$3)',[id,repo,JSON.stringify({marker:id})]);
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'eh08-own-shards-'));const previous=process.env.ZOEKT_INDEX_PATH;process.env.ZOEKT_INDEX_PATH=root;
    const own=path.join(root,zoektShardFilePrefix(org,repo)+'_v16.00000.zoekt');
    const foreign=path.join(root,zoektShardFilePrefix(other,repo)+'_v16.00000.zoekt');fs.writeFileSync(own,'own');fs.writeFileSync(foreign,'foreign');
    try{
      const purged=await purgeOrgRepoIndex(pool,org,repo);assert.equal(purged.purged,true);assert.equal(purged.zoektShardsRemoved,1);
      assert.equal(fs.existsSync(own),false);assert.equal(fs.existsSync(foreign),true);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM graph_snapshots WHERE org_id=$1',[org])).rows[0].n,0);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM graph_snapshots WHERE org_id=$1',[other])).rows[0].n,1);
    }finally{if(previous===undefined)delete process.env.ZOEKT_INDEX_PATH;else process.env.ZOEKT_INDEX_PATH=previous;fs.rmSync(root,{recursive:true,force:true});}
  });

  for(const mode of ['success','unavailable','indexer-failure','second-rename-failure','commit-ambiguity'] as const) test(`actual Zoekt caller and worker preserve ${mode} outcome`,async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'eh08-zoekt-outcome-'));const bin=path.join(root,'bin'),indexRoot=path.join(root,'index');fs.mkdirSync(bin);fs.mkdirSync(indexRoot);
    const org=randomUUID(),repo='github:fixture/zoekt';await pool.query("INSERT INTO organizations(id,name) VALUES($1,'Zoekt fixture')",[org]);const prefix=zoektShardFilePrefix(org,repo)+'_v16.';
    const prior={path:process.env.PATH,index:process.env.ZOEKT_INDEX_PATH,prefix:process.env.EH08_ZOEKT_PREFIX,fail:process.env.EH08_ZOEKT_FAIL};
    fs.writeFileSync(path.join(bin,'zoekt-git-index'),`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');if(process.env.EH08_ZOEKT_FAIL==='true')process.exit(1);const out=process.argv[process.argv.indexOf('-index')+1];for(const n of ['00000','00001'])fs.writeFileSync(path.join(out,process.env.EH08_ZOEKT_PREFIX+n+'.zoekt'),'fixture-'+n);`,{mode:0o700});
    process.env.PATH=bin+path.delimiter+prior.path;process.env.ZOEKT_INDEX_PATH=indexRoot;process.env.EH08_ZOEKT_PREFIX=prefix;process.env.EH08_ZOEKT_FAIL=String(mode==='indexer-failure');
    if(mode==='unavailable')delete process.env.ZOEKT_INDEX_PATH;
    if(mode==='second-rename-failure')fs.mkdirSync(path.join(indexRoot,prefix+'00001.zoekt'));
    const q=queue();const id=(await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true})).jobId;
    let calls=0,publicationCommitted=false;
    const publicationPool=mode!=='commit-ambiguity'?pool:({connect:async()=>{
      const client=await pool.connect();return {release:()=>client.release(),query:async(sql:string,values?:unknown[])=>{
        const result=await client.query(sql,values);if(sql==='COMMIT'){publicationCommitted=true;throw new Error('fixture connection lost after commit');}return result;
      }};
    }} as unknown as Pool);
    const w=worker(q,async(job,_ctx,_report,signal)=>{calls++;return runZoektIndexer(repo,org,root,{job,pool:publicationPool,signal});});
    try{
      w.start(10);await until(async()=>['completed','failed'].includes((await q.getJob(id))?.status??''));
      const final=(await q.getJob(id))!;
      if(mode==='second-rename-failure'||mode==='commit-ambiguity'){
        assert.equal(final.status,'failed');assert.equal(final.effectQuarantined,true);assert.match(final.error??'',/Zoekt shard publication failed/);
        assert.equal(fs.existsSync(path.join(indexRoot,prefix+'00000.zoekt')),true);
        assert.equal(fs.readdirSync(indexRoot).filter(n=>n.startsWith('.attempt-')).length,1,'reconciliation evidence retained');
        if(mode==='commit-ambiguity')assert.equal(publicationCommitted,true);
        assert.equal((await q.results.get(id))?.result,undefined);
        await assert.rejects(withJobEffectExclusion(pool,async()=>true),/termination and reconciliation/);
        await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true});assert.equal(await q.claimNext(randomUUID(),500),undefined);
        await sleep(50);assert.equal(calls,1);assert.equal(final.retryCount,0);
      }else{
        assert.equal(final.status,'completed');assert.equal(final.effectQuarantined,false);
        assert.equal((await q.results.get(id))?.result && ((await q.results.get(id))!.result as {zoektAvailable:boolean}).zoektAvailable,mode==='success');
        assert.equal(fs.readdirSync(indexRoot).filter(n=>n.startsWith('.attempt-')).length,0);
      }
    }finally{
      assert.equal(await w.stop(),true);
      for(const [key,value]of Object.entries({PATH:prior.path,ZOEKT_INDEX_PATH:prior.index,EH08_ZOEKT_PREFIX:prior.prefix,EH08_ZOEKT_FAIL:prior.fail})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
      fs.rmSync(root,{recursive:true,force:true});
    }
  });

  test('actual DB index stores and status require the same locked admitted attempt; stale writes are refused',async()=>{
    const org=randomUUID(),repo='github:fixture/fenced';
    await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'fenced','pro')",[org]);
    const q=queue();await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true});
    const job=(await q.claimNext(randomUUID(),5_000))!;
    const store=new OrgStore(pool);
    let forgedEntered=false;
    await assert.rejects(withJobOwnedEffect(pool,{...job,params:{...job.params,orgId:randomUUID()}},async()=>{forgedEntered=true;}),/lost ownership/);
    assert.equal(forgedEntered,false);
    await withJobOwnedEffect(pool,job,async client=>{
      await new RepoStatsStore(client).upsertStats(org,repo,{fileCount:1,lineCount:2,byteCount:3,languages:['fixture'],indexedAt:new Date()});
      await new RepoSymbolIndexStore(client).replaceIndex(org,repo,[{symbol:'fixture',filePath:'fixture.ts',lineStart:1,lineEnd:1,kind:'function',references:[]}],new Date());
      await new RepoEmbeddingsStore(client).replaceForRepo(org,repo,[{filePath:'fixture.ts',chunkIndex:0,chunkText:'private fixture',embedding:new Array(1536).fill(0)}],new Date());
      await new RepoManifestStore(client).upsertManifestRows(org,repo,[{filePath:'fixture.ts',symbols:[]}],new Date());
      await new RepoDependencyEdgesStore(pool).replaceEdges(org,repo,[{fromPath:'fixture.ts',toPath:'dependency.ts',kind:'import',source:'import-parse'}],new Date(),client);
      await store.upsertOrgRepo(org,repo,{indexStatus:'ready',lastJobId:job.id},client);
    });
    for(const table of ['repo_stats','repo_symbol_index','repo_embeddings','repo_manifests','repo_dependency_edges','org_repos']) {
      assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE org_id=$1 AND repo_id=$2`,[org,repo])).rows[0].n,1);
    }
    await assert.rejects(withJobOwnedEffect(pool,job,async client=>{
      await new RepoDependencyEdgesStore(pool).replaceEdges(org,repo,[],new Date(),client);
      await new RepoStatsStore(client).upsertStats(org,repo,{fileCount:999,lineCount:999,byteCount:999,languages:[],indexedAt:new Date()});
      throw new Error('Fixture rollback after actual store writes');
    }),/Fixture rollback/);
    assert.equal((await new RepoStatsStore(pool).loadStats(org,repo))?.fileCount,1);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM repo_dependency_edges WHERE org_id=$1 AND repo_id=$2',[org,repo])).rows[0].n,1);
    await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
    let entered=false;
    await assert.rejects(withJobOwnedEffect(pool,job,async client=>{entered=true;await new RepoStatsStore(client).deleteForRepo(org,repo);}),/lost ownership/);
    assert.equal(entered,false);assert.equal((await new RepoStatsStore(pool).loadStats(org,repo))?.fileCount,1);
    const controller=new AbortController();controller.abort();
    await assert.rejects(withJobOwnedEffect(pool,job,async()=>{entered=true;},controller.signal));assert.equal(entered,false);
  });

  test('cancellation waits for an already authorized DB effect transaction; no later effect is admitted',async()=>{
    const org=randomUUID(),repo='github:fixture/transaction';await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'transaction','pro')",[org]);
    const q=queue();await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true});const job=(await q.claimNext(randomUUID(),5_000))!;
    let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);
    const effect=withJobOwnedEffect(pool,job,async client=>{await new RepoStatsStore(client).upsertStats(org,repo,{fileCount:7,lineCount:8,byteCount:9,languages:[],indexedAt:new Date()});entered();await new Promise<void>(r=>release=r);});
    await started;let cancelled=false;const cancel=q.cancelJob(job.id,{includeRunning:true}).then(result=>{cancelled=true;return result;});await sleep(30);assert.equal(cancelled,false);
    release();await effect;assert.ok(await cancel);assert.equal((await new RepoStatsStore(pool).loadStats(org,repo))?.fileCount,7);
    await assert.rejects(withJobOwnedEffect(pool,job,async client=>new RepoStatsStore(client).deleteForRepo(org,repo)),/lost ownership/);
  });

  test('actual staged shard publication rejects foreign names and stale attempts before rename',async()=>{
    const org=randomUUID(),repo='github:fixture/shards';await pool.query("INSERT INTO organizations(id,name) VALUES($1,'shard fixture')",[org]);const q=queue();await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true});const job=(await q.claimNext(randomUUID(),5_000))!;
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'eh08-owned-shards-'));const stage=path.join(root,'.attempt-'+job.attemptId);fs.mkdirSync(stage);const name=zoektShardFilePrefix(org,repo)+'_v16.00000.zoekt';fs.writeFileSync(path.join(stage,name),'fixture');
    try{
      await withJobOwnedEffect(pool,job,async()=>publishStagedZoektShards(root,stage,org,repo));assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'fixture');
      fs.writeFileSync(path.join(stage,name),'stale');await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
      await assert.rejects(withJobOwnedEffect(pool,job,async()=>publishStagedZoektShards(root,stage,org,repo)),/lost ownership/);assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'fixture');
      fs.writeFileSync(path.join(stage,'foreign_v16.00000.zoekt'),'foreign');assert.throws(()=>publishStagedZoektShards(root,stage,org,repo),/safely scoped/);assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'fixture');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });

  for(const phase of ['before-commit','after-commit'])test(`actual worker SIGKILL ${phase} around RepoStatsStore transaction; effect recovery stays quarantined`,async()=>{
    const org=randomUUID(),repo='github:fixture/crash';await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'crash','pro')",[org]);
    const q=queue();const id=(await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true})).jobId;
    const child=spawn(process.execPath,[process.argv[1]!],{cwd:process.cwd(),env:{...process.env,EH08_CRASH_CHILD:'true',EH08_ACTUAL_EFFECT:'true',EH08_CRASH_PHASE:phase},stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr!.on('data',x=>stderr+=x);
    try{
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Actual effect child bound '+stderr)),3_000);child.on('message',m=>{if((m as {phase:string}).phase===(phase==='before-commit'?'written-uncommitted':'committed')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Actual effect child early exit '+stderr));});});
      const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended;
      await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);assert.equal(await q.reclaimExpired(2),1);
      assert.equal((await q.getJob(id))?.effectQuarantined,true);assert.equal((await q.getJob(id))?.status,'failed');
      const stored=await new RepoStatsStore(pool).loadStats(org,repo);assert.equal(Boolean(stored),phase==='after-commit');
      await q.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:org,repoId:repo},bypassRateLimit:true});assert.equal(await q.claimNext(randomUUID(),500),undefined);
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  });

  test('bounded shutdown retains the slot for an abort-ignoring executor; no overlapping replacement',async()=>{
    const q=queue();const id=await submit(q);await submit(q);let release!:()=>void;let calls=0;
    const w=worker(q,async()=>{calls++;await new Promise<void>(r=>release=r);return {};},{maxJobDurationMs:100});w.start(5);
    await until(async()=>w.activeCount===1);await sleep(130);
    assert.equal(calls,1);assert.equal(await w.stop(30),false);assert.equal(w.activeCount,1);
    release();await until(async()=>w.activeCount===0);assert.equal(await w.stop(),true);
    assert.equal((await q.getJob(id))?.status,'queued');assert.equal(calls,1);
  });

  test('actual built workerEntry registers its artifact and retires presence on clean SIGTERM',async()=>{
    const fleetId='artifact-'+randomUUID();
    const expectedHash=createHash('sha256').update(fs.readFileSync('dist/workerEntry.js')).digest('hex');
    const child=spawn(process.execPath,['dist/workerEntry.js'],{cwd:process.cwd(),env:{PATH:process.env.PATH,
      NODE_ENV:'test',DATABASE_URL:url,DATABASE_SSL:'false',JOBS_BACKEND:'postgres',JOBS_WORKER_CONCURRENCY:'1',
      COOP_WORKER_FLEET_ID:fleetId,
      GRAPH_CACHE_BACKEND:'memory',PORT:'56549'},stdio:['ignore','pipe','pipe']});
    const closed=new Promise<number|null>(resolve=>child.once('close',code=>resolve(code)));
    let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
    try{
      await until(async()=>{try{return (await fetch('http://127.0.0.1:56549/health')).status===200;}catch{return false;}},5_000);
      const rows=(await pool.query('SELECT bundle_sha256,accepting_work FROM worker_presence WHERE fleet_id=$1',[fleetId])).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].bundle_sha256,expectedHash);assert.equal(rows[0].accepting_work,true);
      child.kill('SIGTERM');
      const code=await Promise.race([closed,new Promise<'bound'>(resolve=>{const timer=setTimeout(()=>resolve('bound'),3_000);timer.unref();})]);
      assert.equal(code,0,output);
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM worker_presence WHERE fleet_id=$1',[fleetId])).rows[0].n,0);
    }finally{
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
      await closed;
      await pool.query('DELETE FROM worker_presence WHERE fleet_id=$1',[fleetId]);
    }
  });

  for(const phase of ['before-effect','after-effect'])test(`SIGKILL ${phase} leaves a recoverable attempt; replay effects explicitly unqualified`,async()=>{
    const q=queue();const id=await submit(q);
    const child=spawn(process.execPath,[process.argv[1]!],{
      cwd:process.cwd(),env:{...process.env,EH08_CRASH_CHILD:'true',EH08_CRASH_PHASE:phase},stdio:['ignore','ignore','pipe','ipc']});
    let stderr='';child.stderr!.on('data',x=>stderr+=x);
    const wanted=phase==='after-effect'?'effect':'claimed';
    try {
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Child claim/effect bound: '+stderr)),3_000);
        child.on('message',m=>{if((m as {phase:string}).phase===wanted){clearTimeout(timer);resolve();}});
        child.once('exit',()=>{clearTimeout(timer);reject(new Error('Child exited before stage: '+stderr));});
      });
      const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;
      await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
      const w=worker(q,async job=>{await pool.query('INSERT INTO eh08_effect_probe(job_id,attempt_id) VALUES ($1,$2)',[job.id,job.attemptId]);return {marker:'recovered'};});w.start(10);
      await until(async()=>(await q.getJob(id))?.status==='completed');assert.equal(await w.stop(),true);
      const effects=(await pool.query('SELECT COUNT(*)::int AS n FROM eh08_effect_probe WHERE job_id=$1',[id])).rows[0].n;
      assert.equal(effects,phase==='after-effect'?2:1,'Queue ownership deliberately does not claim effect idempotency');
    } finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  });
}

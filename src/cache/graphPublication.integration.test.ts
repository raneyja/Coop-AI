// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'graph');
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {before,after,test} from 'node:test';
import {Pool} from 'pg';
import {GraphCache,blankRepositoryGraph,type RepositoryGraph} from './graphCache';
import {PersistingGraphCache} from './graphCachePostgres';
import {JobQueue} from '../jobs/jobQueue';
import {MemoryQueueBackend} from '../jobs/backends/memoryBackend';
import {PostgresQueueBackend} from '../jobs/backends/postgresBackend';
import {WorkerPool} from '../jobs/workerPool';
import {JobType,type Job} from '../jobs/types';
import {loadJobQueueConfig} from '../config/jobQueueConfig';
import {withJobOwnedEffect} from '../jobs/jobEffectAdmission';
import {executeJob} from '../jobs/executors';
import {OrgStore} from '../server/orgStore';
import {queueOrgRepoIndex} from '../server/queueOrgRepoIndex';
import {purgeOrgRepoIndex} from '../indexing/purgeOrgRepoIndex';
import {closeDbPool} from '../server/db';
const {admitDisposableDatabaseTarget}=require('../../scripts/disposable-database-target.mjs') as {
  admitDisposableDatabaseTarget(value:string,expected:{port:string;database:string;user:string}):string;
};
const {runMigrations}=require(path.resolve('scripts/run-migrations.mjs')) as {
  runMigrations(options:{databaseUrl:string;migrationsDir:string;log:(text:string)=>void}):Promise<void>;
};
const target = releaseDatabase;
const admin=new Pool({connectionString:target,ssl:false}); // Only after ALL admissions.
const observations:Record<string,unknown>[]=[];
let sequence=0;
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>Promise<boolean>,ms=5000) {const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await sleep(5);}throw new Error('Local fixture condition not reached');}
const capture=(promise:Promise<unknown>)=>promise.then(()=>null,error=>error as Error);
const modelEnv=['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY','MISTRAL_API_KEY','DEEPSEEK_API_KEY','ZOEKT_INDEX_PATH'];
for(const key of modelEnv) delete process.env[key];
process.env.DATABASE_SSL='false';process.env.PGSSLMODE='disable';
const forbiddenFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('No external HTTP permitted in graph fixture');};
before(async()=>{await until(async()=>{try{await admin.query('SELECT 1');return true;}catch{return false;}});});
after(async()=>{
  await closeDbPool();await admin.end();globalThis.fetch=forbiddenFetch;
  if(process.env.EH08_GRAPH_RESULTS)fs.writeFileSync(process.env.EH08_GRAPH_RESULTS,JSON.stringify({scope:'ACTUAL_LOCAL_PG_QUEUE_CACHE_WORKER_SYNTHETIC_FIXTURES',observations,providers:0,externalHttp:0},null,2)+'\n');
});
async function fixture(fn:(f:{pool:Pool;backend:PostgresQueueBackend;queue:JobQueue;cache:PersistingGraphCache;store:OrgStore;orgId:string;repoId:string;url:string})=>Promise<void>) {
  const name=`eh08${process.pid}${++sequence}_disposable`,url=new URL(target);url.pathname='/'+name;
  const admitted=admitDisposableDatabaseTarget(url.toString(),{port:new URL(releaseDatabase).port,database:name,user:'eh02'});
  await admin.query(`CREATE DATABASE ${name}`);
  let pool:Pool|undefined,backend:PostgresQueueBackend|undefined,cache:PersistingGraphCache|undefined;
  try {
    await runMigrations({databaseUrl:admitted,migrationsDir:path.resolve('migrations'),log:()=>undefined});
    pool=new Pool({connectionString:admitted,ssl:false,max:8,application_name:'eh08-graph-control'});
    backend=new PostgresQueueBackend(admitted);
    const queue=new JobQueue({...loadJobQueueConfig({}),backend:'postgres',databaseUrl:admitted,schedules:[]},backend);
    cache=new PersistingGraphCache({pool});cache.bindJobQueue(queue);
    const orgId=randomUUID(),repoId='github:fictional/graph';
    await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'artificial graph fixture','free')",[orgId]);
    const store=new OrgStore(pool,'a'.repeat(64));
    process.env.DATABASE_URL=admitted;
    await fn({pool,backend,queue,cache,store,orgId,repoId,url:admitted});
  }finally {
    // Preserve observed failures in results; no author/customer/quarantine fixture
    // is adopted. This whole uniquely created database is a disposable test.
    await cache?.close().catch(()=>undefined);await closeDbPool();await backend?.close();await pool?.end();
    // pg Pool.end closes sockets locally before server backend teardown is
    // necessarily visible. Observe settlement; do not FORCE-kill closing peers.
    await until(async()=>Number((await admin.query('SELECT count(*) n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n)===0);
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  }
}
function graph(repoId:string,marker='fixture'):RepositoryGraph {
 const value=blankRepositoryGraph({repoId,owner:'fictional',repo:'graph',provider:'github'});
 value.fileTree=[{path:marker+'.md',size:4,lastModified:new Date(),lastAuthor:'fictional',sha:'fixture'}];return value;
}
async function claim(queue:JobQueue,orgId:string,repoId:string,type=JobType.INDEX_REPOSITORY,lease=10000):Promise<Job> {
 await queue.createJob({type,userId:'fictional-actor',params:{orgId,repoId},bypassRateLimit:true});
 const job=await queue.claimNext(randomUUID(),lease);assert.ok(job);return job;
}
async function persisted(pool:Pool,orgId:string,repoId:string) {return (await pool.query('SELECT * FROM graph_snapshots WHERE org_id=$1 AND repo_id=$2',[orgId,repoId])).rows[0];}

test('canonical target overrides reject without DB construction',()=>{
 for(const suffix of ['?host=foreign.invalid','?port=5432','?database=customer','?options=-csearch_path=customer','#fragment','?HOST=127.0.0.1']) {
  assert.throws(()=>admitDisposableDatabaseTarget(target+suffix,{port:new URL(releaseDatabase).port,database:'eh02_disposable',user:'eh02'}));
 }
 observations.push({case:'pure-target-override-rejection',connections:0});
});
test('actual submission dedup, generation, org status and restart identity',()=>fixture(async f=>{
 const pair=await Promise.all([queueOrgRepoIndex(f.orgId,f.repoId,{orgStore:f.store,jobQueue:f.queue}),queueOrgRepoIndex(f.orgId,f.repoId,{orgStore:f.store,jobQueue:f.queue})]);
 assert.equal(new Set(pair.map(x=>'jobId'in x?x.jobId:undefined)).size,1);
 const jobs=await f.queue.listAllJobs();assert.equal(jobs.length,1);assert.equal(jobs[0].graphGenerations?.[0].generation,'1');
 assert.equal((await f.store.getOrgRepo(f.orgId,f.repoId))?.lastJobId,jobs[0].id);
 const second=new PostgresQueueBackend(f.url);try {assert.deepEqual((await second.get(jobs[0].id))?.graphGenerations,jobs[0].graphGenerations);}finally{await second.close();}
 observations.push({case:'atomic-submit-dedup-and-restart',jobs:1,generation:'1'});
}));
test('job publication uses immutable bytes and same-client READY, no intermediate memory',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId),draft=graph(f.repoId,'original');
 const blocker=await f.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE',[f.orgId,f.repoId]);
 const pending=capture(f.cache.publishJobGraph(job,draft,{store:f.store,patch:{indexStatus:'ready',lastJobId:job.id}},new AbortController().signal));
 await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n)>0);
 assert.equal(f.cache.getGraph(f.orgId,f.repoId),undefined);assert.equal(await persisted(f.pool,f.orgId,f.repoId),undefined);
 assert.notEqual((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');
 draft.repoId='github:foreign/mutated';draft.fileTree[0].path='mutated.md';
 await blocker.query('COMMIT');blocker.release();assert.equal(await pending,null);
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).payload.fileTree[0].path,'original.md');
 assert.equal((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');
 await f.cache.assertJobPublished(job);assert.ok(await f.queue.completeJob(job,{marker:'fixture'}));
 observations.push({case:'immutable-final-job-plus-ready',privateWhileBlocked:true,actualPg:true});
}));
test('foreign standalone buffer is never flushed under live job authority',()=>fixture(async f=>{
 const other=randomUUID();await f.pool.query("INSERT INTO organizations(id,name) VALUES($1,'fictional other tenant')",[other]);
 f.cache.setGraph(other,'github:fictional/foreign'===f.repoId?graph(f.repoId):graph('github:fictional/foreign','foreign'));
 const job=await claim(f.queue,f.orgId,f.repoId);await f.cache.publishJobGraph(job,graph(f.repoId));
 assert.equal(await persisted(f.pool,other,'github:fictional/foreign'),undefined);assert.equal(f.cache.getPersistenceState().pending,1);
 await assert.rejects(f.cache.flush(),/reconciliation|termination/);
 assert.ok(await f.queue.completeJob(job,{}));await f.cache.flush();assert.ok(await persisted(f.pool,other,'github:fictional/foreign'));
 observations.push({case:'foreign-buffer-remains-standalone',pendingUntilJobTerminal:true});
}));
test('fault rolls graph and READY back together; async failure does not complete',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId);
 await f.pool.query("CREATE FUNCTION reject_graph() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture graph fault'; END $$; CREATE TRIGGER reject_graph BEFORE INSERT OR UPDATE ON graph_snapshots FOR EACH ROW EXECUTE FUNCTION reject_graph()");
 await assert.rejects(f.cache.publishJobGraph(job,graph(f.repoId),{store:f.store,patch:{indexStatus:'ready'}}),/fixture graph fault/);
 assert.equal(await persisted(f.pool,f.orgId,f.repoId),undefined);assert.notEqual((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');
 await assert.rejects(f.cache.assertJobPublished(job),/without confirmed/);
 assert.equal((await f.queue.getJob(job.id))?.status,'running');observations.push({case:'graph-ready-atomic-fault',completed:false});
}));
test('older completed/live/queued writers cannot overwrite newer logical generation',()=>fixture(async f=>{
 const first=await claim(f.queue,f.orgId,f.repoId,JobType.BUILD_DEPENDENCY_GRAPH);
 await f.cache.publishJobGraph(first,graph(f.repoId,'first'));assert.ok(await f.queue.completeJob(first,{}));
 const next=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY);await f.cache.publishJobGraph(next,graph(f.repoId,'next'));
 await assert.rejects(f.cache.publishJobGraph(first,graph(f.repoId,'late-old')),/lost ownership/);
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).payload.fileTree[0].path,'next.md');
 await f.queue.createJob({type:JobType.BUILD_DEPENDENCY_GRAPH,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true,userId:'fictional-actor'});
 await assert.rejects(f.cache.publishJobGraph(next,graph(f.repoId,'old-live')),/superseded/);
 await assert.rejects(f.queue.completeJob(next,{}),/superseded/);
 const oldQueued=(await f.queue.listAllJobs()).find(j=>j.status==='queued');assert.ok(oldQueued);
 await f.queue.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 // The old active INDEX is already superseded; a new logical submission must not attach to it.
 assert.equal((await f.queue.getJob(oldQueued.id))?.status,'cancelled');
 observations.push({case:'old-completed-and-live-fenced',actualPg:true});
}));
test('queued generation supersession and dependency reuse remain current and tenant bound',()=>fixture(async f=>{
 const old=await f.queue.createJob({type:JobType.BUILD_DEPENDENCY_GRAPH,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 await f.queue.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 assert.equal((await f.queue.getJob(old.jobId))?.status,'cancelled');
 const live=await f.queue.claimNext(randomUUID(),10000);assert.equal(live?.type,JobType.INDEX_REPOSITORY);
 observations.push({case:'queued-old-cancelled-without-quarantine-clear'});
}));
test('stale standalone CAS cannot overwrite a later job, and failure/remainder are retained',()=>fixture(async f=>{
 const replica=new PersistingGraphCache({pool:f.pool});replica.setGraph(f.orgId,graph(f.repoId,'old-buffer'));
 const job=await claim(f.queue,f.orgId,f.repoId);await f.cache.publishJobGraph(job,graph(f.repoId,'new-job'));await f.queue.completeJob(job,{});
 await assert.rejects(replica.flush(),/conflicted/);assert.equal(replica.getPersistenceState().pending,1);
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).payload.fileTree[0].path,'new-job.md');
 await assert.rejects(replica.close());observations.push({case:'stale-replica-buffer-retained',noRebase:true});
}));
test('captured standalone payload and failed remainder retry preserve generic contract',()=>fixture(async f=>{
 const first=graph(f.repoId,'captured');f.cache.setGraph(f.orgId,first);first.fileTree[0].path='later-mutation.md';
 f.cache.setGraph(f.orgId,graph('github:fictional/remainder','remainder'));
 await f.pool.query("CREATE FUNCTION reject_graph() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture generic fault'; END $$; CREATE TRIGGER reject_graph BEFORE INSERT OR UPDATE ON graph_snapshots FOR EACH ROW EXECUTE FUNCTION reject_graph()");
 await assert.rejects(f.cache.flush(),/generic fault/);assert.equal(f.cache.getPersistenceState().pending,2);
 await f.pool.query('DROP TRIGGER reject_graph ON graph_snapshots');await f.cache.flush();
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).payload.fileTree[0].path,'captured.md');
 assert.equal(f.cache.getPersistenceState().pending,0);assert.equal(f.cache.getPersistenceState().failed,false);
 observations.push({case:'generic-bytes-fault-remainder-retry',retained:2});
}));
test('timer failure is tracked without unhandled rejection and close fails honestly',()=>fixture(async f=>{
 const unhandled:unknown[]=[];const listener=(error:unknown)=>unhandled.push(error);process.on('unhandledRejection',listener);
 try {
  await f.pool.query("CREATE FUNCTION reject_graph() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture timer fault'; END $$; CREATE TRIGGER reject_graph BEFORE INSERT OR UPDATE ON graph_snapshots FOR EACH ROW EXECUTE FUNCTION reject_graph()");
  f.cache.setGraph(f.orgId,graph(f.repoId));await until(async()=>f.cache.getPersistenceState().failed);
  assert.equal(unhandled.length,0);assert.equal(f.cache.getPersistenceState().pending,1);await assert.rejects(f.cache.close(),/timer fault/);
 }finally{process.removeListener('unhandledRejection',listener);}
 observations.push({case:'timer-fault-tracked-no-crash',unhandled:0});
}));
test('all real generic mutators and deletion persist, retaining public synchronous signatures',()=>fixture(async f=>{
 const ref={repoId:f.repoId,owner:'fictional',repo:'graph',provider:'github' as const};
 f.cache.upsertRepository(f.orgId,ref);f.cache.updateFiles(f.orgId,ref,[{path:'a.ts',status:'added',size:3}]);
 f.cache.setDependencies(f.orgId,f.repoId,[{from:'a.ts',to:'a.ts',type:'import'}]);
 f.cache.addCommits(f.orgId,ref,[{sha:'fixture',message:'fixture',author:'fixture',date:new Date(),files:['a.ts']}]);
 f.cache.upsertPullRequest(f.orgId,ref,{id:'pr',number:1,title:'fixture',state:'open',author:'fixture',updatedAt:new Date(),linkedIssues:[]});
 f.cache.upsertIssue(f.orgId,ref,{id:'issue',number:1,title:'fixture',state:'open',author:'fixture',updatedAt:new Date(),linkedFiles:[]});
 f.cache.upsertReview(f.orgId,ref,{id:'review',pullRequestNumber:1,author:'fixture',state:'approved',submittedAt:new Date(),comments:[]});
 f.cache.addSlackDecision(f.orgId,f.repoId,{id:'slack',timestamp:new Date(),channelId:'fixture',userId:'fixture',decisionKeywords:['fixture'],linkedRefs:[]});
 await f.cache.flush();const row=await persisted(f.pool,f.orgId,f.repoId);assert.equal(row.payload.fileTree.length,1);assert.equal(row.payload.reviews.length,1);assert.equal(row.payload.slackDecisions.length,1);
 f.cache.deleteGraph(f.orgId,f.repoId);await f.cache.flush();assert.equal(await persisted(f.pool,f.orgId,f.repoId),undefined);
 observations.push({case:'generic-mutators-and-delete',mutators:9});
}));
test('purge advances durable tombstone and rejects late generic resurrection',()=>fixture(async f=>{
 f.cache.setGraph(f.orgId,graph(f.repoId));await f.cache.flush();
 const stale=new PersistingGraphCache({pool:f.pool});await stale.ensureLoaded(f.orgId,f.repoId);stale.setGraph(f.orgId,graph(f.repoId,'late'));
 await purgeOrgRepoIndex(f.pool,f.orgId,f.repoId,{graphCache:f.cache});
 await assert.rejects(stale.flush(),/conflicted/);assert.equal(await persisted(f.pool,f.orgId,f.repoId),undefined);
 const head=(await f.pool.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2',[f.orgId,f.repoId])).rows[0];assert.equal(head.tombstone,true);assert.equal(head.requested_generation,head.published_generation);
 await f.cache.ensureLoaded(f.orgId,f.repoId);assert.equal(f.cache.getGraph(f.orgId,f.repoId),undefined);
 await stale.close().catch(()=>undefined);observations.push({case:'purge-tombstone-no-resurrection'});
}));
test('read replicas refresh local hits and a late hydrate cannot roll back a confirmed publication',()=>fixture(async f=>{
 f.cache.setGraph(f.orgId,graph(f.repoId,'old'));await f.cache.flush();
 const reader=new PersistingGraphCache({pool:f.pool});await reader.ensureLoaded(f.orgId,f.repoId);assert.equal(reader.getGraph(f.orgId,f.repoId)?.fileTree[0].path,'old.md');
 const job=await claim(f.queue,f.orgId,f.repoId);await f.cache.publishJobGraph(job,graph(f.repoId,'new'));
 await reader.ensureLoaded(f.orgId,f.repoId);assert.equal(reader.getGraph(f.orgId,f.repoId)?.fileTree[0].path,'new.md');
 await reader.hydrateOrg(f.orgId);assert.equal(reader.getGraph(f.orgId,f.repoId)?.fileTree[0].path,'new.md');
 await f.queue.createJob({type:JobType.BUILD_DEPENDENCY_GRAPH,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 await reader.ensureLoaded(f.orgId,f.repoId);assert.equal(reader.getFileTree(f.orgId,f.repoId)?.stale,true);
 await reader.close();observations.push({case:'durable-hit-freshness-requested-stale'});
}));
test('post-lock and precommit lease/Stop/generation guards retain atomic rollback',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY,250);
 const lock=await f.pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[job.id]);
 let entered=false;const waiting=capture(withJobOwnedEffect(f.pool,job,async()=>{entered=true;}));
 await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n)>0);
 await sleep(300);await lock.query('COMMIT');lock.release();assert.match((await waiting)?.message ?? '',/lost ownership/);assert.equal(entered,false);
 observations.push({case:'job-lock-expiry-preentry'});
}));
test('precommit expiry, cancellation and head mutation roll back actual SQL',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.BUILD_DEPENDENCY_GRAPH,1000);
 for(const condition of ['expired','cancel','head'] as const) {
  const controller=new AbortController();
  const failure=await capture(withJobOwnedEffect(f.pool,job,async client=>{
   await client.query('INSERT INTO graph_snapshots(org_id,repo_id,payload) VALUES($1,$2,$3)',[f.orgId,f.repoId,graph(f.repoId)]);
   if(condition==='expired')await client.query('UPDATE jobs SET lease_expires_at=clock_timestamp() WHERE id=$1',[job.id]);
   if(condition==='cancel')controller.abort();
   if(condition==='head')await client.query('UPDATE graph_publication_heads SET requested_generation=requested_generation+1 WHERE org_id=$1 AND repo_id=$2',[f.orgId,f.repoId]);
  },controller.signal));
  assert.ok(failure);assert.equal(await persisted(f.pool,f.orgId,f.repoId),undefined);
 }
 observations.push({case:'precommit-all-write-rollback',conditions:3});
}));
test('manifest generation and membership are frozen at submission for every effect scope',()=>fixture(async f=>{
 const collection=randomUUID();await f.pool.query("INSERT INTO org_collections(id,org_id,name) VALUES($1,$2,'fictional collection')",[collection,f.orgId]);
 await f.pool.query('INSERT INTO collection_repos(collection_id,repo_id) VALUES($1,$2)',[collection,f.repoId]);
 const submitted=await f.queue.createJob({type:JobType.BUILD_STRUCTURE_MANIFEST,params:{orgId:f.orgId,collectionId:collection},bypassRateLimit:true});
 await f.pool.query('INSERT INTO collection_repos(collection_id,repo_id) VALUES($1,$2)',[collection,'github:fictional/not-admitted']);
 const job=await f.queue.claimNext(randomUUID(),10000);assert.equal(job?.id,submitted.jobId);assert.equal(job?.graphGenerations?.length,1);
 await withJobOwnedEffect(f.pool,job!,async client=>{await client.query('SELECT 1');});
 await f.queue.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 let entered=false;await assert.rejects(withJobOwnedEffect(f.pool,job!,async()=>{entered=true;}),/superseded/);assert.equal(entered,false);
 observations.push({case:'manifest-frozen-membership-and-supersession',admittedRepos:1});
}));
test('actual WorkerPool rejects caller completion flags and awaits cache-owner receipt',()=>fixture(async f=>{
 await f.queue.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 const worker=new WorkerPool(f.queue,{concurrency:1,maxJobDurationMs:5000,leaseDurationMs:1000,heartbeatIntervalMs:100,retryPolicy:{maxRetries:0,backoffMs:1}}, {cache:f.cache},undefined,async()=>({status:'completed',graphPublished:true}));
 worker.start(10);await until(async()=>!(await f.queue.listAllJobs()).some(job=>job.status==='queued'||job.status==='running'));
 assert.equal((await f.queue.listAllJobs())[0].status,'failed');assert.equal((await f.queue.listAllJobs())[0].effectQuarantined,true);assert.equal(await worker.stop(),true);
 observations.push({case:'worker-no-forged-receipt',terminal:'failed-quarantined'});
}));
test('memory queue/cache linearize confirmed publication and preserve ordinary generic use',async()=>{
 const backend=new MemoryQueueBackend(),queue=new JobQueue({...loadJobQueueConfig({}),schedules:[]},backend),cache=new GraphCache();cache.bindJobQueue(queue);
 cache.setGraph('fictional-org',graph('github:fictional/memory','generic'));
 const job=await claim(queue,'fictional-org','github:fictional/memory');
 assert.throws(()=>cache.setGraph('fictional-org',graph('github:fictional/memory','intermediate')),/conflicted/);
 await cache.publishJobGraph(job,graph('github:fictional/memory','job'));await cache.assertJobPublished(job);assert.ok(await queue.completeJob(job,{}));
 cache.setGraph('fictional-org',graph('github:fictional/memory','later-generic'));
 assert.equal(cache.getGraph('fictional-org','github:fictional/memory')?.fileTree[0].path,'later-generic.md');
 await assert.rejects(cache.publishJobGraph(job,graph('github:fictional/memory','old-completed')),/not owned/);
 await cache.close();assert.throws(()=>cache.setGraph('fictional-org',graph('github:fictional/memory')),/closed/);
 observations.push({case:'memory-synchronous-ownership',capability:'process-local-only'});
});

test('real head-lock expiry denies callback before effects, preserving the original clock guard',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY,350);
 const lock=await f.pool.connect();await lock.query('BEGIN');await lock.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE',[f.orgId,f.repoId]);
 let entered=false;const pending=capture(withJobOwnedEffect(f.pool,job,async()=>{entered=true;}));
 try {
  await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n)>0);
  await until(async()=>Boolean((await f.pool.query('SELECT lease_expires_at<=clock_timestamp() expired FROM jobs WHERE id=$1',[job.id])).rows[0].expired));
  await lock.query('COMMIT');assert.match((await pending)?.message ?? '',/lost ownership/);assert.equal(entered,false);
 }finally{await lock.query('ROLLBACK');lock.release();await pending;}
 observations.push({case:'head-lock-expiry-preentry',entered:false});
}));
test('delayed real DB hydrate cannot undo a newer publication in the same cache owner',()=>fixture(async f=>{
 f.cache.setGraph(f.orgId,graph(f.repoId,'old'));await f.cache.flush();
 let release!:()=>void,observed!:()=>void;
 const held=new Promise<void>(resolve=>release=resolve),selected=new Promise<void>(resolve=>observed=resolve);
 let intercept=true;
 const proxy=new Proxy(f.pool,{get(target,key,receiver){
  if(key==='query')return async(...args:Parameters<Pool['query']>)=>{
   const result=await Reflect.apply(target.query,target,args);
   if(intercept && typeof args[0]==='string' && args[0].includes('LEFT JOIN graph_snapshots')) {intercept=false;observed();await held;}
   return result;
  };
  const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;
 }});
 const reader=new PersistingGraphCache({pool:proxy});reader.bindJobQueue(f.queue);
 const oldRead=reader.ensureLoaded(f.orgId,f.repoId);await selected;
 const job=await claim(f.queue,f.orgId,f.repoId);await reader.publishJobGraph(job,graph(f.repoId,'new'));
 release();await oldRead;assert.equal(reader.getGraph(f.orgId,f.repoId)?.fileTree[0].path,'new.md');
 await reader.close();observations.push({case:'delayed-real-hydrate-after-commit',rolledBack:false});
}));
test('delayed COMMIT acknowledgement cannot erase newer requested-generation staleness',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId);
 let observed!:()=>void,release!:()=>void;const committed=new Promise<void>(resolve=>observed=resolve),ack=new Promise<void>(resolve=>release=resolve);
 let readObserved!:()=>void,readRelease!:()=>void;const selected=new Promise<void>(resolve=>readObserved=resolve),readAck=new Promise<void>(resolve=>readRelease=resolve);
 let hold=true,delayRead=false;
 const proxy=new Proxy(f.pool,{get(target,key){
  if(key==='query')return async(sql:string,values?:unknown[])=>{const result=await target.query(sql,values as never);if(delayRead&&sql.includes('LEFT JOIN graph_snapshots')){delayRead=false;readObserved();await readAck;}return result;};
  if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,k){
   if(k==='query')return async(sql:string,values?:unknown[])=>{const result=await c.query(sql,values);if(sql==='COMMIT'&&hold){hold=false;observed();await ack;}return result;};
   const value=Reflect.get(c,k);return typeof value==='function'?value.bind(c):value;
  }});};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const cache=new PersistingGraphCache({pool:proxy});cache.bindJobQueue(f.queue);
 const publication=capture(cache.publishJobGraph(job,graph(f.repoId,'older-ack')));
 try {
  await committed;
  const submitted=await f.queue.createJob({type:JobType.BUILD_DEPENDENCY_GRAPH,userId:'fictional-actor',params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
  const newer=await f.queue.getJob(submitted.jobId);assert(newer);assert.equal(newer.graphGenerations?.[0].generation,'2');
  delayRead=true;const hydration=cache.ensureLoaded(f.orgId,f.repoId);await selected;
  release();assert.equal(await publication,null);readRelease();await hydration;
  const after=cache.getFileTree(f.orgId,f.repoId),local=cache.getGraph(f.orgId,f.repoId)?.metadata.publication;
  const durable=(await f.pool.query('SELECT requested_generation,published_generation,revision FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2',[f.orgId,f.repoId])).rows[0];
  observations.push({case:'delayed-commit-ack-preserves-late-newer-hydrate',actualCommit:true,afterStale:after?.stale,local,durable});
  assert.equal(after?.stale,true,'Acknowledged older COMMIT must not overwrite newer durable head knowledge with a falsely current local view');
  assert.equal(local?.requestedGeneration,String(durable.requested_generation));
  await assert.rejects(cache.assertJobPublished(job),/Effect generation superseded/,'the honest receipt must still defer to the newer durable generation');
 }finally{release();readRelease();await publication;await cache.close().catch(()=>undefined);}
}));
test('same-generation refresh during delayed COMMIT acknowledgement retains the confirmed receipt',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId);
 let observed!:()=>void,release!:()=>void;const committed=new Promise<void>(resolve=>observed=resolve),ack=new Promise<void>(resolve=>release=resolve);
 let hold=true;
 const proxy=new Proxy(f.pool,{get(target,key){
  if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,k){
   if(k==='query')return async(sql:string,values?:unknown[])=>{const result=await c.query(sql,values);if(sql==='COMMIT'&&hold){hold=false;observed();await ack;}return result;};
   const value=Reflect.get(c,k);return typeof value==='function'?value.bind(c):value;
  }});};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const cache=new PersistingGraphCache({pool:proxy});cache.bindJobQueue(f.queue);
 const publication=capture(cache.publishJobGraph(job,graph(f.repoId,'same-generation')));
 try {
  await committed;await cache.ensureLoaded(f.orgId,f.repoId);const refreshed=cache.getFileTree(f.orgId,f.repoId);
  assert.equal(refreshed?.stale,false,'the concurrent refresh observed the committed current generation');
  release();assert.equal(await publication,null);await cache.assertJobPublished(job);
  const completed=await f.queue.completeJob(job,{marker:'acknowledged-current-generation'});
  assert.equal(completed?.status,'completed','a concurrent current-generation read must not quarantine a successfully published job');
  observations.push({case:'delayed-commit-ack-same-generation-receipt',actualCommit:true,refreshedStale:refreshed?.stale,receipt:'worker assertion and completion accepted'});
 }finally{release();await publication;await cache.close().catch(()=>undefined);}
}));
test('actual executeJob dependency writer plus WorkerPool succeeds only after confirmed SQL',()=>fixture(async f=>{
 f.cache.setGraph(f.orgId,graph(f.repoId,'admitted'));await f.cache.flush();
 const submitted=await f.queue.createJob({type:JobType.BUILD_DEPENDENCY_GRAPH,params:{orgId:f.orgId,repoId:f.repoId},userId:'fictional',bypassRateLimit:true});
 const worker=new WorkerPool(f.queue,{concurrency:1,maxJobDurationMs:5000,leaseDurationMs:2000,heartbeatIntervalMs:100,retryPolicy:{maxRetries:0,backoffMs:1}}, {cache:f.cache});
 worker.start(10);await until(async()=>['completed','failed'].includes((await f.queue.getJob(submitted.jobId))?.status ?? ''));
 const job=await f.queue.getJob(submitted.jobId);assert.equal(job?.status,'completed');assert.equal((await persisted(f.pool,f.orgId,f.repoId)).generation,job?.graphGenerations?.[0].generation);
 assert.equal(await worker.stop(),true);observations.push({case:'actual-dependency-executor-worker-positive',terminal:'completed'});
}));
test('actual index executor keeps its staged graph private until final same-client READY',()=>fixture(async f=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh08-graph-fakegit-')),oldPath=process.env.PATH;
 const allowedFile=path.join(dir,'allowed.json');
 fs.writeFileSync(allowedFile,'[]');
 const git=path.join(dir,'git');
 fs.writeFileSync(git,`#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2),allowed=JSON.parse(fs.readFileSync(${JSON.stringify(allowedFile)},'utf8'));if(a[0]==='clone'){const dest=a[a.length-1];if(!allowed.some(p=>dest.startsWith(p+'-'))||!a.includes('https://github.com/fictional/graph.git'))process.exit(90);fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'README.md'),'Fictional disposable repository.\\n');}else if(a[0]==='-C'&&allowed.some(p=>a[1].startsWith(p+'-'))){console.log(a.includes('--abbrev-ref')?'main':'a'.repeat(40));}else process.exit(91);\n`,{mode:0o700});
 // No real Git or provider command can run. The maintained clone API executes
 // only this owned fake executable; all file bytes and browse responses fictional.
 for(const name of ['scip-typescript','scip-python','scip-go','scip-java','zoekt-git-index'])fs.writeFileSync(path.join(dir,name),'#!/bin/sh\nexit 127\n',{mode:0o700});
 process.env.PATH=dir+path.delimiter+oldPath;
 const restoreFetch=globalThis.fetch;
 globalThis.fetch=async input=>{
  const value=String(input);
  if(value==='https://api.github.com/repos/fictional/graph/contents?ref=main')return new Response(JSON.stringify([{type:'file',path:'README.md',name:'README.md',sha:'a'.repeat(40),size:32}]),{status:200});
  throw new Error('Unexpected HTTP in fictional browse fixture');
 };
 try {
  await f.store.storeCredential(f.orgId,'github','fictional-never-a-real-token');
  f.cache.setGraph(f.orgId,graph(f.repoId,'previous'));await f.cache.flush();
  const job=await claim(f.queue,f.orgId,f.repoId);
  const {resolveCloneLocalPath}=require('../server/gitCloneService') as typeof import('../server/gitCloneService');
  const clonePath=resolveCloneLocalPath({repoId:f.repoId,owner:'fictional',repo:'graph',provider:'github',orgId:f.orgId,jobId:job.id+'-'+job.attemptId});
  fs.writeFileSync(allowedFile,JSON.stringify([clonePath]));
  const phases:number[]=[];
  await executeJob(job,{cache:f.cache,orgStore:f.store,allowPatFallback:true},async progress=>{
   phases.push(progress);
   if(progress===86 || progress===88) {assert.equal(f.cache.getGraph(f.orgId,f.repoId)?.fileTree[0].path,'previous.md');assert.notEqual((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');}
  },new AbortController().signal);
  assert.ok(phases.includes(86));assert.ok(phases.includes(88));assert.equal(f.cache.getGraph(f.orgId,f.repoId)?.fileTree[0].path,'README.md');
  assert.equal((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');await f.cache.assertJobPublished(job);assert.ok(await f.queue.completeJob(job,{}));
  assert.equal(fs.existsSync(clonePath),false);assert.equal(fs.readdirSync(path.dirname(clonePath)).filter(n=>n.startsWith(path.basename(clonePath)+'-')).length,0);
  observations.push({case:'actual-index-executor-staged-through-final-ready',fakeGit:true,syntheticBrowse:true,nativeVendorCalls:0,wholeIndexCoherenceQualified:false});
 }finally{globalThis.fetch=restoreFetch;process.env.PATH=oldPath;fs.rmSync(dir,{recursive:true,force:true});}
}));
test('SIGKILL during actual graph SQL cannot produce READY or completed and keeps quarantine',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY,2000);
 await f.pool.query("CREATE FUNCTION hold_graph() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER hold_graph BEFORE INSERT ON graph_snapshots FOR EACH ROW EXECUTE FUNCTION hold_graph()");
 const child=spawn(process.execPath,[path.resolve('dist/tests/graphPublicationKill.fixture.cjs')],{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'test',DATABASE_SSL:'false',PGSSLMODE:'disable',EH08_KILL_DATABASE_URL:f.url,EH08_KILL_DATABASE_NAME:new URL(f.url).pathname.slice(1),EH08_KILL_JOB_ID:job.id,EH13_PUBLICATION_FIXTURE_FILE:process.env.EH13_PUBLICATION_FIXTURE_FILE},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
 const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
 try {
  await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND application_name='eh08-graph-kill-child' AND wait_event='PgSleep'")).rows[0].n)>0);
  assert.notEqual((await f.queue.getJob(job.id))?.status,'completed');assert.notEqual((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');
  child.kill('SIGKILL');assert.equal((await exit).signal,'SIGKILL');
  await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND application_name='eh08-graph-kill-child'")).rows[0].n)===0);
  assert.equal(await persisted(f.pool,f.orgId,f.repoId),undefined);assert.equal(output.includes('publication-confirmed'),false);
  await until(async()=>Boolean((await f.pool.query('SELECT lease_expires_at<=clock_timestamp() expired FROM jobs WHERE id=$1',[job.id])).rows[0].expired));
  await f.queue.reclaimExpired(0);assert.equal((await f.queue.getJob(job.id))?.effectQuarantined,true);
  await f.queue.createJob({type:JobType.INDEX_REPOSITORY,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});assert.equal(await f.queue.claimNext(randomUUID(),10000),undefined);
  observations.push({case:'actual-sql-SIGKILL',terminal:false,ready:false,rollback:true,quarantineRetained:true});
 }finally{if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');await exit;}
}));
test('shutdown retains actual executor slot until pending SQL settles and abort rolls graph back',()=>fixture(async f=>{
 f.cache.setGraph(f.orgId,graph(f.repoId));await f.cache.flush();
 await f.pool.query("CREATE FUNCTION hold_graph() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.6); RETURN NEW; END $$; CREATE TRIGGER hold_graph BEFORE INSERT OR UPDATE ON graph_snapshots FOR EACH ROW EXECUTE FUNCTION hold_graph()");
 const submitted=await f.queue.createJob({type:JobType.BUILD_DEPENDENCY_GRAPH,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 const worker=new WorkerPool(f.queue,{concurrency:1,maxJobDurationMs:5000,leaseDurationMs:2000,heartbeatIntervalMs:100,retryPolicy:{maxRetries:0,backoffMs:1}}, {cache:f.cache});
 worker.start(10);await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'")).rows[0].n)>0);
 assert.equal(await worker.stop(50),false);assert.equal(worker.activeCount,1);
 assert.equal(await worker.stop(2000),true);assert.equal((await f.queue.getJob(submitted.jobId))?.status,'failed');assert.equal((await f.queue.getJob(submitted.jobId))?.effectQuarantined,true);
 assert.notEqual((await persisted(f.pool,f.orgId,f.repoId)).generation,(await f.queue.getJob(submitted.jobId))?.graphGenerations?.[0].generation);
 observations.push({case:'shutdown-real-pending-sql',firstDrained:false,eventualSettled:true,quarantineRetained:true});
}));
test('actual36 migration upgrade preserves legacy0, and migration037 ledger fault rolls DDL back',async()=>{
 const name=`eh08${process.pid}${++sequence}_disposable`,url=new URL(target);url.pathname='/'+name;
 const admitted=admitDisposableDatabaseTarget(url.toString(),{port:new URL(releaseDatabase).port,database:name,user:'eh02'}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh08-graph-upgrade-'));
 await admin.query(`CREATE DATABASE ${name}`);let pool:Pool|undefined;
 try {
  // Reproduce the schema before 037; later migrations must not run first.
  const priorFiles=fs.readdirSync('migrations').filter(name=>/\.sql$/.test(name)&&name<'037_').sort();
  assert.ok(priorFiles.includes('036_integration_connection_revision.sql'));
  for(const file of priorFiles)fs.copyFileSync(path.join('migrations',file),path.join(dir,file));
  await runMigrations({databaseUrl:admitted,migrationsDir:dir,log:()=>undefined});pool=new Pool({connectionString:admitted,ssl:false});
  const org=randomUUID(),job=randomUUID();await pool.query("INSERT INTO organizations(id,name) VALUES($1,'fictional legacy fixture')",[org]);
  await pool.query('INSERT INTO graph_snapshots(org_id,repo_id,payload) VALUES($1,$2,$3)',[org,'github:fictional/legacy',graph('github:fictional/legacy','legacy')]);
  await pool.query("INSERT INTO jobs(id,type,status,priority,params) VALUES($1,'index_repository','queued','normal',$2)",[job,{orgId:org,repoId:'github:fictional/legacy'}]);
  fs.copyFileSync('migrations/037_graph_publication_generations.sql',path.join(dir,'037_graph_publication_generations.sql'));
  await pool.query("CREATE FUNCTION reject_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.filename='037_graph_publication_generations.sql' THEN RAISE EXCEPTION 'fixture ledger fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_ledger BEFORE INSERT ON schema_migrations FOR EACH ROW EXECUTE FUNCTION reject_ledger()");
  await assert.rejects(runMigrations({databaseUrl:admitted,migrationsDir:dir,log:()=>undefined}),/ledger fault/);
  assert.equal((await pool.query("SELECT to_regclass('graph_publication_heads') value")).rows[0].value,null);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM information_schema.columns WHERE table_name='jobs' AND column_name='graph_generations'")).rows[0].n),0);
  await pool.query('DROP TRIGGER reject_ledger ON schema_migrations');await runMigrations({databaseUrl:admitted,migrationsDir:dir,log:()=>undefined});
  assert.equal((await pool.query('SELECT generation,origin,payload FROM graph_snapshots')).rows[0].generation,'0');assert.equal((await pool.query('SELECT origin FROM graph_publication_heads')).rows[0].origin,'legacy-unattested');
  assert.equal((await pool.query('SELECT graph_generations FROM jobs')).rows[0].graph_generations,null);
  const backend=new PostgresQueueBackend(admitted);try{assert.equal(await backend.claimNext(randomUUID(),1000),undefined);}finally{await backend.close();}
  await runMigrations({databaseUrl:admitted,migrationsDir:dir,log:()=>undefined});
  assert.deepEqual((await pool.query('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map(row=>row.filename),[...priorFiles,'037_graph_publication_generations.sql']);
  observations.push({case:'actual36-to37-legacy-and-ledger-fault',oldPayloadUnchanged:true,legacyAuthorityMinted:false});
 }finally{await pool?.end();await until(async()=>Number((await admin.query('SELECT count(*) n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n)===0);await admin.query(`DROP DATABASE IF EXISTS ${name}`);fs.rmSync(dir,{recursive:true,force:true});}
});

test('terminal row/head lock waits preserve immutable result bytes and deny expiry before commit',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY,2000);
 await f.cache.publishJobGraph(job,graph(f.repoId));
 const lock=await f.pool.connect();await lock.query('BEGIN');await lock.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE',[f.orgId,f.repoId]);
 const result={marker:'original-terminal'},pending=f.queue.completeJob(job,result);
 try {
  await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n)>0);
  result.marker='mutated-while-waiting';await lock.query('COMMIT');assert.ok(await pending);
  assert.equal(((await f.queue.getJob(job.id))?.result as typeof result).marker,'original-terminal');
  assert.equal(((await f.queue.results.get(job.id))?.result as typeof result).marker,'original-terminal');
 }finally{await lock.query('ROLLBACK');lock.release();await pending;}
 const next=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY,350);await f.cache.publishJobGraph(next,graph(f.repoId,'next'));
 const second=await f.pool.connect();await second.query('BEGIN');await second.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE',[f.orgId,f.repoId]);
 const expired=f.queue.completeJob(next,{marker:'expired'});
 try {
  await until(async()=>Number((await f.pool.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n)>0);
  await until(async()=>Boolean((await f.pool.query('SELECT lease_expires_at<=clock_timestamp() expired FROM jobs WHERE id=$1',[next.id])).rows[0].expired));
  await second.query('COMMIT');assert.equal(await expired,undefined);assert.equal((await f.queue.getJob(next.id))?.status,'running');
  assert.equal(Number((await f.pool.query('SELECT count(*) n FROM job_results WHERE job_id=$1',[next.id])).rows[0].n),0);
 }finally{await second.query('ROLLBACK');second.release();await expired;}
 observations.push({case:'terminal-head-wait-positive-and-expired',immutableJobAndStoredResult:true,expiredTerminal:false});
}));
test('actual source-independent manifest executor writes only its submitted scope',()=>fixture(async f=>{
 await f.store.storeCredential(f.orgId,'github','fictional-never-a-real-token');
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.BUILD_STRUCTURE_MANIFEST);
 const restore=globalThis.fetch;
 globalThis.fetch=async input=>{
  const value=String(input),prefix='https://api.github.com/repos/fictional/graph';
  if(value===prefix)return new Response(JSON.stringify({default_branch:'main'}),{status:200});
  if(value===prefix+'/git/ref/heads/main')return new Response(JSON.stringify({object:{sha:'a'.repeat(40),type:'commit'}}),{status:200});
  if(value===prefix+'/git/trees/'+'a'.repeat(40)+'?recursive=1')return new Response(JSON.stringify({tree:[{path:'README.md',type:'blob',sha:'b'.repeat(40)}],truncated:false}),{status:200});
  throw new Error('Unexpected HTTP in fictional manifest fixture');
 };
 try {
  const result=await executeJob(job,{cache:f.cache,orgStore:f.store,allowPatFallback:true},async()=>undefined,new AbortController().signal) as {fileCount:number};
  assert.equal(result.fileCount,1);assert.equal(Number((await f.pool.query('SELECT count(*) n FROM repo_manifests WHERE org_id=$1 AND repo_id=$2',[f.orgId,f.repoId])).rows[0].n),1);
  assert.ok(await f.queue.completeJob(job,result));
  observations.push({case:'actual-manifest-executor-positive',syntheticHttp:true,nativeVendorCalls:0,generationGuarded:true});
 }finally{globalThis.fetch=restore;}
}));
test('current completed dependency result reuses generation while a foreign org never does',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.BUILD_DEPENDENCY_GRAPH);await f.cache.publishJobGraph(job,graph(f.repoId));await f.queue.completeJob(job,{marker:'supported-fixture'});
 const reused=await f.queue.createJob({type:job.type,userId:job.userId,params:{orgId:f.orgId,repoId:f.repoId},bypassRateLimit:true});
 assert.equal(reused.jobId,job.id);assert.equal(reused.cached,true);
 assert.equal((await f.pool.query('SELECT requested_generation FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2',[f.orgId,f.repoId])).rows[0].requested_generation,job.graphGenerations?.[0].generation);
 const other=randomUUID();await f.pool.query("INSERT INTO organizations(id,name) VALUES($1,'fictional foreign reuse')",[other]);
 const foreign=await f.queue.createJob({type:job.type,userId:job.userId,params:{orgId:other,repoId:f.repoId},bypassRateLimit:true});assert.notEqual(foreign.jobId,job.id);assert.notEqual(foreign.cached,true);
 observations.push({case:'same-current-generation-reuse-foreign-denial'});
}));
test('actual terminal result SQL expiry rolls back status and result together',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY,350);await f.cache.publishJobGraph(job,graph(f.repoId));
 await f.pool.query(`CREATE FUNCTION eh08_slow_terminal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$;
 CREATE TRIGGER eh08_slow_terminal BEFORE INSERT ON job_results FOR EACH ROW EXECUTE FUNCTION eh08_slow_terminal()`);
 await assert.rejects(f.queue.completeJob(job,{marker:'late-result'}),/lost lease before commit/);
 assert.equal((await f.queue.getJob(job.id))?.status,'running');assert.equal(await f.queue.results.get(job.id),undefined);
 assert.equal(Number((await f.pool.query('SELECT count(*) n FROM job_results WHERE job_id=$1',[job.id])).rows[0].n),0);
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).generation,job.graphGenerations?.[0].generation,'previous confirmed graph commit remains real');
 observations.push({case:'terminal-result-SQL-expiry',statusRollback:true,resultRollback:true,earlierGraphCommitPreserved:true});
}));
test('actual runtime shutdown reports retained cache SQL failure and positive drain honestly',()=>fixture(async f=>{
 const {createJobRuntime,stopJobRuntime}=await import('../jobs/jobRuntime');
 const config={...loadJobQueueConfig({}),backend:'postgres' as const,databaseUrl:f.url,schedules:[]};
 const cache=new PersistingGraphCache({pool:f.pool});const runtime=createJobRuntime({config,cache});
 cache.setGraph(f.orgId,graph(f.repoId,'shutdown-positive'));assert.equal(await stopJobRuntime(runtime),true);
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).payload.fileTree[0].path,'shutdown-positive.md');await (runtime.queue.getBackend() as PostgresQueueBackend).close();
 const failing=new PersistingGraphCache({pool:f.pool}),failedRuntime=createJobRuntime({config,cache:failing});
 await f.pool.query(`CREATE FUNCTION eh08_close_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional cache close SQL failure'; END $$;
 CREATE TRIGGER eh08_close_fault BEFORE INSERT OR UPDATE ON graph_snapshots FOR EACH ROW EXECUTE FUNCTION eh08_close_fault()`);
 failing.setGraph(f.orgId,graph(f.repoId,'retained-failure'));assert.equal(await stopJobRuntime(failedRuntime),false);
 assert.equal(failing.getPersistenceState().pending,1);assert.equal(failing.getPersistenceState().failed,true);
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).payload.fileTree[0].path,'shutdown-positive.md');await (failedRuntime.queue.getBackend() as PostgresQueueBackend).close();
 observations.push({case:'actual-runtime-close',positiveDrain:true,failedClose:false,failedPendingRetained:1});
}));
test('real COMMIT acknowledgement loss retains exact private failure identity without receipt or healthy close',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId);let committed=false;
 const pool={connect:async()=>{const client=await f.pool.connect();return {release:()=>client.release(),query:async(sql:string,values?:unknown[])=>{
  const result=await client.query(sql,values);if(sql==='COMMIT'){committed=true;throw new Error('fictional COMMIT acknowledgement lost');}return result;
 }};}} as unknown as Pool;
 const cache=new PersistingGraphCache({pool});const value=graph(f.repoId,'uncertain-original');
 await assert.rejects(cache.publishJobGraph(job,value,{store:f.store,patch:{indexStatus:'ready',lastJobId:job.id}}),/acknowledgement lost/);assert.equal(committed,true);
 const retained=cache.getFailedJobPublications();assert.equal(retained.length,1);assert.equal(retained[0].jobId,job.id);assert.equal(retained[0].attemptId,job.attemptId);assert.match(retained[0].payloadSha256,/^[a-f0-9]{64}$/);
 value.fileTree[0].path='changed-after-failure';assert.deepEqual(cache.getFailedJobPublications(),retained);assert.equal(cache.getGraph(f.orgId,f.repoId),undefined);
 assert.equal((await persisted(f.pool,f.orgId,f.repoId)).payload.fileTree[0].path,'uncertain-original.md');assert.equal((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');
 await assert.rejects(cache.assertJobPublished(job),/without confirmed/);await assert.rejects(cache.close(),/requires reconciliation/);
 assert.ok(await f.queue.failJob(job,'Graph COMMIT acknowledgement uncertain'));assert.equal((await f.queue.getJob(job.id))?.effectQuarantined,true);
 assert.equal(JSON.stringify(retained).includes('uncertain-original'),false);observations.push({case:'graph-real-COMMIT-ack-loss',committed:true,receipt:false,completed:false,retainedIdentityOnly:retained});
}));
test('actual SIGKILL after graph+READY COMMIT before local acknowledgement leaves honest committed graph and quarantined unsettled job',()=>fixture(async f=>{
 const job=await claim(f.queue,f.orgId,f.repoId,JobType.INDEX_REPOSITORY,700);
 const child=spawn(process.execPath,[path.resolve('dist/tests/graphPublicationKill.fixture.cjs')],{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'test',DATABASE_SSL:'false',PGSSLMODE:'disable',EH08_KILL_DATABASE_URL:f.url,EH08_KILL_DATABASE_NAME:new URL(f.url).pathname.slice(1),EH08_KILL_JOB_ID:job.id,EH13_PUBLICATION_FIXTURE_FILE:process.env.EH13_PUBLICATION_FIXTURE_FILE,EH08_KILL_AFTER_COMMIT:'true'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
 const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
 try {
  await until(async()=>output.includes('commit-observed'));assert.equal((await f.store.getOrgRepo(f.orgId,f.repoId))?.indexStatus,'ready');assert.ok(await persisted(f.pool,f.orgId,f.repoId));
  assert.equal((await f.queue.getJob(job.id))?.status,'running');child.kill('SIGKILL');assert.equal((await exit).signal,'SIGKILL');assert.equal(output.includes('publication-confirmed'),false);
  await until(async()=>Boolean((await f.pool.query('SELECT lease_expires_at<=clock_timestamp() expired FROM jobs WHERE id=$1',[job.id])).rows[0].expired));
  await f.queue.reclaimExpired(0);assert.equal((await f.queue.getJob(job.id))?.effectQuarantined,true);assert.notEqual((await f.queue.getJob(job.id))?.status,'completed');assert.equal(await f.queue.results.get(job.id),undefined);
  assert.ok(await persisted(f.pool,f.orgId,f.repoId));observations.push({case:'graph-real-SIGKILL-after-COMMIT-before-ack',committedGraphAndReady:true,acknowledgement:false,terminal:false,quarantineRetained:true});
 }finally{if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');await exit;}
}));

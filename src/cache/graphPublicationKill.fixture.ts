/** Disposable child only; actual cache publication is killed during real PG SQL. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {PersistingGraphCache} from './graphCachePostgres';
import {blankRepositoryGraph} from './graphCache';
import {OrgStore} from '../server/orgStore';
import {PostgresQueueBackend} from '../jobs/backends/postgresBackend';
const {admitDisposableDatabaseTarget}=require(path.resolve('scripts/disposable-database-target.mjs')) as {
 admitDisposableDatabaseTarget(value:string,expected:{port:string;database:string;user:string}):string;
};
void(async()=>{
 const name=process.env.EH08_KILL_DATABASE_NAME;
 if(!name || !new RegExp('^eh08'+process.ppid+'[0-9]+_disposable$').test(name)) throw new Error('Child database is not owned by this fixture parent');
 const {publicationDatabaseFromEnvironment}=require(path.resolve('scripts/publication-test-fixture.mjs'));
 const base=publicationDatabaseFromEnvironment(process.env,'graph');
 const url=admitDisposableDatabaseTarget(process.env.EH08_KILL_DATABASE_URL!,{port:new URL(base).port,database:name,user:'eh02'});
 const expected=new URL(base);expected.pathname='/'+name;
 assert.equal(url,expected.toString(),'Only the already admitted parent-owned generated database may be used');
 const pool=new Pool({connectionString:url,ssl:false,application_name:'eh08-graph-kill-child'});
 const backend=new PostgresQueueBackend(url),job=await backend.get(process.env.EH08_KILL_JOB_ID!);
 if(!job)throw new Error('Missing owned fixture job');
 const afterCommit=process.env.EH08_KILL_AFTER_COMMIT==='true';
 const publicationPool=afterCommit ? {connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:async(sql:string,values?:unknown[])=>{
  const result=await client.query(sql,values);if(sql==='COMMIT'){process.stdout.write('commit-observed\n');await new Promise<void>(()=>{setInterval(()=>undefined,1000);});}return result;
 }};}} as unknown as Pool : pool;
 const cache=new PersistingGraphCache({pool:publicationPool});
 const graph=blankRepositoryGraph({repoId:String(job.params.repoId),owner:'fictional',repo:'graph',provider:'github'});
 await cache.publishJobGraph(job,graph,afterCommit?{store:new OrgStore(pool,'a'.repeat(64)),patch:{indexStatus:'ready',lastJobId:job.id}}:undefined);
 process.stdout.write('publication-confirmed\n');await cache.close();await backend.close();await pool.end();
})().catch(()=>{process.stderr.write('fixture-child-failed\n');process.exitCode=1;});

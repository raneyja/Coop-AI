import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {createServer as createTcpServer} from 'node:net';
import {OperatorStore} from '../src/server/operators/operatorStore';
import {IntegrationConnectionStore} from '../src/server/integrationConnectionStore';
import {encryptCredential} from '../src/server/credentialCrypto';
import {loadWebhookConfig} from '../src/config/webhookConfig';
import type {WebhookServerRuntime} from '../src/webhooks/webhookServer';

const {publicationDatabaseFromEnvironment}=require('./publication-test-fixture.mjs');
const database:string=publicationDatabaseFromEnvironment(process.env,'schema-rollout');
const {runMigrations}=require('./run-migrations.mjs');
const main=require(path.resolve('dist/tests/compatibility/backend.cjs')) as typeof import('../src/server/integrationApi.publication.fixture');
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

test('cold old-schema upgrade refuses unknown history and admits proven fixture provenance',async t=>{
  const pool=new Pool({connectionString:database,ssl:false});
  const priorDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'coop-compat-prior-schema-'));
  let prior:ChildProcess|undefined,worker:ChildProcess|undefined,runtime:WebhookServerRuntime|undefined;
  const realFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('No provider or external HTTP is permitted');};
  const key='synthetic-schema-continuity-key',token='synthetic-prior-schema-token';
  const ciphertext=encryptCredential(token,key),orgId=randomUUID();
  const pin=JSON.parse(fs.readFileSync('fixtures/migrations/prior-release-0.1.13.json','utf8')) as {source_commit:string;runner_sha256:string;sql_sha256:Record<string,string>};
  try {
    assert.equal(pin.source_commit,'13240bb0caf8e93cac7ca6241cf2832125fdcffc');
    assert.equal(digest(fs.readFileSync('fixtures/migrations/prior-runner-0.1.13.mjs')),pin.runner_sha256);
    assert.equal(digest(fs.readFileSync('src/server/credentialCrypto.ts')),'57f3c8d8b3a94dcaf9b30096f0dfe694101731201ccd30ee8635895a8b4f8997','Prior and current encryption implementation identity');
    for(const [filename,sha] of Object.entries(pin.sql_sha256)) {
      const bytes=fs.readFileSync(path.join('migrations',filename));assert.equal(digest(bytes),sha);
      fs.writeFileSync(path.join(priorDirectory,filename),bytes);
    }
    prior=spawn(process.execPath,['fixtures/migrations/prior-runner-0.1.13.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH,DATABASE_URL:database,MIGRATIONS_DIR:priorDirectory,DATABASE_SSL:'false',PGSSLMODE:'disable'},stdio:['ignore','pipe','pipe']});
    let priorOutput='';prior.stdout!.on('data',chunk=>priorOutput+=chunk);prior.stderr!.on('data',chunk=>priorOutput+=chunk);
    const settled=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
      const timer=setTimeout(()=>{prior!.kill('SIGKILL');reject(new Error('Owned prior migrator exceeded deadline'));},60000);
      prior!.once('error',error=>{clearTimeout(timer);reject(error);});
      prior!.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
    });
    assert.equal(settled.code,0,priorOutput);assert.equal(settled.signal,null);
    assert.throws(()=>process.kill(prior!.pid!,0),(error:NodeJS.ErrnoException)=>error.code==='ESRCH','Old migrator physically closed before new activation');
    const ledgerBefore=(await pool.query('SELECT filename,applied_at FROM schema_migrations ORDER BY filename')).rows;
    await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'Synthetic preserved legacy org','enterprise')",[orgId]);
    await pool.query("INSERT INTO org_integration_connections(org_id,provider,encrypted_access_token,metadata) VALUES($1,'slack',$2,$3)",[orgId,ciphertext,{teamId:'synthetic-continuity'}]);
    const rawBefore=(await pool.query('SELECT * FROM org_integration_connections WHERE org_id=$1',[orgId])).rows[0];
    const operator=(await pool.query("INSERT INTO operators(email,role) VALUES('schema-rollout@fixture.invalid','viewer') RETURNING id")).rows[0];
    const session=await new OperatorStore(pool).createSession(operator.id);
    process.env.DATABASE_URL=database;process.env.JOBS_BACKEND='postgres';process.env.JOBS_WORKERS='0';
    const config=loadWebhookConfig({DATABASE_URL:database,GRAPH_CACHE_BACKEND:'memory'});
    config.tokenPools=[];for(const item of Object.values(config.webhooks))item.enabled=false;
    runtime=await main.createWebhookServer({config,serverConfig:{nodeEnv:'test',requireApiAuth:true,credentialsEncryptionKey:key,jobsWorkersEnabled:false,devMode:false}});
    await new Promise<void>(resolve=>runtime!.server.listen(0,'127.0.0.1',resolve));
    const address=runtime.server.address();assert(address&&typeof address==='object');
    const readiness=async()=>{
      const response=await realFetch('http://127.0.0.1:'+address.port+'/v1/operator/readiness',{headers:{authorization:'Bearer '+session.token},signal:AbortSignal.timeout(5000)});
      const body=await response.json() as {error?:string;ready?:boolean;checks?:{schema:{status:string;reason?:string}}};
      assert(!JSON.stringify(body).includes(token));assert(!JSON.stringify(body).includes(key));return {response,body};
    };
    await t.test('new artifact refuses pre-upgrade schema without modifying prior data',async()=>{
      const out=await readiness();assert.equal(out.response.status,503);assert.equal(out.body.error,'readiness_unavailable');
      assert.deepEqual((await pool.query('SELECT filename,applied_at FROM schema_migrations ORDER BY filename')).rows,ledgerBefore);
      assert.deepEqual((await pool.query('SELECT * FROM org_integration_connections WHERE org_id=$1',[orgId])).rows[0],rawBefore);
    });
    await t.test('additive upgrade preserves historical timestamps, encrypted bytes and key continuity',async()=>{
      await runMigrations({databaseUrl:database,migrationsDir:'migrations',log:()=>{}});
      const legacy=(await pool.query('SELECT filename,applied_at,checksum FROM schema_migrations WHERE filename=ANY($1::text[]) ORDER BY filename',[ledgerBefore.map(row=>row.filename)])).rows;
      assert.deepEqual(legacy.map(({filename,applied_at})=>({filename,applied_at})),ledgerBefore);assert(legacy.every(row=>row.checksum===null));
      const raw=(await pool.query('SELECT * FROM org_integration_connections WHERE org_id=$1',[orgId])).rows[0];
      assert.equal(raw.encrypted_access_token,ciphertext);assert.deepEqual(raw.metadata,rawBefore.metadata);
      const store=new IntegrationConnectionStore(pool,key),connection=await store.get(orgId,'slack');assert(connection);
      assert.equal(await store.getAccessToken(orgId,'slack',connection.revision),token);
    });
    await t.test('migration completion alone cannot certify unknown legacy history',async()=>{
      const out=await readiness();assert.equal(out.response.status,503);assert.equal(out.body.checks?.schema.status,'failed');
      assert.equal(out.body.checks?.schema.reason,'migration_identity_mismatch');
      assert.equal((await pool.query('SELECT count(*)::int n FROM schema_migrations WHERE checksum IS NULL')).rows[0].n,Object.keys(pin.sql_sha256).length);
    });
    await t.test('proven synthetic source history reconciles atomically, then current schema is admitted',async()=>{
      // Test-only provenance is authoritative here: this owned fixture applied
      // exactly the pinned bytes above. Production needs its own reviewed proof;
      // there is deliberately no automatic adoption in the product migrator.
      const client=await pool.connect();
      try {
        await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(1129271120,10)');
        for(const [filename,sha] of Object.entries(pin.sql_sha256)) {
          assert.equal(digest(fs.readFileSync(path.join(priorDirectory,filename))),sha);
          const changed=await client.query('UPDATE schema_migrations SET checksum=$2 WHERE filename=$1 AND checksum IS NULL',[filename,sha]);assert.equal(changed.rowCount,1);
        }
        await client.query('COMMIT');
      } catch(error){await client.query('ROLLBACK');throw error;} finally {client.release();}
      await runMigrations({databaseUrl:database,migrationsDir:'migrations',log:()=>{}});
      const out=await readiness();assert.equal(out.body.checks?.schema.status,'ok');
      assert.equal(out.response.status,503,'Wider fleet/index readiness is not certified by schema admission');assert.equal(out.body.ready,false);
      assert.deepEqual((await pool.query('SELECT filename,applied_at FROM schema_migrations WHERE filename=ANY($1::text[]) ORDER BY filename',[ledgerBefore.map(row=>row.filename)])).rows,ledgerBefore);
      assert.equal((await pool.query('SELECT encrypted_access_token FROM org_integration_connections WHERE org_id=$1',[orgId])).rows[0].encrypted_access_token,ciphertext);
    });
    await t.test('actual current worker CLI settles SIGTERM and releases its owned idle database connections',async()=>{
      assert.equal((await pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n,0,'Idle CLI scenario; active SQL drain is separately retained');
      const reservation=createTcpServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
      const address=reservation.address();assert(address&&typeof address==='object');const port=String(address.port);
      await new Promise<void>(resolve=>reservation.close(()=>resolve()));
      // Restrict only the test process's health binding; keep the actual CLI's
      // startup/shutdown implementation and database client paths unchanged.
      const prelude="const {publicationDatabaseFromEnvironment}=require('./scripts/publication-test-fixture.mjs');process.env.DATABASE_URL=publicationDatabaseFromEnvironment(process.env,'schema-rollout');globalThis.fetch=async()=>{throw Error('No worker provider HTTP permitted')};const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(port,...args){return Reflect.apply(listen,this,[port,'127.0.0.1',...args])};require('./dist/workerEntry.js');";
      worker=spawn(process.execPath,['--eval',prelude],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',EH13_PUBLICATION_FIXTURE_FILE:process.env.EH13_PUBLICATION_FIXTURE_FILE,DATABASE_SSL:'false',JOBS_BACKEND:'postgres',JOBS_WORKERS:'1',GRAPH_CACHE_BACKEND:'memory',PORT:port,PGAPPNAME:'synthetic-schema-rollout-worker',COOP_EMAIL_MOCK:'1',CREDENTIALS_ENCRYPTION_KEY:key},stdio:['ignore','pipe','pipe']});
      let output='';worker.stdout!.on('data',chunk=>output+=chunk);worker.stderr!.on('data',chunk=>output+=chunk);
      const closed=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{worker!.once('error',reject);worker!.once('close',(code,signal)=>resolve({code,signal}));});
      const readyUntil=Date.now()+10000;
      while(!output.includes('[workers] health listening')) {
        assert.equal(worker.exitCode,null,output);assert.equal(worker.signalCode,null,output);
        if(Date.now()>readyUntil)throw new Error('Owned worker CLI startup failed: '+output);
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      const timer=setTimeout(()=>worker!.kill('SIGKILL'),10000);worker.kill('SIGTERM');
      const result=await closed;clearTimeout(timer);assert.equal(result.code,0,output);assert.equal(result.signal,null);
      assert.throws(()=>process.kill(worker!.pid!,0),(error:NodeJS.ErrnoException)=>error.code==='ESRCH');
      const connectionsUntil=Date.now()+2000;
      while((await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name='synthetic-schema-rollout-worker'")).rows[0].n!==0) {
        assert(Date.now()<connectionsUntil,'Owned worker connections did not settle');await new Promise(resolve=>setTimeout(resolve,20));
      }
    });
    console.log(JSON.stringify({suite:'OWNED_PRIOR_SCHEMA_COLD_UPGRADE_AND_FORWARD_PROVENANCE',controls:5,priorSource:pin.source_commit,priorMigratorPhysicallyClosed:true,currentIdleWorkerCliPhysicallyClosed:true,legacyRows:Object.keys(pin.sql_sha256).length,sourceProvenance:'SYNTHETIC_FIXTURE_ONLY',productionAdoption:'REQUIRES_OWN_REVIEWED_HISTORY_AND_APPROVAL',providers:0}));
  } finally {
    globalThis.fetch=realFetch;
    if(prior&&prior.exitCode===null&&prior.signalCode===null){const closed=new Promise<void>(resolve=>prior!.once('close',()=>resolve()));prior.kill('SIGKILL');await closed;}
    if(worker&&worker.exitCode===null&&worker.signalCode===null){const closed=new Promise<void>(resolve=>worker!.once('close',()=>resolve()));worker.kill('SIGKILL');await closed;}
    if(runtime){runtime.server.closeAllConnections();await new Promise<void>(resolve=>runtime!.server.close(()=>resolve()));await main.stopJobRuntime(runtime.jobs);const backend=runtime.jobs.queue.getBackend();if('close'in backend&&typeof backend.close==='function')await backend.close();}
    await main.closeMainDbPool();await pool.end();fs.rmSync(priorDirectory,{recursive:true,force:true});
  }
});

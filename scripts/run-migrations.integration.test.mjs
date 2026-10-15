import { publicationDatabaseFromEnvironment } from './publication-test-fixture.mjs';
import {migrationSourceManifest} from './migration-source-manifest.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from './run-migrations.mjs';

const target=publicationDatabaseFromEnvironment(process.env, 'migrations');
const root=path.resolve('.');
let sequence=0;
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(fn) {
  const admin=new pg.Client({connectionString:target,ssl:false}); await admin.connect();
  const name=`eh10_${process.pid}_${++sequence}`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh10-migrations-'));
  const url=new URL(target);url.pathname='/'+name;
  let db;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    db=new pg.Client({connectionString:url.toString(),ssl:false}); await db.connect();
    await fn({db,dir,url:url.toString(),admin,name});
  } finally {
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end(); fs.rmSync(dir,{recursive:true});
  }
}
const run=(url,dir)=>runMigrations({databaseUrl:url,migrationsDir:dir,log:()=>{}});
function cli(url,dir,runner='scripts/run-migrations.mjs') {
  const child=spawn(process.execPath,[runner],{cwd:root,env:{...process.env,DATABASE_URL:url,MIGRATIONS_DIR:dir,DATABASE_SSL:'false',PGSSLMODE:'disable'}});
  let output=''; child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  return {child,done:new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal,output})))};
}

test('full fresh install, repeat and checksum-change rejection',()=>fixture(async({db,url,dir})=>{
  for (const name of fs.readdirSync('migrations').filter(x=>/^\d{3}_\w+\.sql$/.test(x))) fs.copyFileSync(path.join('migrations',name),path.join(dir,name));
  await run(url,dir);
  const rows=await db.query('SELECT filename,checksum FROM schema_migrations ORDER BY filename');
  assert.deepEqual(rows.rows,migrationSourceManifest(),'Every applied filename and checksum matches the exact current SQL source');
  await run(url,dir);
  const changed=path.join(dir,'032_support_reports.sql');
  fs.appendFileSync(changed,'\n-- EH10 content mismatch fixture\n');
  await assert.rejects(run(url,dir),/content changed/);
  fs.rmSync(changed);
  await assert.rejects(run(url,dir),/missing or content changed/);
  fs.copyFileSync('migrations/032_support_reports.sql',changed);
  await run(url,dir);
  await db.query("UPDATE schema_migrations SET checksum=repeat('0',64) WHERE filename='032_support_reports.sql'");
  await assert.rejects(run(url,dir),/content changed/);
}));

test('actual 0.1.13 old-runner database upgrades without invented historical hashes',()=>fixture(async({db,url,dir})=>{
  const pin=JSON.parse(fs.readFileSync('fixtures/migrations/prior-release-0.1.13.json','utf8'));
  assert.equal(createHash('sha256').update(fs.readFileSync('fixtures/migrations/prior-runner-0.1.13.mjs')).digest('hex'),pin.runner_sha256,'frozen prior runner changed');
  for (const [filename,expected] of Object.entries(pin.sql_sha256)) {
    const bytes=fs.readFileSync(path.join('migrations',filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,filename+' prior-release bytes changed');
    fs.writeFileSync(path.join(dir,filename),bytes);
  }
  const prior=cli(url,dir,'fixtures/migrations/prior-runner-0.1.13.mjs');
  const result=await prior.done;assert.equal(result.code,0,result.output);
  const before=(await db.query('SELECT filename,applied_at FROM schema_migrations ORDER BY filename')).rows;
  for (const name of fs.readdirSync('migrations').filter(x=>/^\d{3}_\w+\.sql$/.test(x))) fs.copyFileSync(path.join('migrations',name),path.join(dir,name));
  fs.writeFileSync(path.join(dir,'033_upgrade_fixture.sql'),'CREATE TABLE upgrade_fixture(id integer PRIMARY KEY);');
  await run(url,dir);await run(url,dir);
  const oldFilenames=before.map(row=>row.filename);
  const legacy=(await db.query('SELECT filename,applied_at,checksum FROM schema_migrations WHERE filename = ANY($1::text[]) ORDER BY filename',[oldFilenames])).rows;
  assert.deepEqual(legacy.map(({filename,applied_at})=>({filename,applied_at})),before);
  assert.ok(legacy.every(r=>r.checksum===null));
  const applied=(await db.query('SELECT filename,checksum FROM schema_migrations ORDER BY filename')).rows;
  const expected=fs.readdirSync(dir).filter(name=>/^\d{3}_\w+\.sql$/.test(name)).sort();
  assert.deepEqual(applied.map(row=>row.filename),expected,'Every actual new release migration and fixture is applied');
  const added=applied.filter(row=>!oldFilenames.includes(row.filename));
  assert.ok(added.some(row=>row.filename==='033_saml_login_requests.sql'),'Qualify the actual new release, not only a fabricated extra migration');
  for(const row of added)assert.equal(row.checksum,createHash('sha256').update(fs.readFileSync(path.join(dir,row.filename))).digest('hex'));

}));

test('actual migration 032 rolls back both schema and failed ledger, then recovers',()=>fixture(async({db,url,dir})=>{
  for (const name of fs.readdirSync('migrations').filter(x=>/^\d{3}_\w+\.sql$/.test(x) && x<'032')) fs.copyFileSync(path.join('migrations',name),path.join(dir,name));
  await run(url,dir);
  await db.query(`CREATE FUNCTION reject_032_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.filename='032_support_reports.sql' THEN RAISE EXCEPTION 'EH10 forced ledger failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_032 BEFORE INSERT ON schema_migrations FOR EACH ROW EXECUTE FUNCTION reject_032_ledger()`);
  fs.copyFileSync('migrations/032_support_reports.sql',path.join(dir,'032_support_reports.sql'));
  await assert.rejects(run(url,dir),/forced ledger failure/);
  const schema=await db.query("SELECT to_regclass('public.support_reports') AS reports, to_regclass('public.support_report_events') AS events");
  assert.equal(schema.rows[0].reports,null);assert.equal(schema.rows[0].events,null);
  assert.equal((await db.query("SELECT 1 FROM schema_migrations WHERE filename='032_support_reports.sql'")).rowCount,0);
  await db.query('DROP TRIGGER reject_032 ON schema_migrations; DROP FUNCTION reject_032_ledger()');
  await run(url,dir);assert.equal((await db.query("SELECT 1 FROM schema_migrations WHERE filename='032_support_reports.sql'")).rowCount,1);
}));

test('two runner sessions serialize and apply a non-idempotent migration once',()=>fixture(async({db,url,dir})=>{
  fs.writeFileSync(path.join(dir,'001_concurrent.sql'),'CREATE TABLE once_only (id int PRIMARY KEY); INSERT INTO once_only VALUES (1); SELECT pg_sleep(0.4);');
  const one=cli(url,dir),two=cli(url,dir);
  const results=await Promise.all([one.done,two.done]);
  results.forEach(r=>assert.equal(r.code,0,r.output));
  assert.equal((await db.query('SELECT * FROM once_only')).rowCount,1);
  assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount,1);
}));

test('terminated runner session rolls back SQL and releases lock; retry succeeds',()=>fixture(async({db,url,dir})=>{
  fs.writeFileSync(path.join(dir,'001_interrupted.sql'),'CREATE TABLE interrupted (id int); SELECT pg_sleep(1);');
  const operation=cli(url,dir);
  try {
    let pid;
    for (let i=0;i<100;i++) {
      const active=await db.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid() AND query LIKE '%pg_sleep(1)%' AND state='active'");
      if (active.rowCount) {pid=active.rows[0].pid;break;} await sleep(20);
    }
    assert.ok(pid,'runner reached interrupted SQL phase');
    operation.child.kill('SIGKILL');await operation.done;
    for(let i=0;i<100;i++) {if(!(await db.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1',[pid])).rowCount)break;await sleep(20);}
    assert.equal((await db.query("SELECT to_regclass('public.interrupted') AS relation")).rows[0].relation,null);
    assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount,0);
    await run(url,dir);assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount,1);
  } finally {if(operation.child.exitCode===null && operation.child.signalCode===null)operation.child.kill('SIGKILL');}
}));

test('unledgered Docker schema and false legacy probes fail closed without deleting history',()=>fixture(async({db,url,dir})=>{
  fs.writeFileSync(path.join(dir,'001_safe.sql'),'SELECT 1;');
  await db.query('CREATE TABLE organizations(id int)');
  await assert.rejects(run(url,dir),/unledgered schema/);
  assert.equal((await db.query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0].ledger,null);
  await db.query("CREATE TABLE schema_migrations(filename text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(filename) VALUES ('025_org_repos_browse_status.sql')");
  await assert.rejects(run(url,dir),/ledger\/schema mismatch/);
  assert.equal((await db.query('SELECT * FROM schema_migrations')).rowCount,1);
}));

test('no implicit DB target and missing host/database are rejected before connection',async()=>{
  await assert.rejects(run(undefined,'migrations'),/explicitly select/);
  await assert.rejects(run('postgres://eh10@localhost','migrations'),/explicit host and database/);
  await assert.rejects(run('postgres://eh10@localhost/database?host=elsewhere','migrations'),/target\/session overrides/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh10-invalid-utf8-'));
  try {
    fs.writeFileSync(path.join(dir,'001_invalid.sql'),Buffer.from([255]));
    await assert.rejects(run('postgres://eh10@127.0.0.1:1/unreachable',dir),/encoded data|encoding|UTF/i);
  } finally {fs.rmSync(dir,{recursive:true});}
});


test('unexpected SQL release files never create a ledger, schema or completion report',()=>fixture(async({db,url,dir})=>{
  const messages=[];
  fs.writeFileSync(path.join(dir,'033_require-security-policy.sql'),'CREATE TABLE mandatory_policy(id int);');
  await assert.rejects(runMigrations({databaseUrl:url,migrationsDir:dir,log:message=>messages.push(message)}),/Unexpected SQL migration filename/);
  assert.deepEqual(messages,[]);
  const state=await db.query("SELECT to_regclass('public.schema_migrations') AS ledger, to_regclass('public.mandatory_policy') AS policy");
  assert.equal(state.rows[0].ledger,null);assert.equal(state.rows[0].policy,null);
  fs.rmSync(path.join(dir,'033_require-security-policy.sql'));
  await assert.rejects(runMigrations({databaseUrl:url,migrationsDir:dir,log:message=>messages.push(message)}),/no SQL migrations/);
  assert.deepEqual(messages,[]);
}));

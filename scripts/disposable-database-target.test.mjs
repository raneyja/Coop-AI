import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { admitDisposableDatabaseTarget } from './disposable-database-target.mjs';
const good='postgres://eh10:FAKE_EH10_GUARD_SECRET@localhost:56547/eh10_disposable';

test('disposable admission rejects redirected, ambiguous and non-Postgres targets without credentials',()=>{
  assert.equal(new URL(admitDisposableDatabaseTarget(good)).hostname,'localhost');
  const bad=[good+'?host=production.invalid',good+'?hostaddr=203.0.113.1',good+'?port=5432',good+'?database=other',good+'?dbname=other',good+'?user=other',good+'?password=other',good+'?options=-csearch_path=public',good+'?host=localhost&host=production.invalid',good+'?HOST=production.invalid',good+'?%68ost=production.invalid',good+'?sslmode=disable',good+'#fragment',good.replace('postgres:','http:'),good.replace(':56547',':5432'),good.replace('/eh10_disposable','/other'),good.replace(':56547',':bad')];
  for(const value of bad) {
    assert.throws(()=>admitDisposableDatabaseTarget(value),error=>{
      assert.equal(inspect(error).includes('FAKE_EH10_GUARD_SECRET'),false);return true;
    });
  }
});

test('both actual destructive suites reject overrides before constructing or connecting pg clients',()=>{
  for(const file of ['scripts/run-migrations.integration.test.mjs','scripts/database-tls.integration.test.ts']) {
    const code=`import pg from 'pg';let constructors=0,connections=0;const C=pg.Client,P=pg.Pool;pg.Client=class extends C {constructor(...args){constructors++;super(...args);}connect(...args){connections++;throw new Error('unexpected connection');}};pg.Pool=class extends P {constructor(...args){constructors++;super(...args);}connect(...args){connections++;throw new Error('unexpected connection');}};try{await import('./'+process.env.EH10_GUARD_SUITE);process.exitCode=1;}catch(error){console.log(JSON.stringify({constructors,connections,message:error.message}));}`;
    const env={...process.env,EH10_GUARD_SUITE:file};
    // Each suite now has its own admission owner. Remove ambient targets so
    // rejection proves the injected override, rather than an unrelated setting.
    for(const key of ['DATABASE_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','EH10_TEST_DATABASE_URL','EH10_TEST_CA_FILE','EH13_PUBLICATION_FIXTURE_FILE']) delete env[key];
    const portable=file==='scripts/run-migrations.integration.test.mjs';
    if(portable) {
      env.DATABASE_URL=good+'?host=production.invalid&port=5432';
      env.EH13_PUBLICATION_FIXTURE_FILE='/does-not-exist';
    } else {
      env.EH10_TEST_DATABASE_URL=good+'?host=production.invalid&port=5432';
      env.EH10_TEST_CA_FILE='/unused-fixture';
    }
    const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',code],{cwd:process.cwd(),encoding:'utf8',env});
    assert.equal(result.status,0,result.stderr);const recorded=JSON.parse(result.stdout.trim());
    assert.equal(recorded.constructors,0);assert.equal(recorded.connections,0);
    assert.match(recorded.message,portable ? /^Publication tests do not accept ambient database or Docker target overrides$/ : /Refusing a target/);
    assert.equal((result.stdout+result.stderr).includes('FAKE_EH10_GUARD_SECRET'),false);
  }
});

test('actual backend startup rejection output contains no malformed URL credentials',()=>{
  const code=`import db from './src/server/db.ts';await db.getDbPool(process.env.EH10_MALFORMED_URL);`;
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',code],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,EH10_MALFORMED_URL:'postgres://user:FAKE_EH10_STARTUP_SECRET@host:bad/database'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid database connection URL/);
  assert.equal((result.stderr+result.stdout).includes('FAKE_EH10_STARTUP_SECRET'),false);
});

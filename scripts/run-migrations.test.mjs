import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareMigration } from './run-migrations.mjs';
import databasePoolOptions from '../src/server/databasePoolOptions.cjs';
import pg from 'pg';

test('historical migrations admit wrappers while preserving procedural bodies', () => {
  for (const name of fs.readdirSync('migrations').filter(x => /^\d{3}_\w+\.sql$/.test(x))) {
    assert.ok(prepareMigration(fs.readFileSync(path.join('migrations', name), 'utf8')).length, name);
  }
  const body = "DO $block$ BEGIN RAISE NOTICE 'COMMIT;'; END $block$;";
  assert.equal(prepareMigration('BEGIN;'+body+'COMMIT;')[0], body);
  assert.equal(prepareMigration("SELECT ';', E'\\\''; /* outer /* inner */ end */ SELECT 1;").length, 2);
  assert.equal(prepareMigration("SELECT 'slash\\'; SELECT 1;").length, 2);
});

test('transaction, nontransaction and ambiguous SQL fail admission', () => {
  for (const sql of ['BEGIN; SELECT 1;', 'BEGIN; SELECT 1; COMMIT; BEGIN; SELECT 2; COMMIT;', 'SELECT 1; COMMIT;', 'START TRANSACTION;', 'SAVEPOINT x;', 'ROLLBACK;', 'PREPARE TRANSACTION \'x\';', 'VACUUM;', 'CREATE INDEX CONCURRENTLY x ON t (x);', 'CREATE DATABASE x;', 'ALTER SYSTEM SET x=1;', 'CALL proc();', 'COPY x TO PROGRAM \'x\';', 'SET standard_conforming_strings=off;', 'SET LOCAL standard_conforming_strings=off;', 'PREPARE /* gap */ TRANSACTION \'x\';', 'START /* gap */ TRANSACTION;', "SELECT 1 AS foo$$abc; COMMIT; SELECT 1 AS def$$;", "SELECT 'broken", '/* broken']) {
    assert.throws(() => prepareMigration(sql), undefined, sql);
  }
});

test('pg effective options cannot override verification through the URL or environment', () => {
  for (const mode of ['require','verify-ca','verify-full','prefer']) {
    const config = databasePoolOptions('postgres://u:p@localhost/db?sslmode='+mode, {});
    const client = new pg.Client(config);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(typeof client.connectionParameters.ssl.checkServerIdentity, "function");
    assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  }
  assert.equal(databasePoolOptions('postgres://u:p@localhost/db', {}).ssl, false);
  assert.equal(databasePoolOptions('postgres://u:p@localhost/db', { DATABASE_SSL:'true' }).ssl.rejectUnauthorized,true);
  for (const suffix of ['sslmode=no-verify','ssl=no-verify','uselibpqcompat=true&sslmode=require','sslmode=invalid']) assert.throws(() => databasePoolOptions('postgres://u:p@localhost/db?'+suffix, {}));
  assert.throws(() => databasePoolOptions('postgres://u:p@localhost/db?sslmode=disable', {DATABASE_SSL:'true'}));
  assert.throws(() => databasePoolOptions('postgres://u:p@localhost/db', {PGSSLMODE:'no-verify'}));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh10-ca-'));
  try {
    fs.writeFileSync(path.join(dir,'ca.pem'),'test CA bytes');
    const config=databasePoolOptions('postgres://u:p@localhost/db?sslmode=verify-full&sslrootcert='+encodeURIComponent(path.join(dir,'ca.pem')), {});
    assert.equal(new pg.Client(config).connectionParameters.ssl.ca,'test CA bytes');
  } finally { fs.rmSync(dir,{recursive:true}); }
});

test('malformed helper and runner errors cannot disclose fake credentials', async () => {
  const { inspect, format } = await import('node:util');
  const { runMigrations } = await import('./run-migrations.mjs');
  const secret='FAKE_EH10_URL_SECRET';
  const url='postgres://user:'+secret+'@host:bad/database';
  for (const action of [()=>databasePoolOptions(url),()=>runMigrations({databaseUrl:url,migrationsDir:'migrations'})]) {
    await assert.rejects(Promise.resolve().then(action), (error) => {
      assert.equal(Object.hasOwn(error,'input'),false);
      assert.equal(Object.hasOwn(error,'cause'),false);
      for (const output of [inspect(error),JSON.stringify(error),format(error),error.stack,error.message]) assert.equal(output.includes(secret),false);
      return true;
    });
  }
});

test('migration discovery fails unexpected or empty SQL sets before any pool creation',async()=>{
  const { runMigrations }=await import('./run-migrations.mjs');
  const OriginalPool=pg.Pool;let constructed=0;
  pg.Pool=class {constructor(){constructed++;throw new Error('unexpected pool');}};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eh10-discovery-'));
  try {
    await assert.rejects(runMigrations({databaseUrl:'postgres://eh10:p@localhost:56547/eh10_disposable',migrationsDir:dir}),/no SQL migrations/);
    for(const name of ['033_require-security-policy.sql','033_POLICY.SQL','33_policy.sql','policy.sql','033_policy 2.sql']) {
      fs.writeFileSync(path.join(dir,name),'CREATE TABLE mandatory_policy(id int);');
      await assert.rejects(runMigrations({databaseUrl:'postgres://eh10:p@localhost:56547/eh10_disposable',migrationsDir:dir}),/Unexpected SQL migration filename/);
      fs.rmSync(path.join(dir,name));
    }
    assert.equal(constructed,0);
  } finally {pg.Pool=OriginalPool;fs.rmSync(dir,{recursive:true});}
});

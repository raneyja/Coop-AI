import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import pg from 'pg';
import { admitDisposableDatabaseTarget } from './disposable-database-target.mjs';
const fixture={port:'56563',database:'eh08_disposable',user:'eh08'};
const base='postgresql://eh08:local-fixture-only@127.0.0.1:56563/eh08_disposable';
const bad=[base+'?',base+'#',base+'?host=production.example.invalid&port=5432',base+'?HOST=production.example.invalid',base+'?%68ost=production.example.invalid',base+'?host=127.0.0.1&host=production.example.invalid',base+'?options=-csearch_path=private',base+'?application_name=fixture',base+'#ignored',base.replace('postgresql:','https:'),base.replace('127.0.0.1','production.example.invalid'),base.replace('56563','5432'),base.replace('eh08_disposable','other'),base.replace('eh08:','other:'),base.replace(':local-fixture-only@','@')];
test('canonical pure helper retains EH10 defaults and EH08 hardcoded fixture effective target',()=>{
 for(const [value,expected]of [['postgres://eh10:local@localhost:56547/eh10_disposable',undefined],[base,fixture]]){
  const admitted=admitDisposableDatabaseTarget(value,expected);const effective=new pg.Client({connectionString:admitted}).connectionParameters;
  assert.ok(['localhost','127.0.0.1'].includes(effective.host));assert.equal(effective.port,Number(expected?.port??56547));assert.equal(effective.database,expected?.database??'eh10_disposable');assert.equal(effective.user,expected?.user??'eh10');
 }
 for(const suffix of ['?host=production.example.invalid','?options=-csearch_path=private','#x'])assert.throws(()=>admitDisposableDatabaseTarget('postgres://eh10:local@localhost:56547/eh10_disposable'+suffix));
 for(const invalid of [{...fixture,port:'543'},{...fixture,database:'production'},{...fixture,user:'admin'}])assert.throws(()=>admitDisposableDatabaseTarget(base,invalid));
});
for(const value of bad)test('actual destructive suite rejects ambient target before PG or Docker admission: '+value,()=>{
 assert.throws(()=>admitDisposableDatabaseTarget(value,fixture),/Refusing a target outside|Invalid disposable/);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'eh08-no-connect-'));const sentinel=path.join(temp,'constructed');const preload=path.join(temp,'sentinel.cjs');
 fs.writeFileSync(preload,`const fs=require('node:fs'),Module=require('node:module'),original=Module._load;Module._load=function(name,...args){const loaded=original.call(this,name,...args);if(name==='node:child_process'){return {...loaded,execFileSync(){fs.writeFileSync(${JSON.stringify(sentinel)},'Docker');throw Error('UNSAFE_DOCKER_INSPECTION');}};}if(name==='pg'){return {...loaded,Pool:class{constructor(){fs.writeFileSync(${JSON.stringify(sentinel)},'Pool');throw Error('UNSAFE_POOL_CONSTRUCTION');}},Client:class{constructor(){fs.writeFileSync(${JSON.stringify(sentinel)},'Client');throw Error('UNSAFE_CLIENT_CONSTRUCTION');}}};}return loaded;};`);
 try{
  // The suite now uses the owned-fixture admission owner, not EH08_TEST_DATABASE_URL.
  const env={...process.env};
  for(const key of ['DATABASE_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','EH08_TEST_DATABASE_URL','EH13_PUBLICATION_FIXTURE_FILE'])delete env[key];
  env.DATABASE_URL=value;env.EH13_PUBLICATION_FIXTURE_FILE='/does-not-exist';
  const result=spawnSync(process.execPath,['-r',preload,'dist/tests/jobLeases.integration.test.cjs'],{cwd:process.cwd(),env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,1,result.error?.message);assert.equal(fs.existsSync(sentinel),false,result.stderr);assert.match(result.stderr,/Publication tests do not accept ambient database or Docker target overrides/);assert.doesNotMatch(result.stderr,/UNSAFE_.*(?:CONSTRUCTION|INSPECTION)/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

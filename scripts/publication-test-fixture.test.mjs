import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {PUBLICATION_IMAGE,PUBLICATION_IMAGE_REF,PUBLICATION_IMAGE_CONFIG,PUBLICATION_LABEL,rejectPublicationTargetOverrides,validatePublicationDescriptor,validatePublicationContainer,validatePublicationCleanupContainer,publicationDatabaseFromEnvironment} from './publication-test-fixture.mjs';

test('ambient targets reject before Docker inspection or database constructors',async t=>{
 for(const key of ['DATABASE_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])await t.test(key,()=>{
  assert.throws(()=>publicationDatabaseFromEnvironment({[key]:'untrusted-target',EH13_PUBLICATION_FIXTURE_FILE:'/does-not-exist'}),/ambient/);
 });
 assert.doesNotThrow(()=>rejectPublicationTargetOverrides({}));
 assert.throws(()=>publicationDatabaseFromEnvironment({}),/owned publication test runner/);
});
test('publication fixture rejects symlinks and oversized files before Docker inspection',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coop-publication-guard-'));
 try{
  const file=path.join(root,'descriptor.json'),link=path.join(root,'link.json');
  fs.writeFileSync(file,'x'.repeat(4097));
  fs.symlinkSync(file,link);
  for(const fixture of [file,link]){
   assert.throws(()=>publicationDatabaseFromEnvironment({EH13_PUBLICATION_FIXTURE_FILE:fixture}),/owned publication test runner/);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('descriptor policy admits no URL or arbitrary fixture target',()=>{
 const runId=randomUUID(),descriptor={runId,name:'coop-eh13-publication-'+runId,id:'a'.repeat(64),port:'56557',createdAfter:Date.now()};
 assert.match(validatePublicationDescriptor(descriptor),/^postgresql:\/\/eh02:eh02-disposable-only@127\.0\.0\.1:56557\/eh02_disposable$/);
 for(const changes of [{url:'postgresql://production/db'},{port:'56557?host=production'},{port:'0'},{port:'65536'},{name:'old-root-fixture'},{id:'--all'},{runId:'other'},{createdAfter:Date.now()-16*60*1000},{createdAfter:Date.now()+10000}])assert.throws(()=>validatePublicationDescriptor({...descriptor,...changes}),/Invalid/);
});
test('synthetic metadata controls exercise pure policy only, never actual Docker admission',()=>{
 const runId=randomUUID(),descriptor={runId,name:'coop-eh13-publication-'+runId,id:'a'.repeat(64),port:'56557',createdAfter:Date.now()};
 const actual={State:{Running:true},Id:descriptor.id,Name:'/'+descriptor.name,Image:PUBLICATION_IMAGE,Created:new Date().toISOString(),Config:{Image:PUBLICATION_IMAGE_REF,Labels:{'coop.enterprise.disposable':PUBLICATION_LABEL,'coop.enterprise.run':runId},Cmd:['postgres'],Entrypoint:['docker-entrypoint.sh'],Env:['POSTGRES_DB=eh02_disposable','POSTGRES_USER=eh02','POSTGRES_PASSWORD=eh02-disposable-only','PGDATA=/var/lib/postgresql/data']},HostConfig:{PortBindings:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:''}]},Tmpfs:{'/var/lib/postgresql/data':'rw'},Privileged:false},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:descriptor.port}]}},Mounts:[]};
 assert.match(validatePublicationContainer(actual,descriptor),/127\.0\.0\.1/);
 const classic=structuredClone(actual);classic.Image=PUBLICATION_IMAGE_CONFIG;assert.match(validatePublicationContainer(classic,descriptor),/127\.0\.0\.1/);
 const mutable=structuredClone(actual);mutable.Config.Image='pgvector/pgvector:pg16';assert.throws(()=>validatePublicationContainer(mutable,descriptor),/does not match/);
 const {port,...identity}=descriptor;
 const stopped=structuredClone(actual);stopped.State.Running=false;stopped.NetworkSettings.Ports={};
 assert.throws(()=>validatePublicationContainer(stopped,descriptor),/does not match/);
 assert.equal(validatePublicationCleanupContainer(stopped,identity),undefined);
 assert.throws(()=>validatePublicationCleanupContainer(stopped,{...identity,port}),/Invalid/);
 for(const changes of [{id:'b'.repeat(64)},{name:'other'},{runId:randomUUID()},{createdAfter:Date.now()-16*60*1000}])assert.throws(()=>validatePublicationCleanupContainer(stopped,{...identity,...changes}),/Invalid|does not match/);
 const changes=[v=>v.State.Running=false,v=>v.Id='b'.repeat(64),v=>v.Name='/other',v=>v.Image='other',v=>v.Created=new Date(descriptor.createdAfter-1000).toISOString(),v=>v.Config.Labels['coop.enterprise.run']=randomUUID(),v=>v.Config.Labels['coop.enterprise.disposable']='other',v=>v.HostConfig.PortBindings['5432/tcp'][0].HostIp='0.0.0.0',v=>v.HostConfig.PortBindings['5432/tcp'][0].HostPort='56557',v=>v.NetworkSettings.Ports['5432/tcp'][0].HostPort='56558',v=>v.HostConfig.Tmpfs={},v=>v.Mounts=[{Source:'/real-state'}],v=>v.HostConfig.Privileged=true,v=>v.Config.Cmd=['postgres','-c','config_file=/other'],v=>v.Config.Env.push('POSTGRES_DB=other'),v=>v.Config.Env.push('PGDATA=/other'),v=>v.Config.Entrypoint=['sh']];
 for(const change of changes){const modified=structuredClone(actual);change(modified);assert.throws(()=>validatePublicationContainer(modified,descriptor),/does not match/);if(change!==changes[0] && change!==changes[9])assert.throws(()=>validatePublicationCleanupContainer(modified,identity),/does not match/);}
});

test('declared database suite accepts its own descriptor and rejects a foreign suite',()=>{
 const runId=randomUUID(); const value={runId,name:'coop-eh13-publication-'+runId,id:'a'.repeat(64),port:'56557',createdAfter:Date.now(),suite:'jobs'};
 assert.match(validatePublicationDescriptor(value,'jobs'),/^postgresql:\/\/eh02:/);
 assert.throws(()=>validatePublicationDescriptor(value,'graph'),/Foreign/);
 assert.throws(()=>validatePublicationDescriptor({...value,suite:'publication'},'publication'),/Invalid/);
});

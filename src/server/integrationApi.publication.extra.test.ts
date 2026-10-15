import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {OrgStore} from '../server/orgStore';
import {UserStore} from '../server/users/userStore';
import {IntegrationConnectionStore} from '../server/integrationConnectionStore';
import {IntegrationScopePolicyStore} from '../server/integrationScopePolicyStore';
import {AuthPolicyStore} from '../server/sso/authPolicyStore';
import {loadWebhookConfig} from '../config/webhookConfig';
import databasePoolOptions from '../server/databasePoolOptions.cjs';
import type {WebhookServerRuntime} from '../webhooks/webhookServer';
const {publicationDatabaseFromEnvironment}=require('../../scripts/publication-test-fixture.mjs');
const url=publicationDatabaseFromEnvironment(process.env,'publication-extra');
const {migrationSourceManifest}=require('../../scripts/migration-source-manifest.mjs');
const main=require('../../dist/tests/publication-main.cjs') as typeof import('./integrationApi.publication.fixture');
const bounded=<T>(p:Promise<T>)=>Promise.race([p,delay(2500).then(()=>{throw new Error('Bounded additional control expired');})]);
test('independent actual main API-key and connection-generation publication races',async t=>{
 const pool=new Pool({...databasePoolOptions(url),max:3,application_name:'eh02-independent-extra',statement_timeout:4000});
 const mutation=new Pool({...databasePoolOptions(url),max:1,application_name:'eh02-independent-extra-mutation',statement_timeout:4000});
 const orgs=new OrgStore(pool,'synthetic-independent-extra'),users=new UserStore(pool);
 const connections=new IntegrationConnectionStore(pool,'synthetic-independent-extra'),policies=new IntegrationScopePolicyStore(pool),authPolicies=new AuthPolicyStore(pool);
 const originalGet=main.MainPolicyStore.prototype.get,originalFetch=globalThis.fetch;
 let runtime:WebhookServerRuntime|undefined,orgId:string|undefined,base='';
 let reads=0,target=0,enter=()=>{},release=()=>{},gate=Promise.resolve();
 let providerReply:undefined|(()=>Promise<Response>),vendorCount=0;
 const observations:Record<string,unknown>[]=[];
 const hold=(n:number)=>{reads=0;target=n;const entered=new Promise<void>(r=>enter=r);gate=new Promise<void>(r=>release=r);return {entered,release:()=>{target=0;release();}};};
 main.MainPolicyStore.prototype.get=async function(...args:unknown[]){const value=await Reflect.apply(originalGet,this,args);if(++reads===target){enter();await gate;}return value;};
 globalThis.fetch=async(input,init)=>{
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
  if(base && u.origin===base)return originalFetch(input,init);
  assert.equal(u.hostname,'slack.com','No external request allowed');assert.equal(u.pathname,'/api/search.messages');
  vendorCount++;if(providerReply)return providerReply();
  return new Response(JSON.stringify({ok:true,messages:{matches:[{channel:{id:'C1'},ts:'123',text:'SYNTHETIC_EXTRA_APPROVED_BODY'}]}}));
 };
 const request=async(token:string,operate=false)=>{
  const res=await originalFetch(base+'/v1/orgs/integrations/'+(operate?'operate':'scope?provider=slack'),{method:operate?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:operate?JSON.stringify({operation:'slack.searchMessages',args:['Decision']}):undefined,signal:AbortSignal.timeout(5000)});
  return {status:res.status,text:await res.text()};
 };
 try{
  assert.deepEqual((await pool.query('SELECT filename,checksum FROM schema_migrations ORDER BY filename')).rows,migrationSourceManifest());
  orgId=(await orgs.createOrganization('Independent publication race org','enterprise')).id;
  const actor=await users.createUser(orgId,'independent-extra@fixture.invalid','member');
  await authPolicies.upsertPolicy(orgId,{requireSso:false,allowPassword:true,allowGoogle:true});
  await connections.upsert(orgId,'slack','synthetic-extra-old-token',{metadata:{teamId:'extra'}});
  await policies.upsert(orgId,'slack',{version:1,mode:'allowlist',channels:[{id:'C1',name:'ExtraApproved'}],access:{mode:'organization-approved'}});
  const config=loadWebhookConfig({DATABASE_URL:url,GRAPH_CACHE_BACKEND:'memory'});config.tokenPools=[];for(const w of Object.values(config.webhooks))w.enabled=false;
  runtime=await main.createWebhookServer({config,serverConfig:{nodeEnv:'test',requireApiAuth:true,credentialsEncryptionKey:'synthetic-independent-extra',jobsWorkersEnabled:false,devMode:false}});
  await new Promise<void>(r=>runtime!.server.listen(0,'127.0.0.1',r));const address=runtime.server.address();assert(address && typeof address==='object');base='http://127.0.0.1:'+address.port;
  await t.test('API-key revocation waits through admitted final publication then commits',async()=>{
   const issued=await orgs.createApiKey(orgId!,'Independent extra key');const held=hold(2),events:string[]=[];
   const observer=(_req:unknown,res:any)=>{const end=res.end;res.end=(...args:unknown[])=>{if(res.statusCode===200)events.push('published');return Reflect.apply(end,res,args);};};
   runtime!.server.on('request',observer);
   const pending=request(issued.rawKey);let revoked:Promise<boolean>|undefined;
   try{
    await bounded(held.entered);const pid=(await mutation.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    revoked=new OrgStore(mutation).revokeApiKey(orgId!,issued.record.id).then(result=>{events.push('revoked');return result;});
    let waiting=false;for(let i=0;i<80;i++){const row=await pool.query('SELECT cardinality(pg_blocking_pids(pid)) AS n FROM pg_stat_activity WHERE pid=$1',[pid]);if(row.rows[0]?.n>0){waiting=true;break;}await delay(5);}assert(waiting);assert.deepEqual(events,[]);
    held.release();const result=await bounded(pending);assert.equal(result.status,200);assert.equal(await bounded(revoked),true);assert.deepEqual(events,['published','revoked']);
    assert.equal((await request(issued.rawKey)).status,401);observations.push({case:'apikey-admitted-revocation-order',events,afterRevocationStatus:401});
   }finally{held.release();await pending.catch(()=>undefined);await revoked?.catch(()=>undefined);runtime!.server.off('request',observer);}
  });
  await t.test('acknowledged allow-password=false before barrier denies captured metadata',async()=>{
   const session=await users.createSession(actor.id,orgId!,{authProvider:'password'}),held=hold(1),pending=request(session.token);
   try{await bounded(held.entered);await authPolicies.upsertPolicy(orgId!,{allowPassword:false});held.release();const result=await bounded(pending);assert.equal(result.status,403);assert(!result.text.includes('ExtraApproved'));observations.push({case:'password-policy-before-publication',status:result.status,protectedMetadata:false});}
   finally{held.release();await pending.catch(()=>undefined);await authPolicies.upsertPolicy(orgId!,{allowPassword:true});}
  });
  await t.test('same-metadata credential rotation after retrieval starts denies old private body',async()=>{
   const session=await users.createSession(actor.id,orgId!,{authProvider:'password'});let entered=()=>{},resume=()=>{};
   const entry=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>resume=r);
   providerReply=async()=>{entered();await wait;return new Response(JSON.stringify({ok:true,messages:{matches:[{channel:{id:'C1'},ts:'123',text:'SYNTHETIC_EXTRA_APPROVED_BODY'}]}}));};
   const old=(await connections.get(orgId!,'slack'))!,pending=request(session.token,true);
   try{await bounded(entry);await connections.upsert(orgId!,'slack','synthetic-extra-new-token',{metadata:{teamId:'extra'}});const current=(await connections.get(orgId!,'slack'))!;assert.notEqual(current.revision,old.revision);assert.deepEqual(current.metadata,old.metadata);resume();const result=await bounded(pending);assert.equal(result.status,403);assert(!result.text.includes('SYNTHETIC_EXTRA_APPROVED_BODY'));assert(!result.text.includes('synthetic-extra-old-token'));observations.push({case:'rotation-after-retrieval',status:result.status,metadataUnchanged:true,generationChanged:true,oldBodyReleased:false});}
   finally{resume();providerReply=undefined;await pending.catch(()=>undefined);}
  });
  console.log(JSON.stringify({actualMain:true,actualPG:true,controls:3,observations,syntheticInterceptedVendorCalls:vendorCount,externalCalls:0}));
 }finally{
  release();main.MainPolicyStore.prototype.get=originalGet;globalThis.fetch=originalFetch;
  if(runtime){runtime.server.closeAllConnections();await new Promise<void>(r=>runtime!.server.close(()=>r()));main.stopJobRuntime(runtime.jobs);}
  await main.closeMainDbPool();if(orgId)await pool.query('DELETE FROM organizations WHERE id=$1',[orgId]);await Promise.all([pool.end(),mutation.end()]);
 }
});

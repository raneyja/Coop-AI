import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import { handleIntegrationApiRequest } from './integrationApi';
import { resolveAuthContextDetailed } from './authMiddleware';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import type { WebhookServerRuntime } from '../webhooks/webhookServer';
import { loadWebhookConfig } from '../config/webhookConfig';
import { OrgStore } from './orgStore';
import { UserStore } from './users/userStore';
import { IntegrationConnectionStore } from './integrationConnectionStore';
import { IntegrationScopePolicyStore } from './integrationScopePolicyStore';
import { SsoConfigStore, ssoConfigFingerprint } from './sso/ssoConfigStore';
import { AuthPolicyStore } from './sso/authPolicyStore';
import { TEST_IDP_CERT, TEST_IDP_ENTITY_ID, TEST_IDP_SSO_URL } from './sso/samlTestFixtures';
import { hashApiKey } from './credentialCrypto';
import databasePoolOptions from './databasePoolOptions.cjs';

const { publicationDatabaseFromEnvironment } = require('../../scripts/publication-test-fixture.mjs');
const { runMigrations } = require('../../scripts/run-migrations.mjs');
const database=publicationDatabaseFromEnvironment();
const { createWebhookServer, closeMainDbPool, stopJobRuntime, MainPolicyStore, getMainPool } = require('../../dist/tests/publication-main.cjs') as { createWebhookServer: typeof import('../webhooks/webhookServer').createWebhookServer; closeMainDbPool: typeof import('./db').closeDbPool; stopJobRuntime: typeof import('../jobs/jobRuntime').stopJobRuntime; MainPolicyStore: typeof IntegrationScopePolicyStore; getMainPool: typeof import('./db').getDbPool };
const key='independent-main-http-synthetic-key';
const realFetch=globalThis.fetch;
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const bounded=<T>(p:Promise<T>)=>Promise.race([p,delay(2500).then(()=>{throw new Error('Independent fixture wait exceeded');})]);

test('actual main webhook HTTP with real session, policy and encrypted store owners',async t=>{
  const pool=new Pool({...databasePoolOptions(database),max:5,application_name:'eh02-main-http-review',connectionTimeoutMillis:1000,statement_timeout:5000,lock_timeout:3000});
  const orgStore=new OrgStore(pool,key),users=new UserStore(pool),store=new IntegrationConnectionStore(pool,key),policies=new IntegrationScopePolicyStore(pool);
  let runtime:WebhookServerRuntime|undefined,orgId:string|undefined,base='';
  const configs=new SsoConfigStore(pool),authPolicies=new AuthPolicyStore(pool);
  const mutationPool=new Pool({...databasePoolOptions(database),max:1,application_name:'eh02-publication-mutator',statement_timeout:5000,lock_timeout:3000});
  const mutationUsers=new UserStore(mutationPool);
  const originalPolicyGet=MainPolicyStore.prototype.get;
  let readCount=0,readToHold=0,enterRead:()=>void=()=>undefined,releaseRead:()=>void=()=>undefined,readGate:Promise<void>=Promise.resolve();
  MainPolicyStore.prototype.get=async function(org,provider){const record=await originalPolicyGet.call(this,org,provider);if(++readCount===readToHold){enterRead();await readGate;}return record;};
  const holdPolicy=(read:number)=>{readCount=0;readToHold=read;const entered=new Promise<void>(resolve=>enterRead=resolve);readGate=new Promise<void>(resolve=>releaseRead=resolve);return {entered,release:()=>{readToHold=0;releaseRead();}};};
  const events:string[]=[];let observePublication=false;
  let providerReply:((url:URL,init?:RequestInit)=>Promise<Response>)|undefined;
  let vendorRequests=0,contentRequests=0,refreshRequests=0;
  const bodyMarker='SYNTHETIC_APPROVED_BODY';
  const expiredAccess='synthetic-expired-access',refreshToken='synthetic-held-refresh',newAccess='synthetic-refreshed-access';
  const slackToken='synthetic-slack-access',installedToken='synthetic-installed-access';
  const request=async(path:string,token:string,method='GET',body?:unknown)=>{
    const response=await realFetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000),redirect:'manual'});
    const text=await response.text();for(const secret of [key,expiredAccess,refreshToken,newAccess,slackToken,installedToken,token])assert(!text.includes(secret),'No raw credential in HTTP response');
    return {status:response.status,text,headers:response.headers};
  };
  const operate=(token:string,operation='slack.searchMessages')=>request('/v1/orgs/integrations/operate',token,'POST',{operation,args:['Decision']});
  const policyGoogle=async()=>policies.upsert(orgId!,'google-docs',{version:1,mode:'allowlist',folders:[{id:'F1',name:'Approved folder',kind:'folder'}],expandedFolderIds:['F1'],access:{mode:'organization-approved'}});
  const expiredGoogle=async()=>{await store.upsert(orgId!,'google-docs',expiredAccess,{refreshToken,expiresAt:new Date(0),metadata:{displayName:'Original synthetic installation'}});await policyGoogle();};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
    if(base && url.origin===base)return realFetch(input,init);
    assert(['slack.com','oauth2.googleapis.com','www.googleapis.com'].includes(url.hostname),'No unexpected external request is permitted');
    vendorRequests++;
    if(url.hostname==='oauth2.googleapis.com'){
      assert.equal(url.pathname,'/token');assert.equal(init?.method,'POST');
      const form=new URLSearchParams(String(init?.body));assert.equal(form.get('client_id'),'synthetic-docs-client');assert.equal(form.get('client_secret'),'synthetic-docs-secret');
      if(form.get('grant_type')==='refresh_token'){assert.equal(form.get('refresh_token'),refreshToken);refreshRequests++;assert(providerReply,'Refresh requires explicit synthetic held response');return providerReply(url,init);}
      assert.equal(form.get('grant_type'),'authorization_code');assert.equal(form.get('code'),'synthetic-install-code');
      return json({access_token:installedToken,refresh_token:'synthetic-install-refresh',expires_in:3600});
    }
    if(url.pathname==='/oauth2/v2/userinfo'){assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+installedToken);return json({name:'Replacement synthetic installation',email:'replacement@fixture.invalid'});}
    contentRequests++;if(providerReply)return providerReply(url,init);
    if(url.hostname==='slack.com'){
      assert.equal(url.pathname,'/api/search.messages');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+slackToken);
      return json({ok:true,messages:{matches:[{channel:{id:'C1',name:'Approved'},ts:'123.000001',text:bodyMarker,user:'U1'}]}});
    }
    throw new Error('Unexpected synthetic content path');
  };
  try{
    assert.deepEqual((await pool.query('SELECT current_database() AS db,current_user AS usr')).rows[0],{db:'eh02_disposable',usr:'eh02'});
    assert.equal((await pool.query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0].ledger,null,'Fresh owned fixture only; no unknown schema DROP');
    await runMigrations({databaseUrl:database,migrationsDir:'migrations',log:()=>undefined});
    const {migrationSourceManifest}=require('../../scripts/migration-source-manifest.mjs');
    assert.deepEqual((await pool.query('SELECT filename,checksum FROM schema_migrations ORDER BY filename')).rows,migrationSourceManifest());
    orgId=(await orgStore.createOrganization('Independent EH02 main HTTP synthetic organization','enterprise')).id;
    await configs.upsertConfig(orgId,{provider:'saml',idpEntityId:TEST_IDP_ENTITY_ID,idpSsoUrl:TEST_IDP_SSO_URL,idpX509Cert:TEST_IDP_CERT});
    await authPolicies.upsertPolicy(orgId,{requireSso:false,allowPassword:true,allowGoogle:true});
    const member=await users.createUser(orgId,'member@fixture.invalid','member'),admin=await users.createUser(orgId,'admin@fixture.invalid','admin');
    const memberSession=await users.createSession(member.id,orgId,{authProvider:'password'}),adminSession=await users.createSession(admin.id,orgId,{authProvider:'password'});
    assert.equal((await users.resolveUserSession(memberSession.token))?.userId,member.id);
    await store.upsert(orgId,'slack',slackToken,{metadata:{teamId:'synthetic-team'}});
    await policies.upsert(orgId,'slack',{version:1,mode:'allowlist',channels:[{id:'C1',name:'Approved'}],access:{mode:'member-grants',members:{[member.id]:['C1'],[admin.id]:['C1']}}});
    const config=loadWebhookConfig({DATABASE_URL:database,GRAPH_CACHE_BACKEND:'memory'});
    config.tokenPools=[];for(const v of Object.values(config.webhooks))v.enabled=false;
    await pool.query("ALTER ROLE eh02 SET deadlock_timeout='20ms'");
    const driverErrors:string[]=[];
    const mainPool=await getMainPool(database);assert(mainPool);
    mainPool.on('connect',client=>{const query=client.query;client.query=((...args:Parameters<typeof query>)=>{
      const result:unknown=Reflect.apply(query,client,args);
      return result instanceof Promise ? result.catch((error:unknown)=>{if(error && typeof error==='object' && 'code' in error)driverErrors.push(String(error.code));throw error;}) : result;
    }) as typeof query;});
    runtime=await createWebhookServer({config,serverConfig:{nodeEnv:'test',requireApiAuth:true,credentialsEncryptionKey:key,jobsWorkersEnabled:false,devMode:false,ssoBaseUrl:'https://synthetic-saml.invalid'}});
    runtime.server.on('request',(_req,res)=>{const end=res.end;res.end=((...args:Parameters<typeof end>)=>{if(observePublication && res.statusCode===200)events.push('published');return Reflect.apply(end,res,args);}) as typeof end;});
    await new Promise<void>(resolve=>runtime!.server.listen(0,'127.0.0.1',resolve));const address=runtime.server.address();assert(address && typeof address==='object');base='http://127.0.0.1:'+address.port;
    await t.test('actual UserStore human session reaches main scope and main operate with an authorized body',async()=>{
      const scope=await request('/v1/orgs/integrations/scope?provider=slack',memberSession.token);assert.equal(scope.status,200);assert.equal(JSON.parse(scope.text).allowed,true);assert.deepEqual(JSON.parse(scope.text).slack.channelIds,['C1']);
      const response=await operate(memberSession.token);assert.equal(response.status,200);assert(response.text.includes(bodyMarker));assert.equal(contentRequests,1);
    });
    await t.test('revoked actual human session cannot publish scope metadata or invoke vendor retrieval',async()=>{
      const revoked=await users.createSession(member.id,orgId!,{authProvider:'password'});await users.revokeSessionByToken(revoked.token);const count=vendorRequests;
      const scope=await request('/v1/orgs/integrations/scope?provider=slack',revoked.token);assert.equal(scope.status,401);assert(!scope.text.includes('Approved'));assert.equal(vendorRequests,count);
    });
    await t.test('revocation while actual policy SELECT is blocked denies metadata at main publication',async()=>{
      const captured=await users.createSession(member.id,orgId!,{authProvider:'password'});const c=await pool.connect();let pending:ReturnType<typeof request>|undefined;
      try{
        await c.query('BEGIN');await c.query('LOCK TABLE org_integration_policies IN ACCESS EXCLUSIVE MODE');
        pending=request('/v1/orgs/integrations/scope?provider=slack',captured.token);
        let blocked=false;for(let i=0;i<80;i++){await c.query('SELECT pg_stat_clear_snapshot()');const row=await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM org_integration_policies%' AND pid<>pg_backend_pid()");if(row.rows[0].n>0){blocked=true;break;}await delay(10);}assert(blocked,'Actual main server policy SELECT must block before revocation');
        await users.revokeSessionByToken(captured.token);await c.query('COMMIT');const response=await bounded(pending);assert.equal(response.status,403);assert(!response.text.includes('Approved'));
      }finally{await c.query('ROLLBACK');c.release();await pending?.catch(()=>undefined);}
    });
    await t.test('actual administrative disconnect refuses a member session without removing installation',async()=>{
      const before=await store.get(orgId!,'slack');const response=await request('/v1/admin/integrations/slack',memberSession.token,'DELETE');assert.equal(response.status,403);assert.deepEqual(await store.get(orgId!,'slack'),before);
    });
    await t.test('acknowledged main administrative disconnect defeats held actual-service refresh without resurrection or content',async()=>{
      await expiredGoogle();let entered!:()=>void,release!:()=>void;const entry=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
      providerReply=async url=>{assert.equal(url.hostname,'oauth2.googleapis.com');entered();await gate;return json({access_token:newAccess,refresh_token:'synthetic-new-refresh',expires_in:3600});};
      const beforeContent=contentRequests;const pending=operate(memberSession.token,'googleDocs.searchDocuments');
      try{await bounded(entry);const disconnected=await request('/v1/admin/integrations/google-docs',adminSession.token,'DELETE');assert.equal(disconnected.status,200);assert.equal(await store.get(orgId!,'google-docs'),undefined);assert.equal(await policies.get(orgId!,'google-docs'),undefined);release();const response=await bounded(pending);assert.equal(response.status,503);assert(!response.text.includes(bodyMarker));assert.equal(contentRequests,beforeContent);assert.equal(await store.get(orgId!,'google-docs'),undefined);}
      finally{release();providerReply=undefined;await pending.catch(()=>undefined);}
    });
    await t.test('actual install URL/callback reconnect stays byte-identical after earlier held refresh finishes',async()=>{
      await expiredGoogle();let entered!:()=>void,release!:()=>void;const entry=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
      providerReply=async url=>{assert.equal(url.hostname,'oauth2.googleapis.com');entered();await gate;return json({access_token:newAccess,refresh_token:'synthetic-new-refresh',expires_in:3600});};
      const beforeContent=contentRequests;const pending=operate(memberSession.token,'googleDocs.searchDocuments');
      try{
        await bounded(entry);assert.equal((await request('/v1/admin/integrations/google-docs',adminSession.token,'DELETE')).status,200);
        const install=await request('/v1/google-docs/app/install-url',adminSession.token);assert.equal(install.status,200);const state=new URL(JSON.parse(install.text).url).searchParams.get('state');assert(state);
        const callback=await request('/v1/google-docs/app/callback?code=synthetic-install-code&state='+encodeURIComponent(state),adminSession.token);assert.equal(callback.status,200);
        await policyGoogle();const replacement=(await pool.query("SELECT * FROM org_integration_connections WHERE org_id=$1 AND provider='google-docs'",[orgId])).rows[0];assert(replacement);const replacementPolicy=await policies.get(orgId!,'google-docs');
        release();const response=await bounded(pending);assert.equal(response.status,503);assert(!response.text.includes(bodyMarker));assert.equal(contentRequests,beforeContent);
        assert.deepEqual((await pool.query("SELECT * FROM org_integration_connections WHERE org_id=$1 AND provider='google-docs'",[orgId])).rows[0],replacement);assert.deepEqual(await policies.get(orgId!,'google-docs'),replacementPolicy);assert.equal(await store.getAccessToken(orgId!,'google-docs',replacement.revision),installedToken);
      }finally{release();providerReply=undefined;await pending.catch(()=>undefined);}
    });
    await t.test('disconnect after actual vendor retrieval starts fences old content at main publication',async()=>{
      let entered!:()=>void,release!:()=>void;const entry=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
      providerReply=async url=>{assert.equal(url.hostname,'slack.com');entered();await gate;return json({ok:true,messages:{matches:[{channel:{id:'C1'},ts:'123.000001',text:bodyMarker,user:'U1'}]}});};
      const pending=operate(memberSession.token);
      try{await bounded(entry);assert.equal((await request('/v1/admin/integrations/slack',adminSession.token,'DELETE')).status,200);release();const response=await bounded(pending);assert.equal(response.status,403);assert(!response.text.includes(bodyMarker));}
      finally{release();providerReply=undefined;await pending.catch(()=>undefined);}
    });
    const resetSlack=async()=>{
      await pool.query("UPDATE organizations SET plan='enterprise',operator_status='active' WHERE id=$1",[orgId]);
      await users.setUserRole(member.id,'member');await users.reactivateUser(member.id);
      await configs.setEnabled(orgId!,true);await authPolicies.upsertPolicy(orgId!,{requireSso:false,allowPassword:true,allowGoogle:true});
      await store.upsert(orgId!,'slack',slackToken,{metadata:{teamId:'synthetic-team'}});
      await policies.upsert(orgId!,'slack',{version:1,mode:'allowlist',channels:[{id:'C1',name:'Approved'}],access:{mode:'organization-approved'}});
    };
    const fresh=async(ttlMs=60_000)=>users.createSession(member.id,orgId!,{authProvider:'password',ttlMs});
    const scope=(token:string)=>request('/v1/orgs/integrations/scope?provider=slack',token);
    const blocked=async(pid:number)=>{
      for(let i=0;i<120;i++){
        await pool.query('SELECT pg_stat_clear_snapshot()');
        const row=await pool.query("SELECT cardinality(pg_blocking_pids(pid)) AS n FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[pid]);
        if(row.rows[0]?.n>0)return;await delay(10);
      }throw new Error('Actual mutation client must wait on publication row locks');
    };
    for(const endpoint of ['scope','operate'] as const)await t.test(`${endpoint}: original late final-policy session revoke cannot ACK then publish protected200`,async()=>{
      await resetSlack();const session=await fresh(),held=holdPolicy(2);let settled=false;
      const pending=(endpoint==='scope'?scope(session.token):operate(session.token)).then(result=>{settled=true;return result;});
      try{
        await bounded(held.entered);assert.equal(await users.resolveUserSession(session.token)!==undefined,true);
        // The old defect ACKed here while stale auth was private. Real locks now
        // force revocation to await the bounded publication client's destruction.
        await bounded(mutationUsers.revokeSessionByToken(session.token));
        assert.equal(await users.resolveUserSession(session.token),undefined);assert.equal(settled,false);
        held.release();const result=await bounded(pending);assert.equal(result.status,503);assert(!result.text.includes('Approved'));assert(!result.text.includes(bodyMarker));
      }finally{held.release();await pending.catch(()=>undefined);}
    });
    for(const endpoint of ['scope','operate'] as const)await t.test(`${endpoint}: admitted publication row locks delay revocation ACK until synchronous response write`,async()=>{
      await resetSlack();const session=await fresh(),held=holdPolicy(2);events.length=0;observePublication=true;
      const pending=endpoint==='scope'?scope(session.token):operate(session.token);let mutation:Promise<void>|undefined,ack=false;
      try{
        await bounded(held.entered);const pid=(await mutationPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        mutation=mutationUsers.revokeSessionByToken(session.token).then(()=>{ack=true;events.push('revoked');});
        await blocked(pid);assert.equal(ack,false);assert.deepEqual(events,[]);
        held.release();const result=await bounded(pending);assert.equal(result.status,200);await bounded(mutation);
        assert.deepEqual(events,['published','revoked']);assert.equal(await users.resolveUserSession(session.token),undefined);
      }finally{held.release();observePublication=false;await pending.catch(()=>undefined);await mutation?.catch(()=>undefined);}
    });
    for(const endpoint of ['scope','operate'] as const)await t.test(`${endpoint}: expired session after final lock wait releases no protected response`,async()=>{
      await resetSlack();const session=await fresh(1000),held=holdPolicy(2);const pending=endpoint==='scope'?scope(session.token):operate(session.token);
      try{await bounded(Promise.race([held.entered,pending.then(result=>{throw new Error('Request ended before expiry barrier: '+result.status+' '+result.text);})]));await delay(1100);held.release();const result=await bounded(pending);assert.equal(result.status,403);assert(!result.text.includes('Approved'));assert(!result.text.includes(bodyMarker));}
      finally{held.release();await pending.catch(()=>undefined);}
    });
    const mutations=[
      ['session revocation',async(token:string)=>users.revokeSessionByToken(token)],
      ['role change',async()=>{await users.setUserRole(member.id,'admin');}],
      ['offboard',async()=>{await users.deactivateUser(member.id);}],
      ['plan change',async()=>{await orgStore.setOrganizationPlan(orgId!,'pro');}],
      ['suspension',async()=>{await orgStore.suspendOrganization(orgId!,'Synthetic bounded test');}],
      ['integration source policy',async()=>{await policies.upsert(orgId!,'slack',{version:1,mode:'allowlist',channels:[]});}],
      ['same metadata reconnect revision',async()=>{await store.delete(orgId!,'slack');await store.upsert(orgId!,'slack',slackToken,{metadata:{teamId:'synthetic-team'}});}],
      ['sign-in policy',async()=>{await authPolicies.upsertPolicy(orgId!,{requireSso:true});}]
    ] as const;
    for(const [name,mutate] of mutations)await t.test(`scope: acknowledged ${name} before barrier admission rejects captured metadata`,async()=>{
      await resetSlack();const session=await fresh(),held=holdPolicy(1);const pending=scope(session.token);
      try{await bounded(held.entered);await mutate(session.token);held.release();const result=await bounded(pending);assert.equal(result.status,403);assert(!result.text.includes('Approved'));}
      finally{held.release();await pending.catch(()=>undefined);}
    });
    await t.test('bound SAML config/session remains positive then actual config change before admission denies',async()=>{
      await resetSlack();const cfg=(await configs.getConfig(orgId!))!;
      const session=await users.createSession(member.id,orgId!,{authProvider:'saml',samlConfigHash:ssoConfigFingerprint(cfg)});
      assert.equal((await scope(session.token)).status,200);
      const held=holdPolicy(1),pending=scope(session.token);
      try{await bounded(held.entered);await configs.setEnabled(orgId!,false);held.release();const result=await bounded(pending);assert.equal(result.status,403);assert(!result.text.includes('Approved'));}
      finally{held.release();await pending.catch(()=>undefined);}
    });
    await t.test('API key actual positive then acknowledged deletion before final admission denies',async()=>{
      await resetSlack();const issued=await orgStore.createApiKey(orgId!,'Synthetic publication control');assert.equal((await scope(issued.rawKey)).status,200);
      const held=holdPolicy(1),pending=scope(issued.rawKey);
      try{await bounded(held.entered);assert.equal(await orgStore.revokeApiKey(orgId!,issued.record.id),true);held.release();assert.equal((await bounded(pending)).status,403);}
      finally{held.release();await pending.catch(()=>undefined);}
    });
    await t.test('actual conflicting connection row lock times out, rolls back and never publishes captured metadata',async()=>{
      await resetSlack();const session=await fresh(),c=await mutationPool.connect();
      try{
        await c.query('BEGIN');await c.query("SELECT org_id FROM org_integration_connections WHERE org_id=$1 AND provider='slack' FOR UPDATE",[orgId]);
        const start=Date.now(),result=await scope(session.token);assert.equal(result.status,503);assert(Date.now()-start<2200);assert(!result.text.includes('Approved'));
        await c.query("UPDATE organizations SET name=name WHERE id=$1",[orgId]); // publication org lock was released
      }finally{await c.query('ROLLBACK');c.release();}
    });
    await t.test('real publication deadlock victim rolls back and exposes no protected metadata or driver detail',async()=>{
      await resetSlack();const session=await fresh();const beforeErrors=driverErrors.length;
      // Main sessions were created with20ms detector; this competing transaction
      // uses5s so the actual publication query is the detected victim.
      const c=await mutationPool.connect();let pending:ReturnType<typeof scope>|undefined,orgWait:Promise<unknown>|undefined;
      try{
        await c.query('BEGIN');await c.query("SET LOCAL deadlock_timeout='5s'");await c.query("SELECT org_id FROM org_integration_connections WHERE org_id=$1 AND provider='slack' FOR UPDATE",[orgId]);
        pending=scope(session.token);
        let waiting=false;for(let i=0;i<80;i++){await c.query('SELECT pg_stat_clear_snapshot()');const q=await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM org_integration_connections%FOR SHARE%'");if(q.rows[0].n>0){waiting=true;break;}await delay(10);}assert(waiting);
        orgWait=c.query("UPDATE organizations SET name=name WHERE id=$1",[orgId]);
        const result=await bounded(pending);assert.equal(result.status,503);assert(!result.text.includes('Approved'));assert(!result.text.includes('deadlock'));assert(driverErrors.slice(beforeErrors).includes('40P01'),'Actual PostgreSQL deadlock error required, not timeout or a fake driver error');await bounded(orgWait);
      }finally{await c.query('ROLLBACK');c.release();await pending?.catch(()=>undefined);await orgWait?.catch(()=>undefined);await pool.query("ALTER ROLE eh02 RESET deadlock_timeout");}
    });
    await t.test('HTTP disconnect while final read held releases publication locks and clients without writing a body',async()=>{
      await resetSlack();const session=await fresh(),held=holdPolicy(2),controller=new AbortController();
      const pending=realFetch(base+'/v1/orgs/integrations/scope?provider=slack',{headers:{authorization:'Bearer '+session.token},signal:controller.signal});
      try{
        await bounded(held.entered);controller.abort();await assert.rejects(()=>pending);
        await bounded(mutationUsers.revokeSessionByToken(session.token));held.release();await delay(30);
        const client=await mutationPool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='250ms'");await client.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[orgId]);}finally{await client.query('ROLLBACK');client.release();}
      }finally{controller.abort();held.release();await pending.catch(()=>undefined);}
    });

    const orderedMutations=[
      ['role',async(token:string)=>{await mutationUsers.setUserRole(member.id,'admin');}],
      ['suspension',async()=>{await new OrgStore(mutationPool,key).suspendOrganization(orgId!,'Synthetic bounded test');}],
      ['connection delete',async()=>{await new IntegrationConnectionStore(mutationPool,key).delete(orgId!,'slack');}],
      ['integration policy',async()=>{await new IntegrationScopePolicyStore(mutationPool).upsert(orgId!,'slack',{version:1,mode:'allowlist',channels:[]});}],
      ['SSO config',async()=>{await new SsoConfigStore(mutationPool).setEnabled(orgId!,false);}],
      ['missing auth-policy insertion FK',async()=>{await new AuthPolicyStore(mutationPool).upsertPolicy(orgId!,{requireSso:true});}]
    ] as const;
    for(const [name,mutate] of orderedMutations)await t.test(`actual ${name} mutation cannot ACK ahead of admitted scope publication`,async()=>{
      await resetSlack();if(name==='missing auth-policy insertion FK')await pool.query('DELETE FROM org_auth_policy WHERE org_id=$1',[orgId]);
      const session=await fresh(),held=holdPolicy(2);events.length=0;observePublication=true;
      const pending=scope(session.token);let mutation:Promise<void>|undefined,ack=false;
      try{
        await bounded(held.entered);const pid=(await mutationPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        mutation=mutate(session.token).then(()=>{ack=true;events.push('mutation');});await blocked(pid);assert.equal(ack,false);assert.deepEqual(events,[]);
        held.release();assert.equal((await bounded(pending)).status,200);await bounded(mutation);assert.deepEqual(events,['published','mutation']);
      }finally{held.release();observePublication=false;await pending.catch(()=>undefined);await mutation?.catch(()=>undefined);}
    });
    for(const endpoint of ['scope','operate'] as const)await t.test(`${endpoint}: missing durable publication pool fails closed before vendor retrieval`,async()=>{
      await resetSlack();const session=await fresh(),headers={authorization:'Bearer '+session.token};
      const auth=await resolveAuthContextDetailed(headers,orgStore,undefined,true,users);assert(auth.auth);
      let status=0,payload='';const response={writeHead:(value:number)=>{status=value;},end:(value:string)=>{payload=value;}} as unknown as ServerResponse;
      const before=vendorRequests;await handleIntegrationApiRequest({method:endpoint==='scope'?'GET':'POST',pathname:'/v1/orgs/integrations/'+endpoint,query:new URLSearchParams('provider=slack'),headers,body:endpoint==='scope'?undefined:{operation:'slack.searchMessages',args:['Decision']}},response,{orgStore,userStore:users,integrationStore:store,scopePolicyStore:policies},auth.auth);
      assert.equal(status,503);assert(!payload.includes('Approved'));assert.equal(vendorRequests,before);
    });
    await t.test('real pool checkout exhaustion is bounded and late acquisition releases its client',async()=>{
      await resetSlack();const session=await fresh(),checkoutPool=new Pool({...databasePoolOptions(database),max:1,application_name:'eh02-publication-checkout'}),occupied=await checkoutPool.connect();
      const server=createServer(async(req,res)=>{const headers={authorization:req.headers.authorization};const auth=await resolveAuthContextDetailed(headers,orgStore,undefined,true,users);
        await handleIntegrationApiRequest({method:'GET',pathname:'/v1/orgs/integrations/scope',query:new URLSearchParams('provider=slack'),headers,body:undefined},res,{pool:checkoutPool,orgStore,userStore:users,integrationStore:store,scopePolicyStore:policies},auth.auth);});
      let occupiedReleased=false;
      try{
        await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address && typeof address==='object');
        const started=Date.now(),response=await realFetch('http://127.0.0.1:'+address.port+'/v1/orgs/integrations/scope',{headers:{authorization:'Bearer '+session.token},signal:AbortSignal.timeout(3000)});
        assert.equal(response.status,503);assert(!(await response.text()).includes('Approved'));assert(Date.now()-started<2300);assert.equal(checkoutPool.waitingCount,1);
        occupied.release();occupiedReleased=true;for(let i=0;i<30 && (checkoutPool.waitingCount || checkoutPool.idleCount!==1);i++)await delay(10);assert.equal(checkoutPool.waitingCount,0);assert.equal(checkoutPool.idleCount,1);
      }finally{if(!occupiedReleased)occupied.release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await checkoutPool.end();}
    });
    await t.test('response size/serialization admission rejects privately before final transaction',async()=>{
      await resetSlack();const session=await fresh();readCount=0;readToHold=0;
      providerReply=async()=>json({ok:true,messages:{matches:[{channel:{id:'C1'},ts:'123.000001',text:'x'.repeat(300_000),user:'U1'}]}});
      try{const response=await operate(session.token);assert.equal(response.status,502);assert(response.text.length<500);assert.equal(readCount,1,'No final policy read or publication transaction for rejected serialization');}
      finally{providerReply=undefined;}
    });
    console.log(JSON.stringify({suite:'EH02 actual main HTTP/PG synthetic auth',groupedControls:36,vendorCallsSyntheticIntercepted:vendorRequests,contentCallsSyntheticIntercepted:contentRequests,actualRefreshServiceCalls:refreshRequests,externalRequestsSent:0,actorOwner:'actual UserStore issued and revoked sessions',mainFactory:'actual createWebhookServer',sourceReview:'V3_AUTHOR_ONLY_REQUIRES_INDEPENDENT_REVIEW',live:'OPEN'}));
  }finally{
    providerReply=undefined;releaseRead();MainPolicyStore.prototype.get=originalPolicyGet;
    if(runtime){runtime.server.closeAllConnections();await new Promise<void>(resolve=>runtime!.server.close(()=>resolve()));stopJobRuntime(runtime.jobs);}
    globalThis.fetch=realFetch;await closeMainDbPool();
    if(orgId)await pool.query('DELETE FROM organizations WHERE id=$1',[orgId]);await Promise.all([pool.end(),mutationPool.end()]);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer, type Server, type ServerResponse} from 'node:http';
import path from 'node:path';
import {Pool} from 'pg';
import {OrgStore} from '../src/server/orgStore';
import {UserStore} from '../src/server/users/userStore';
import {IntegrationConnectionStore} from '../src/server/integrationConnectionStore';
import {IntegrationScopePolicyStore} from '../src/server/integrationScopePolicyStore';
import {AuthPolicyStore} from '../src/server/sso/authPolicyStore';
import {loadWebhookConfig} from '../src/config/webhookConfig';
import type {WebhookServerRuntime} from '../src/webhooks/webhookServer';

const {publicationDatabaseFromEnvironment}=require('./publication-test-fixture.mjs');
const database:string=publicationDatabaseFromEnvironment(process.env,'compatibility');
// Explicit used surface of the frozen source-built artifact; its erased type-only
// dependencies are not substituted with current release types.
type PriorClientSurface={getIntegrationCredentials(base:string,provider:'slack'):Promise<unknown>};
const {CoopBackendClient:PriorClient}=require(path.resolve('dist/tests/compatibility/prior-client.cjs')) as {CoopBackendClient:new(options:{getToken:()=>Promise<string|undefined>})=>PriorClientSurface};
const {CoopBackendClient:CurrentClient}=require(path.resolve('dist/tests/compatibility/current-client.cjs')) as typeof import('../src/api/CoopBackendClient');
const priorApi=require(path.resolve('dist/tests/compatibility/prior-api.cjs')) as {
  handleIntegrationApiRequest(request:{method:string;pathname:string;query:URLSearchParams;headers:Record<string,string>;body:unknown},response:ServerResponse,deps:object):Promise<boolean>
};
const main=require(path.resolve('dist/tests/compatibility/backend.cjs')) as typeof import('../src/server/integrationApi.publication.fixture');
const closeServer=async(server:Server)=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));};

test('pinned 0.1.13/current clients preserve safe API-first integration rollout',async t=>{
  const pool=new Pool({connectionString:database,ssl:false});
  const key='synthetic-compatibility-encryption-key';
  const sharedToken='synthetic-compatibility-server-only-token';
  const orgs=new OrgStore(pool,key),users=new UserStore(pool);
  const connections=new IntegrationConnectionStore(pool,key),policies=new IntegrationScopePolicyStore(pool);
  let runtime:WebhookServerRuntime|undefined,oldServer:Server|undefined,orgId:string|undefined;
  let vendorCalls=0,oldDependencies=0;
  const paths:string[]=[],responses:{status:number;body:string}[]=[];
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
    assert.equal(url.hostname,'slack.com','No external request is permitted');
    assert.equal(url.pathname,'/api/search.messages');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+sharedToken);
    vendorCalls++;
    return new Response(JSON.stringify({ok:true,messages:{matches:[{channel:{id:'C1',name:'Approved'},ts:'123.000001',text:'SYNTHETIC_COMPATIBILITY_BODY',user:'U1'}]}}),{headers:{'content-type':'application/json'}});
  };
  try {
    orgId=(await orgs.createOrganization('Synthetic versioned client fixture','enterprise')).id;
    const member=await users.createUser(orgId,'compatibility@fixture.invalid','member');
    const session=await users.createSession(member.id,orgId,{authProvider:'password'});
    await new AuthPolicyStore(pool).upsertPolicy(orgId,{requireSso:false,allowPassword:true,allowGoogle:true});
    await connections.upsert(orgId,'slack',sharedToken,{metadata:{teamId:'synthetic-compatibility'}});
    await policies.upsert(orgId,'slack',{version:1,mode:'allowlist',channels:[{id:'C1',name:'Approved'}],access:{mode:'member-grants',members:{[member.id]:['C1']}}});
    const config=loadWebhookConfig({DATABASE_URL:database,GRAPH_CACHE_BACKEND:'memory'});
    config.tokenPools=[];for(const item of Object.values(config.webhooks))item.enabled=false;
    runtime=await main.createWebhookServer({config,serverConfig:{nodeEnv:'test',requireApiAuth:true,credentialsEncryptionKey:key,jobsWorkersEnabled:false,devMode:false}});
    runtime.server.on('request',(request,response)=>{
      paths.push(new URL(request.url!,'http://localhost').pathname);
      const chunks:Buffer[]=[];const write=response.write.bind(response),end=response.end.bind(response);
      response.write=((chunk:unknown,...args:unknown[])=>{if(chunk!==undefined)chunks.push(Buffer.from(chunk as string));return Reflect.apply(write,response,[chunk,...args]);}) as typeof response.write;
      response.end=((chunk:unknown,...args:unknown[])=>{if(chunk!==undefined&&typeof chunk!=='function')chunks.push(Buffer.from(chunk as string));responses.push({status:response.statusCode,body:Buffer.concat(chunks).toString()});return Reflect.apply(end,response,[chunk,...args]);}) as typeof response.end;
    });
    await new Promise<void>(resolve=>runtime!.server.listen(0,'127.0.0.1',resolve));
    const address=runtime.server.address();assert(address&&typeof address==='object');
    const base='http://127.0.0.1:'+address.port;
    await t.test('prior actual credential client fails clearly with410 and no credential/vendor access',async()=>{
      const client=new PriorClient({getToken:async()=>session.token});
      await assert.rejects(client.getIntegrationCredentials(base,'slack'),/Update Coop|upgrade/i);
      assert.equal(responses.at(-1)?.status,410);assert.equal(vendorCalls,0);
      assert(!responses.at(-1)?.body.includes(sharedToken));
    });
    await t.test('invalid prior client remains unauthorized before credential access',async()=>{
      const client=new PriorClient({getToken:async()=>'synthetic-invalid-session'});
      await assert.rejects(client.getIntegrationCredentials(base,'slack'));
      assert.equal(responses.at(-1)?.status,401);assert.equal(vendorCalls,0);
    });
    await t.test('current actual client uses durable scoped HTTP proxy without receiving credentials',async()=>{
      const client=new CurrentClient({getToken:async()=>session.token});
      const scope=await client.getIntegrationScope(base,'slack');assert.equal(scope.allowed,true);
      const result=await client.executeIntegrationOperation(base,'slack.searchMessages',['Decision']);
      assert.equal(result[0]?.channelId,'C1');assert.equal(result[0]?.text,'SYNTHETIC_COMPATIBILITY_BODY');
      assert.equal(vendorCalls,1);assert(!JSON.stringify(result).includes(sharedToken));
      assert(!('getIntegrationCredentials' in client));
    });
    await t.test('extension-first against pinned prior API fails404 without raw credential fallback',async()=>{
      const forbidden=new Proxy({}, {get(){oldDependencies++;throw new Error('Unsupported operation must not access prior credentials');}});
      const oldPaths:string[]=[];
      oldServer=createServer(async(req,res)=>{
        const url=new URL(req.url!,'http://localhost');oldPaths.push(url.pathname);
        const handled=await priorApi.handleIntegrationApiRequest({method:req.method!,pathname:url.pathname,query:url.searchParams,headers:{authorization:String(req.headers.authorization)},body:undefined},res,forbidden);
        if(!handled){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:'not_found'}));}
      });
      await new Promise<void>(resolve=>oldServer!.listen(0,'127.0.0.1',resolve));
      const address=oldServer.address();assert(address&&typeof address==='object');
      const client=new CurrentClient({getToken:async()=>session.token});
      await assert.rejects(client.executeIntegrationOperation('http://127.0.0.1:'+address.port,'slack.searchMessages',['Decision']));
      assert.deepEqual(oldPaths,['/v1/orgs/integrations/operate']);assert.equal(oldDependencies,0);assert.equal(vendorCalls,1);
    });
    assert(responses.every(response=>!response.body.includes(sharedToken)));
    console.log(JSON.stringify({suite:'VERSIONED_0.1.13_CURRENT_CLIENT_API_ACTUAL_HTTP_PG',controls:4,paths,syntheticVendorCalls:vendorCalls,externalCalls:0,scope:'Source-built pinned client/prior API handler; current actual backend and PG. Native installed VSIX and full prior backend fleet deployment remain separate.'}));
  } finally {
    globalThis.fetch=realFetch;
    if(oldServer)await closeServer(oldServer);
    if(runtime){await closeServer(runtime.server);await main.stopJobRuntime(runtime.jobs);const backend=runtime.jobs.queue.getBackend();if('close' in backend&&typeof backend.close==='function')await backend.close();}
    await main.closeMainDbPool();if(orgId)await pool.query('DELETE FROM organizations WHERE id=$1',[orgId]);await pool.end();
  }
});

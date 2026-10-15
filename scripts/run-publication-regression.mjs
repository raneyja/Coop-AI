import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUBLICATION_IMAGE,PUBLICATION_IMAGE_REF,PUBLICATION_IMAGE_IDS,PUBLICATION_LABEL,rejectPublicationTargetOverrides,validatePublicationContainer,validatePublicationCleanupContainer,inspectLocalPublicationContainer} from './publication-test-fixture.mjs';

import {databaseSuite} from './enterprise-database-suites.mjs';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runId=randomUUID(),name='coop-eh13-publication-'+runId;
let descriptor,ownedIdentity,signal,createdAfter,runDirectory,result;
let activeSuite = 'publication';
const runnerCancellation = new AbortController();
const stopped=()=>{if(signal)throw new Error('Publication runner cancelled');};
const stop=(value)=>{signal ??= value;runnerCancellation.abort(value);};
process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));

/** Required commands settle only on physical close, never a kill request or exit. */
export async function command(args,logName,{directory=runDirectory,abortSignal=runnerCancellation.signal,timeoutMs=120000,killGraceMs=3000}={}) {
  if(abortSignal.aborted)throw new Error('Required publication test process cancelled before start');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(killGraceMs)||killGraceMs<1)throw new Error('Invalid command deadline');
  const env={PATH:process.env.PATH,HOME:os.homedir(),NODE_ENV:'test',COOP_EMAIL_MOCK:'1',DATABASE_SSL:'false',
    GOOGLE_DOCS_APP_CLIENT_ID:'synthetic-docs-client',GOOGLE_DOCS_APP_CLIENT_SECRET:'synthetic-docs-secret',
    GOOGLE_DOCS_APP_STATE_SECRET:'synthetic-state-secret',
    ...(descriptor?{EH13_PUBLICATION_FIXTURE_FILE:path.join(directory,'fixture.json')}:{})};
  const log=fs.createWriteStream(path.join(directory,logName),{flags:'wx',mode:0o600});
  let nativeChild,timer,killTimer,expired=false,cancelled=false,terminationRequested=false,processError,loggingError;
  const started=process.hrtime.bigint();
  let closed=false;
  const terminate=(reason)=>{
    if(closed)return;
    // Record refusal BEFORE signaling: a SIGTERM handler may exit zero.
    if(reason==='timeout')expired=true;
    if(reason==='cancel')cancelled=true;
    terminationRequested=true;
    nativeChild?.kill('SIGTERM');
    killTimer ??= setTimeout(()=>nativeChild?.kill('SIGKILL'),killGraceMs);
  };
  const onAbort=()=>terminate('cancel');
  log.on('error',error=>{loggingError=error;terminate('logging-error');});
  try {
    await new Promise((resolve,reject)=>{
      nativeChild=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
      nativeChild.once('error',error=>{processError=error;});
      nativeChild.once('close',(code,childSignal)=>{
        closed=true;
        const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
        expired ||= elapsedMs>=timeoutMs;
        cancelled ||= abortSignal.aborted;
        clearTimeout(timer);clearTimeout(killTimer);
        abortSignal.removeEventListener('abort',onAbort);
        try {fs.appendFileSync(path.join(directory,'commands.jsonl'),JSON.stringify({logName,pid:nativeChild.pid,physicalClose:true,code,childSignal,elapsedMs,expired,cancelled,terminationRequested,processError:processError?.message,loggingError:loggingError?.message})+'\n',{mode:0o600});}
        catch(error){processError ??= error;}
        code===0&&!childSignal&&!expired&&!cancelled&&!terminationRequested&&!processError&&!loggingError
          ?resolve():reject(new Error(`Required publication test process failed (${expired?'timeout':cancelled?'cancelled':processError?.message??loggingError?.message??code??childSignal})`));
      });
      nativeChild.stdout.pipe(log,{end:false});nativeChild.stderr.pipe(log,{end:false});
      try {fs.appendFileSync(path.join(directory,'processes.jsonl'),JSON.stringify({pid:nativeChild.pid,parentPid:process.pid,args,logName,startedAt:Date.now()})+'\n',{mode:0o600});}
      catch(error){processError=error;terminate('artifact-error');}
      timer=setTimeout(()=>terminate('timeout'),timeoutMs);
      abortSignal.addEventListener('abort',onAbort,{once:true});
      if(abortSignal.aborted)onAbort();
    });
  } finally {
    clearTimeout(timer);clearTimeout(killTimer);abortSignal.removeEventListener('abort',onAbort);
    await new Promise((resolve,reject)=>{if(log.destroyed){loggingError?reject(loggingError):resolve();return;}log.end(error=>error?reject(error):resolve());});
  }
}

async function main() {
  rejectPublicationTargetOverrides();

  if(!process.versions.node.startsWith('22.') || Number(process.versions.node.split('.')[1])<23 ||
      (Number(process.versions.node.split('.')[1])===23 && Number(process.versions.node.split('.')[2])<3))throw new Error('Use supported Node22.23.3 or later Node22');
  runDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'coop-eh13-publication-'));fs.chmodSync(runDirectory,0o700);
  console.log('Publication artifacts: '+runDirectory);
  const endpoint=JSON.parse((await exec('docker',['context','inspect','--format','{{json .Endpoints.docker}}'],{timeout:5000})).stdout);
  if(!/^unix:\/\/\//.test(endpoint.Host) || !endpoint.Host.endsWith('.sock') || endpoint.SkipTLSVerify)throw new Error('Local Docker Unix socket required');
  const image=JSON.parse((await exec('docker',['image','inspect',PUBLICATION_IMAGE_REF],{timeout:5000})).stdout)[0];
  if(!PUBLICATION_IMAGE_IDS.includes(image?.Id) || image.Os!=='linux' || image.Architecture!=='amd64' || !image.RepoDigests?.includes(PUBLICATION_IMAGE_REF) ||
      !image.Config.Env.includes('PG_MAJOR=16') || !image.Config.Env.includes('PG_VERSION=16.15-1.pgdg12+2'))throw new Error('Required cached immutable Linux/amd64 PG16.15 image is unavailable');
  fs.writeFileSync(path.join(runDirectory,'image.json'),JSON.stringify({id:image.Id,digests:image.RepoDigests,os:image.Os,architecture:image.Architecture,created:image.Created},null,2),{mode:0o600});
  await command(['scripts/publication-test-fixture.test.mjs'],'target-controls.log');
  await command(['scripts/run-publication-regression.test.mjs'],'command-controls.log');
  stopped();createdAfter=Date.now();
  const id=(await exec('docker',['run','--pull=never','--platform','linux/amd64','-d','--name',name,'--label','coop.enterprise.disposable='+PUBLICATION_LABEL,'--label','coop.enterprise.run='+runId,
    ...(activeSuite === 'publication' ? [] : ['--label','coop.enterprise.suite='+activeSuite]),
    '--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw','--env','POSTGRES_DB=eh02_disposable','--env','POSTGRES_USER=eh02','--env','POSTGRES_PASSWORD=eh02-disposable-only',PUBLICATION_IMAGE_REF],{timeout:10000})).stdout.trim();
  const actual=inspectLocalPublicationContainer(id);
  ownedIdentity={runId,name,id,createdAfter,...(activeSuite === 'publication' ? {} : {suite: activeSuite})};
  validatePublicationCleanupContainer(actual,ownedIdentity,activeSuite);
  descriptor={...ownedIdentity,port:actual.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort};
  validatePublicationContainer(actual,descriptor,activeSuite);
  fs.writeFileSync(path.join(runDirectory,'fixture.json'),JSON.stringify(descriptor),{mode:0o600});
  fs.writeFileSync(path.join(runDirectory,'docker-identity.json'),JSON.stringify({id:actual.Id,name:actual.Name,image:actual.Image,labels:actual.Config.Labels,created:actual.Created,ports:actual.NetworkSettings.Ports,bindings:actual.HostConfig.PortBindings,tmpfs:actual.HostConfig.Tmpfs,mounts:actual.Mounts},null,2),{mode:0o600});
  console.log('New owned publication fixture admitted: '+id+' port '+descriptor.port);
  for(let attempt=0;attempt<60;attempt++){
    stopped();try{await exec('docker',['exec',id,'pg_isready','-h','127.0.0.1','-p','5432','-U','eh02','-d','eh02_disposable'],{timeout:2000});break;}catch{if(attempt===59)throw new Error('Owned PostgreSQL startup failed');await new Promise(resolve=>setTimeout(resolve,100));}
  }
  // The image's initialization server is socket-only. Admit the exact owned
  // descriptor, then require SQL through the published test-client connection.
  await command(['--input-type=module','--eval',
    `import pg from 'pg'; import {publicationDatabaseFromEnvironment} from './scripts/publication-test-fixture.mjs';
     const url=publicationDatabaseFromEnvironment(process.env,${JSON.stringify(activeSuite)});
     for(let attempt=0;attempt<60;attempt++){
       const client=new pg.Client({connectionString:url,ssl:false,connectionTimeoutMillis:1000,query_timeout:1000});
       try {await client.connect(); await client.query('SELECT 1'); console.log('Owned PostgreSQL host SQL ready'); break;}
       catch(error){if(attempt===59)throw error; await new Promise(resolve=>setTimeout(resolve,100));}
       finally {await client.end().catch(()=>{});}
     }`], 'tcp-readiness.log', {timeoutMs: 30000});
  if (activeSuite !== 'publication') {
    const spec = databaseSuite(activeSuite);
    if (spec.tls) await prepareOwnedTlsFixture();
    for (const [index,args] of (spec.preparation ?? []).entries()) await command(args, `suite-preparation-${index}.log`);
    if (spec.setup) await command(['--input-type=module','--eval',
      `import {publicationDatabaseFromEnvironment} from './scripts/publication-test-fixture.mjs'; import {runMigrations} from './scripts/run-migrations.mjs'; await runMigrations({databaseUrl:publicationDatabaseFromEnvironment(process.env,${JSON.stringify(activeSuite)}),migrationsDir:'migrations',log:()=>{}});`], 'setup.log');
    // Exact worker artifact is part of the build lane, not a mock worker.
    for (const [index,args] of spec.commands.entries()) await command(args, `suite-${index}.log`, {timeoutMs: 180000});
    result={suite:activeSuite,commands:spec.commands.length,node:process.version,fixture:descriptor};
    return;
  }
  await command(['--input-type=module','--eval',"import {build} from 'esbuild'; await build({entryPoints:['src/server/integrationApi.publication.fixture.ts'],bundle:true,platform:'node',format:'cjs',sourcemap:true,external:['@sentry/node','node-cron'],outfile:'dist/tests/publication-main.cjs'});"],'fixture-build.log');
  const prefix=['--require','./scripts/vscode-test-stub.cjs','--import','./node_modules/tsx/dist/loader.mjs'];
  await command([...prefix,'src/server/integrationApi.publication.integration.test.ts'],'main-publication.log');
  // The catalog separately requires the three additional race checks on a fresh
  // publication-extra fixture; a passing main suite cannot hide their failure.
  result={mainGroups:36,additionalGroups:'REQUIRED_SEPARATE_PUBLICATION_EXTRA_LANE',externalCalls:0,enterpriseCIQualification:'OPEN',node:process.version,fixture:descriptor};
}

// Test-only certificates stay in our private fixture directory. No host mounts,
// production credentials, global trust changes or externally selected targets.
async function prepareOwnedTlsFixture() {
  validatePublicationContainer(inspectLocalPublicationContainer(ownedIdentity.id),descriptor,'tls');
  const directory=path.join(runDirectory,'tls'); fs.mkdirSync(directory,{mode:0o700});
  const file=name=>path.join(directory,name);
  const openssl=async args=>{stopped();await exec('openssl',args,{timeout:15000});};
  await openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',file('ca.key'),'-out',file('ca.crt'),'-subj','/CN=Coop disposable test CA','-days','2']);
  await openssl(['req','-newkey','rsa:2048','-nodes','-keyout',file('server.key'),'-out',file('server.csr'),'-subj','/CN=localhost']);
  for (const [name,dns] of [['server','localhost'],['wrong','wrong.example']]) {
    fs.writeFileSync(file(name+'.ext'),`subjectAltName=DNS:${dns}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`,{mode:0o600});
    await openssl(['x509','-req','-in',file('server.csr'),'-CA',file('ca.crt'),'-CAkey',file('ca.key'),'-CAcreateserial','-out',file(name+'.crt'),'-days','2','-sha256','-extfile',file(name+'.ext')]);
  }
  for(const name of fs.readdirSync(directory))fs.chmodSync(file(name),0o600);
  for(const name of ['server.crt','server.key'])await exec('docker',['cp',file(name),ownedIdentity.id+':/tmp/coop-owned-tls-'+name],{timeout:10000});
  await exec('docker',['exec','--user','root',ownedIdentity.id,'chown','postgres:postgres','/tmp/coop-owned-tls-server.crt','/tmp/coop-owned-tls-server.key'],{timeout:5000});
  await exec('docker',['exec','--user','root',ownedIdentity.id,'chmod','600','/tmp/coop-owned-tls-server.crt','/tmp/coop-owned-tls-server.key'],{timeout:5000});
  await command(['--input-type=module','--eval',
    "import pg from 'pg'; import {publicationDatabaseFromEnvironment} from './scripts/publication-test-fixture.mjs'; const client=new pg.Client({connectionString:publicationDatabaseFromEnvironment(process.env,'tls'),ssl:false}); try {await client.connect(); await client.query(\"ALTER SYSTEM SET ssl = 'on'\"); await client.query(\"ALTER SYSTEM SET ssl_cert_file = '/tmp/coop-owned-tls-server.crt'\"); await client.query(\"ALTER SYSTEM SET ssl_key_file = '/tmp/coop-owned-tls-server.key'\"); await client.query('SELECT pg_reload_conf()');} finally {await client.end();}"], 'tls-configuration.log',{timeoutMs:30000});
}

export async function runOwnedDatabaseSuite(suite) {
  if (suite !== 'publication') databaseSuite(suite);
  if (runDirectory) throw new Error('Database runner instances are single-use');
  activeSuite = suite;
try {await main();}
catch(error){console.error(error.message);process.exitCode=signal==='SIGINT'?130:signal==='SIGTERM'?143:1;}
finally {
  // Never adopt another service. Resolve an uncertain create outcome only by our
  // fresh random name/run label; full actual identity still must match before rm.
  if(runDirectory && createdAfter){
    try{
      const actual=inspectLocalPublicationContainer(ownedIdentity?.id ?? name);
      const owned=ownedIdentity ?? {runId,name,id:actual.Id,createdAfter,...(activeSuite === 'publication' ? {} : {suite:activeSuite})};
      // Cleanup has no DB authority; stopped services retain immutable ownership.
      validatePublicationCleanupContainer(actual,owned,activeSuite);
      try {
        const databaseLogs=await exec('docker',['logs',owned.id],{timeout:5000});
        fs.writeFileSync(path.join(runDirectory,'postgres.log'),databaseLogs.stdout+databaseLogs.stderr,{mode:0o600});
      } catch(error) {console.error('Database diagnostics unavailable: '+error.message);process.exitCode ||= 1;}
      // Diagnostic failure cannot prevent removal of our verified fixture.
      const removed=(await exec('docker',['rm','-f',owned.id],{timeout:10000})).stdout.trim();
      if(removed!==owned.id || (await exec('docker',['ps','-a','--filter','id='+owned.id,'--format','{{.ID}}'],{timeout:5000})).stdout.trim())throw new Error('Owned fixture removal was not confirmed');
      fs.writeFileSync(path.join(runDirectory,'cleanup.json'),JSON.stringify({verifiedId:owned.id,name,removed:true,matchingContainersRemaining:0,otherFixturesUntouched:true},null,2),{mode:0o600});
    }catch(error){console.error('Owned fixture cleanup requires inspection: '+error.message);process.exitCode ||= 1;}
  }
}
if(runDirectory)fs.writeFileSync(path.join(runDirectory,'result.json'),JSON.stringify({status:process.exitCode || signal ? (signal?'CANCELLED':'FAILED'):(activeSuite === 'publication' ? 'SCOPED_ACTUAL_MAIN_PG_PASS' : 'SCOPED_REQUIRED_DATABASE_PASS'),exitCode:process.exitCode ?? 0,...result,ownedFixtureRemoved:fs.existsSync(path.join(runDirectory,'cleanup.json'))},null,2),{mode:0o600});

}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==2)throw new Error('Publication runner accepts no target or command arguments');
  await runOwnedDatabaseSuite('publication');
}

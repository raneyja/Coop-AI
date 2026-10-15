const assert = require('node:assert/strict');
assert.equal(process.argv.length, 2, 'Owned controls accept no external target or CLI arguments');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const util = require('node:util');
const {setTimeout: delay} = require('node:timers/promises');

// The owner still requests its production bound. Only this owned native-child
// fixture lowers that option, so a real SIGTERM/close can be exercised quickly.
const nativeExecFile = cp.execFile;
const nativePromise = nativeExecFile[util.promisify.custom];
let boundedTimeout = false;
let traceProbe = false;
const receipts = [];
const instrumented = (...args) => nativeExecFile(...args);
instrumented[util.promisify.custom] = (file, args, options) => {
  assert.equal(options.cwd, options.env.HOME);
  if (args[0] === 'clone') assert.equal(options.timeout, 600000);
  else assert.equal(options.timeout, 10000);
  const actualArgs = traceProbe && args[0] === 'clone' ? args.map((arg,index) => index===3 ? 'https://127.0.0.1:1/synthetic-only.git' : arg) : args;
  const command = nativePromise(file, actualArgs, {...options, ...(boundedTimeout && args[0] === 'clone' ? {timeout: 500} : {})});
  command.child.once('close', (code, signal) => receipts.push({clone: args[0] === 'clone', killed: command.child.killed, code, signal}));
  return command;
};
cp.execFile = instrumented;
const {cloneRepository, resolveCloneLocalPath, removeRepositoryClone} = require('./gitCloneService');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-clone-owned-controls-'));
const source = path.join(root, 'source');
const workRoot = path.join(root, 'clones');
const ambient = path.join(root, 'ambient');
fs.mkdirSync(source); fs.mkdirSync(ambient);
const clean = {PATH: '/usr/bin:/bin', HOME: ambient, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'};
const git = args => cp.execFileSync('/usr/bin/git', args, {env: clean, stdio: 'pipe'});
git(['init', source]); git(['-C', source, 'config', 'user.name', 'Synthetic']); git(['-C', source, 'config', 'user.email', 'fixture@invalid']);
fs.writeFileSync(path.join(source, 'index.ts'), 'export const synthetic=true;\n');
// A checked-out home is no longer empty. Later local lookups must still ignore it.
fs.writeFileSync(path.join(source, '.gitconfig'), '[http]\n followRedirects = true\n extraHeader = Authorization: SYNTHETIC_OTHER_ACTOR\n');
fs.writeFileSync(path.join(source, '.netrc'), 'machine github.com login synthetic password synthetic\n');
git(['-C', source, 'add', '.']); git(['-C', source, 'commit', '-m', 'Owned synthetic source']);
const token = 'SYNTHETIC_ONLY@:/?+%', saved = {...process.env};
const target = {repoId: 'github:synthetic/fixture', owner: 'synthetic', repo: 'fixture', provider: 'github', orgId: 'synthetic-org', jobId: 'synthetic-job-attempt'};
const reset = extra => {for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, clean, extra);};
const results = [];
let activeControl = 'fixture setup';
const control = async (name, action) => {activeControl = name; await action(); results.push({name, pass: true}); activeControl = 'none';};
let invocation = 0;
const wrapper = (mode, provider = 'github') => {
  const dir = path.join(root, 'bin-' + (++invocation)); fs.mkdirSync(dir);
  const log = path.join(dir, 'child');
  // All private fixture paths/modes are embedded in this owned executable.
  // It records the actual owner-emitted environment BEFORE injecting file-only
  // transport/rewrite into the real Git subprocess. No inherited config needed.
  const fixture = {mode, log, source, token, provider};
  fs.writeFileSync(path.join(dir, 'git'), '#!' + process.execPath + '\nconst fixture=' + JSON.stringify(fixture) + ';\n' + String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const args=process.argv.slice(2),clone=args[0]==='clone',dest=clone?args.at(-1):args[1];
const label=clone?'clone':args.includes('--abbrev-ref')?'branch':'head';
const log=fixture.log+'.'+label;
process.stdout.on('error',()=>{});
const host=fixture.provider==='github'?'github.com':fixture.provider==='gitlab'?'gitlab.com':'bitbucket.org';
const remote='https://'+host+'/synthetic/fixture.git';
const matched=key=>{const r=cp.spawnSync('/usr/bin/git',['config','--get-urlmatch',key,remote],{env:process.env,encoding:'utf8'});return {status:r.status,value:(r.stdout||'').trim()};};
const fill=cp.spawnSync('/usr/bin/git',['credential','fill'],{env:process.env,input:'protocol=https\nhost='+host+'\npath=synthetic/fixture.git\n\n',encoding:'utf8'});
fs.writeFileSync(log,JSON.stringify({args,env:process.env,cwdMatchesOwnedHome:process.cwd()===fs.realpathSync(process.env.HOME),homeEmptyAtCloneSpawn:clone&&fs.readdirSync(dest).length===0,policy:{header:matched('http.extraHeader'),redirect:matched('http.followRedirects'),helper:matched('credential.helper'),credentialFillStatus:fill.status}}),{mode:0o600});
const env={...process.env};
if(!clone){
 if(fixture.mode==='head-hold'){
  process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(path.join(dest,label+'.ts'),'Synthetic last head write');fs.writeFileSync(log+'.closed','closed');process.exit(0)},label==='branch'?250:100));
  fs.writeFileSync(log+'.entered','entered');setInterval(()=>{},1000);
 }else{const r=cp.spawnSync('/usr/bin/git',args,{env,encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1);}
}else{
 const remote=args[3];
 if(fixture.mode==='fail'){
  fs.writeFileSync(path.join(dest,'partial.ts'),'Synthetic partial source');
  const username=remote.includes('gitlab.com')?'oauth2':remote.includes('bitbucket.org')?'x-token-auth':'x-access-token';
  process.stderr.write(fixture.token+' '+encodeURIComponent(fixture.token)+' '+Buffer.from(username+':'+fixture.token).toString('base64'));process.exit(1);
 }
 const n=Number(env.GIT_CONFIG_COUNT);
 env['GIT_CONFIG_KEY_'+n]='url.file://'+fixture.source+'/.insteadOf';env['GIT_CONFIG_VALUE_'+n]=remote;env.GIT_CONFIG_COUNT=String(n+1);env.GIT_ALLOW_PROTOCOL='file';
 if(fixture.mode==='config-fail')env.GIT_CONFIG_COUNT='-1';
 const r=cp.spawnSync('/usr/bin/git',args,{env,encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
 if(r.status!==0)process.exit(r.status??1);
 if(['hold','timeout','max-buffer'].includes(fixture.mode)){
  process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(path.join(dest,'late.ts'),'Synthetic last physical write');fs.writeFileSync(log+'.closed','closed');process.exit(0)},150));
  fs.writeFileSync(log+'.entered','entered');
  if(fixture.mode==='max-buffer')process.stdout.write('x'.repeat(5*1024*1024));
  setInterval(()=>{},1000);
 }else process.exit(0);
}
`, {mode: 0o700});
  return {dir, log};
};
const record = (w, kind = 'clone') => JSON.parse(fs.readFileSync(w.log + '.' + kind, 'utf8'));
const waiting = async file => {for (let i=0; !fs.existsSync(file) && i<400; i++) await delay(10); assert(fs.existsSync(file));};
const forbidden = ['GIT_CONFIG_PARAMETERS','GIT_TEMPLATE_DIR','GIT_SSL_NO_VERIFY','COOP_PROVIDER_KEY','AWS_SECRET_ACCESS_KEY','NODE_OPTIONS','SSH_AUTH_SOCK'];
const effective = (env, key, remote) => {
  const r=cp.spawnSync('/usr/bin/git',['config','--get-urlmatch',key,remote],{env,encoding:'utf8'});
  assert([0,1].includes(r.status)); return r.stdout.trim();
};
const assertSealed = (r, provider, credentialed) => {
  const host=provider==='github'?'github.com':provider==='gitlab'?'gitlab.com':'bitbucket.org';
  const remote='https://'+host+'/synthetic/fixture.git';
  assert.equal(r.env.HOME,r.args[0]==='clone'?r.args.at(-1):r.args[1]);
  assert(r.cwdMatchesOwnedHome);assert.equal(r.env.USERPROFILE,r.env.HOME);assert.equal(r.env.XDG_CONFIG_HOME,r.env.HOME);
  assert.equal(r.env.GIT_CONFIG_GLOBAL,os.devNull);assert.equal(r.env.GIT_CONFIG_SYSTEM,os.devNull);assert.equal(r.env.GIT_CONFIG_NOSYSTEM,'1');
  for(const key of forbidden)assert.equal(r.env[key],undefined);
  assert.equal(r.env.GIT_CURL_VERBOSE,undefined);
  assert.equal(r.env.GIT_CONFIG_KEY_63,undefined);assert.equal(r.env.GIT_CONFIG_VALUE_63,undefined);
  for(const key of ['GIT_TRACE','GIT_TRACE_CURL','GIT_TRACE2','GIT_TRACE2_EVENT','GIT_TRACE2_PERF','GIT_TRACE_PACKET'])assert.equal(r.env[key],'0');
  assert.equal(effective(r.env,'http.followRedirects',remote),'false');
  assert.equal(effective(r.env,'credential.helper',remote),'');
  assert.equal(effective(r.env,'core.askPass',remote),'');
  assert.equal(effective(r.env,'init.templateDir',remote),'');
  const username=provider==='github'?'x-access-token':provider==='gitlab'?'oauth2':'x-token-auth';
  const expected=credentialed?'Authorization: Basic '+Buffer.from(username+':'+token).toString('base64'):'';
  assert.equal(effective(r.env,'http.extraHeader',remote),expected);
  assert.equal(r.policy.header.value,expected);assert.equal(r.policy.redirect.value,'false');assert.equal(r.policy.helper.value,'');assert.notEqual(r.policy.credentialFillStatus,0);
  if(credentialed){
   assert(r.homeEmptyAtCloneSpawn);assert(!r.args.join(' ').includes(token));assert(!r.args[3].includes('@'));
   assert.equal(effective(r.env,'http.extraHeader','https://'+host+'/synthetic/other.git'),'');
  }else assert(!JSON.stringify(r.env).includes(token) && !JSON.stringify(r.env).includes(Buffer.from(username+':'+token).toString('base64')));
  const filled=cp.spawnSync('/usr/bin/git',['credential','fill'],{env:r.env,input:'protocol=https\nhost='+host+'\npath=synthetic/fixture.git\n\n',encoding:'utf8'});
  assert.notEqual(filled.status,0);
};
let prior;
const noOwnedDirectories = () => assert.deepEqual(fs.readdirSync(workRoot).sort(),[path.basename(prior),'neighbor'].sort());
(async()=>{try{
  prior=resolveCloneLocalPath(target,workRoot);fs.mkdirSync(prior,{recursive:true});fs.writeFileSync(path.join(prior,'retained.txt'),'Synthetic predecessor');
  fs.mkdirSync(path.join(workRoot,'neighbor'));fs.writeFileSync(path.join(workRoot,'neighbor','retained.txt'),'Synthetic neighbor');
  await control('actual Git positive/repeat preserves predecessor; head children sealed without credential',async()=>{
   const w=wrapper('normal');reset({PATH:w.dir});const a=await cloneRepository(target,token,workRoot),b=await cloneRepository(target,token,workRoot);
   assert.notEqual(a.localPath,b.localPath);assert.notEqual(a.localPath,prior);
   for(const c of [a,b]){assert(c.files.some(f=>f.path==='index.ts'));assert.match(c.headCommit,/^[a-f0-9]{40}$/);assert(!fs.readFileSync(path.join(c.localPath,'.git/config'),'utf8').includes(token));assert.equal(fs.statSync(c.localPath).mode&0o777,0o700);removeRepositoryClone(c.localPath);}
   assertSealed(record(w),'github',true);assertSealed(record(w,'head'),'github',false);assertSealed(record(w,'branch'),'github',false);noOwnedDirectories();
  });
  await control('pre-aborted signal preserves original reason and never spawns/creates directory',async()=>{
   const w=wrapper('normal'),c=new AbortController(),reason=new Error('Synthetic stopped');reset({PATH:w.dir});c.abort(reason);
   const before=fs.readdirSync(workRoot);await assert.rejects(cloneRepository(target,token,workRoot,c.signal),e=>e===reason);assert.deepEqual(fs.readdirSync(workRoot),before);assert(!fs.existsSync(w.log+'.clone'));
  });
  for(const provider of ['github','gitlab','bitbucket'])await control(provider+': partial child failure redacts all supplied credential forms',async()=>{
   const w=wrapper('fail',provider);reset({PATH:w.dir});let error;try{await cloneRepository({...target,provider},token,workRoot);}catch(e){error=e;}
   assert(error);const username=provider==='github'?'x-access-token':provider==='gitlab'?'oauth2':'x-token-auth';
   for(const secret of [token,encodeURIComponent(token),Buffer.from(username+':'+token).toString('base64')])assert(!error.message.includes(secret));
   for(const key of ['stdout','stderr','cmd'])assert.equal(error[key],undefined);const r=record(w);assertSealed(r,provider,true);assert(!fs.existsSync(r.args.at(-1)));noOwnedDirectories();
  });
  await control('cancel waits for physical delayed close then removes its directory and preserves reason',async()=>{
   const w=wrapper('hold'),c=new AbortController();reset({PATH:w.dir});const pending=cloneRepository(target,token,workRoot,c.signal).then(value=>({value}),error=>({error}));
   await waiting(w.log+'.clone.entered');const reason=new Error('Synthetic cancelled');c.abort(reason);const outcome=await pending;assert.equal(outcome.error,reason);assert(fs.existsSync(w.log+'.clone.closed'));assert(!fs.existsSync(record(w).args.at(-1)));noOwnedDirectories();
  });
  await control('spawn failure settles and removes only its fresh directory',async()=>{reset({PATH:path.join(root,'missing-bin')});await assert.rejects(cloneRepository(target,token,workRoot),/ENOENT/);noOwnedDirectories();});
  await control('actual Git config failure after captured sealed environment cleans owned directory',async()=>{const w=wrapper('config-fail');reset({PATH:w.dir});await assert.rejects(cloneRepository(target,token,workRoot));assertSealed(record(w),'github',true);noOwnedDirectories();});

  const helperMarker=path.join(root,'helper-invoked'),trace=path.join(root,'ambient-trace'),template=path.join(root,'templates');fs.mkdirSync(template);fs.mkdirSync(path.join(template,'hooks'));
  const helper=path.join(root,'helper');fs.writeFileSync(helper,'#!/bin/sh\nprintf invoked > '+helperMarker+'\n',{mode:0o700});
  fs.writeFileSync(path.join(template,'hooks','post-checkout'),'#!/bin/sh\nprintf invoked > '+helperMarker+'\n',{mode:0o700});
  const include=path.join(ambient,'included');fs.writeFileSync(include,'[http]\n followRedirects = true\n extraHeader = Authorization: SYNTHETIC_OTHER_ACTOR\n[credential]\n helper = !'+helper+'\n[init]\n templateDir = '+template+'\n');
  fs.writeFileSync(path.join(ambient,'.gitconfig'),'[include]\n path = '+include+'\n');fs.writeFileSync(path.join(ambient,'.netrc'),'machine github.com login other password synthetic\n');
  fs.mkdirSync(path.join(ambient,'git'));fs.writeFileSync(path.join(ambient,'git','config'),fs.readFileSync(include));
  for(const provider of ['github','gitlab','bitbucket'])await control(provider+': poisoned ambient/legacy/path/header/helper/include/template/trace/key inputs excluded',async()=>{
   const w=wrapper('normal',provider),host=provider==='github'?'github.com':provider==='gitlab'?'gitlab.com':'bitbucket.org';
   reset({PATH:w.dir,USERPROFILE:ambient,XDG_CONFIG_HOME:ambient,GIT_CONFIG_SYSTEM:include,GIT_CONFIG_GLOBAL:include,GIT_CONFIG_NOSYSTEM:'0',
    GIT_CONFIG_PARAMETERS:"'http.followRedirects'='true' 'credential.helper'='!"+helper+"'",GIT_CONFIG_COUNT:'3',GIT_CONFIG_KEY_0:'http.https://'+host+'/synthetic/.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: SYNTHETIC_OTHER_ACTOR',GIT_CONFIG_KEY_1:'http.https://'+host+'/synthetic/.followRedirects',GIT_CONFIG_VALUE_1:'true',GIT_CONFIG_KEY_2:'credential.https://'+host+'/synthetic/.helper',GIT_CONFIG_VALUE_2:'!'+helper,GIT_CONFIG_KEY_63:'credential.helper',GIT_CONFIG_VALUE_63:'!'+helper,
    GIT_TEMPLATE_DIR:template,GIT_SSL_NO_VERIFY:'true',GIT_TRACE:trace,GIT_TRACE_CURL:trace,GIT_CURL_VERBOSE:'1',GIT_TRACE2:trace,GIT_TRACE2_EVENT:trace,GIT_TRACE2_PERF:trace,GIT_TRACE_PACKET:trace,
    COOP_PROVIDER_KEY:'SYNTHETIC_SERVER_SECRET',AWS_SECRET_ACCESS_KEY:'SYNTHETIC_SERVER_SECRET',SSH_AUTH_SOCK:helper});
   const c=await cloneRepository({...target,provider},token,workRoot);assertSealed(record(w),provider,true);assertSealed(record(w,'head'),provider,false);assertSealed(record(w,'branch'),provider,false);assert(c.files.some(f=>f.path==='index.ts'));assert(!fs.existsSync(helperMarker));assert(!fs.existsSync(trace));assert(!fs.existsSync(path.join(c.localPath,'.git/hooks/post-checkout')));removeRepositoryClone(c.localPath);noOwnedDirectories();
  });
  await control('max-buffer failure waits for final physical write before cleanup',async()=>{
   const w=wrapper('max-buffer');reset({PATH:w.dir});await assert.rejects(cloneRepository(target,token,workRoot));assert(fs.existsSync(w.log+'.clone.closed'));assert(!fs.existsSync(record(w).args.at(-1)));noOwnedDirectories();
  });
  await control('native timeout killed/zero-exit rejects after actual close with existing requested bound',async()=>{
   const w=wrapper('timeout');reset({PATH:w.dir});boundedTimeout=true;const before=receipts.length;let error;
   try{await cloneRepository(target,token,workRoot);}catch(e){error=e;}finally{boundedTimeout=false;}
   assert(error);assert.match(error.message,/timed out or was terminated/);assert(fs.existsSync(w.log+'.clone.closed'));
   assert.deepEqual(receipts.slice(before),[{clone:true,killed:true,code:0,signal:null}]);assert(!fs.existsSync(record(w).args.at(-1)));noOwnedDirectories();
  });
  await control('local head abort waits for both physical children before cleanup',async()=>{
   const w=wrapper('head-hold'),c=new AbortController();reset({PATH:w.dir});const pending=cloneRepository(target,token,workRoot,c.signal).then(value=>({value}),error=>({error}));
   await Promise.all([waiting(w.log+'.head.entered'),waiting(w.log+'.branch.entered')]);const reason=new Error('Synthetic head stop');c.abort(reason);const outcome=await pending;assert.equal(outcome.error,reason);
   assert(fs.existsSync(w.log+'.head.closed'));assert(fs.existsSync(w.log+'.branch.closed'));assertSealed(record(w,'head'),'github',false);assertSealed(record(w,'branch'),'github',false);noOwnedDirectories();
  });
  await control('only declared operator CA/proxy/platform inputs survive; TLS disabling remains excluded',async()=>{
   const w=wrapper('normal'),ca=path.join(root,'synthetic-ca');fs.writeFileSync(ca,'Synthetic policy fixture, no TLS qualification');
   const trusted={LANG:'C',LC_ALL:'C',TZ:'UTC',TMPDIR:root,GIT_SSL_CAINFO:ca,GIT_SSL_CAPATH:root,SSL_CERT_FILE:ca,SSL_CERT_DIR:root,CURL_CA_BUNDLE:ca,HTTPS_PROXY:'http://synthetic.invalid:1',NO_PROXY:'localhost'};
   reset({PATH:w.dir,...trusted,GIT_SSL_NO_VERIFY:'true',NODE_OPTIONS:'--trace-warnings',OPENAI_API_KEY:'SYNTHETIC_SERVER_SECRET'});
   const c=await cloneRepository(target,token,workRoot),r=record(w);for(const [k,v] of Object.entries(trusted))assert.equal(r.env[k],v);
   assert.equal(r.env.OPENAI_API_KEY,undefined);assertSealed(r,'github',true);removeRepositoryClone(c.localPath);noOwnedDirectories();
  });
  await control('actual Git malformed-proxy failure has no curl tracing with inherited verbose enabled',async()=>{
   reset({PATH:'/usr/bin:/bin',HTTPS_PROXY:'http://127.0.0.1:not-a-port',GIT_CURL_VERBOSE:'1'});
   traceProbe=true;let error;
   try{await cloneRepository(target,token,workRoot);}catch(value){error=value;}finally{traceProbe=false;}
   assert(error);assert.match(error.message,/Unsupported proxy syntax|proxy.*syntax|Port number was not a decimal/i);
   assert(!/http\.c:\d+.*== Info:/.test(error.message));assert(!error.message.includes(token));noOwnedDirectories();
  });
  await control('public clone has no Authorization and a genuine local Git positive',async()=>{const w=wrapper('normal');reset({PATH:w.dir});const c=await cloneRepository(target,undefined,workRoot);assert.equal(effective(record(w).env,'http.extraHeader','https://github.com/synthetic/fixture.git'),'');assert.match(c.headCommit,/^[a-f0-9]{40}$/);removeRepositoryClone(c.localPath);noOwnedDirectories();});
  assert(fs.existsSync(path.join(prior,'retained.txt')));assert(fs.existsSync(path.join(workRoot,'neighbor','retained.txt')));
  console.log(JSON.stringify({passed:results.length,externalRequests:0,nativeTimeoutFixtureMs:500,productionRequestedCloneTimeoutMs:600000,actualOwnerChildrenCaptured:true}));
}finally{for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,saved);cp.execFile=nativeExecFile;fs.rmSync(root,{recursive:true,force:true});}})().catch(error=>{console.error(error.name,'Owned clone control failed; supplied credentials omitted',activeControl,error.stack?.split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,2).join('\n'));process.exitCode=1;});

import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {releaseCatalog,privatePackageSourceApproved} from './release-catalog.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--lane'||!['unit','supplemental','build','database','full','security'].includes(args[1]))throw new Error('Use --lane unit|supplemental|build|database|security|full; no arbitrary commands or targets');
if(process.versions.node!=='22.23.3')throw new Error('Release checks require pinned Node22.23.3');
if(process.platform==='win32')throw new Error('Release command process-group controls require POSIX; use Linux CI');
const root=process.cwd(),lane=args[1],catalog=releaseCatalog(root);
const directory=process.env.COOP_RELEASE_EVIDENCE_DIR?path.join(process.env.COOP_RELEASE_EVIDENCE_DIR,lane):fs.mkdtempSync(path.join(os.tmpdir(),'coop-release-'));
if(process.env.COOP_RELEASE_EVIDENCE_DIR)fs.mkdirSync(directory,{recursive:true,mode:0o700});
if(fs.readdirSync(directory).length)throw new Error('Evidence directory must be empty; stale evidence cannot qualify a lane');
fs.chmodSync(directory,0o700);
console.log('Release evidence: '+directory);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function sourceIdentity() {
 const files=[];
 function visit(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(['node_modules','dist','.next','.git'].includes(entry.name))continue;const file=path.join(folder,entry.name);if(entry.isDirectory())visit(file);else if(entry.isFile())files.push({path:path.relative(root,file),sha256:hash(file)});}}
 if(fs.existsSync(path.join(root,'fixtures')))visit(path.join(root,'fixtures'));
 for(const folder of ['src','scripts','migrations','evals/enterprise/v1'])visit(path.join(root,folder));
 for(const entry of catalog.inputs)files.push({path:entry.path,sha256:hash(path.join(root,entry.path))});
 return [...new Map(files.map(file=>[file.path,file])).values()].sort((a,b)=>a.path.localeCompare(b.path));
}
const before=sourceIdentity(),results=[];let cancelled=false,active;
const stop=()=>{cancelled=true;active?.();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
async function execute(entry,index){
 const started=performance.now(),logfile=path.join(directory,index+'.log'),log=fs.createWriteStream(logfile,{mode:0o600,flags:'wx'});
 const env={...process.env,PATH:path.join(root,'node_modules/.bin')+path.delimiter+process.env.PATH};
 delete env.NODE_ENV; // Test scripts set their own production fixtures explicitly.
 let expired=false,termination=false,loggingError;
 const child=spawn('/bin/sh',['-c',entry.command],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
 const kill=signal=>{try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
 let grace;active=()=>{termination=true;kill('SIGTERM');grace??=setTimeout(()=>kill('SIGKILL'),3000);};
 log.on('error',error=>{loggingError=error;active?.();});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 const timer=setTimeout(()=>{expired=true;active?.();},15*60*1000);
 const outcome=await new Promise(resolve=>{child.once('error',error=>resolve({error:error.message}));child.once('close',(code,signal)=>resolve({code,signal,physicalClose:true}));});
 clearTimeout(timer);clearTimeout(grace);active=undefined;
 const groupAlive=()=>{try{process.kill(-child.pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
 let lingering=groupAlive(),groupDrainMs=0;
 if(lingering&&outcome.code===0&&!outcome.signal&&!expired&&!cancelled&&!termination){
  const drainStart=performance.now();
  do{await new Promise(resolve=>setTimeout(resolve,100));lingering=groupAlive();}while(lingering&&performance.now()-drainStart<3000);
  groupDrainMs=Math.round(performance.now()-drainStart);
 }
 if(lingering)kill('SIGKILL');
 await new Promise((resolve,reject)=>log.end(error=>error?reject(error):resolve()));
 const pass=outcome.code===0&&!outcome.signal&&!outcome.error&&!expired&&!cancelled&&!termination&&!loggingError&&!lingering;
 return {...entry,...outcome,status:pass?'AUTOMATED_PASS':'FAIL',expired,cancelled,termination,lingering,groupDrainMs,seconds:(performance.now()-started)/1000,log:path.basename(logfile),logSha256:hash(logfile)};
}
try {
 const lanes=lane==='full'?['unitPreparation','unit','supplemental','build','database','security','publication','tls','auth']:lane==='unit'?['unitPreparation','unit']:lane==='database'?['unitPreparation','database','publication','tls','auth']:[lane];
 for(const selected of lanes)for(const entry of catalog.lanes[selected]){
  if(cancelled)break;
  // An unfinished adapter stays a required failure, never an execution alias.
  if(entry.currentStatus?.startsWith('BLOCKED')){results.push({...entry,status:entry.currentStatus});continue;}
  if(entry.groups?.includes('package')){
   const git=(...arguments_)=>spawnSync('git',arguments_,{cwd:root,encoding:'utf8'});
   const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}'),lineage=git('rev-list','--parents','-n','1','HEAD'),dirty=git('status','--porcelain','--untracked-files=no'),approvedSha=process.env.COOP_RELEASE_PRIVATE_PACKAGE_SOURCE_SHA;
   const approvedTree=/^[a-f0-9]{40}$/.test(approvedSha??'')?git('rev-parse',`${approvedSha}^{tree}`):null;
   const identity={approvedSha,checkoutSha:head.stdout.trim(),checkoutTree:tree.stdout.trim(),parents:lineage.stdout.trim().split(' ').slice(1),approvedTree:approvedTree?.stdout.trim()};
   if([head,tree,lineage,dirty].some(result=>result.status!==0)||approvedTree?.status!==0||dirty.stdout.trim()||!privatePackageSourceApproved(identity)){results.push({...entry,lane:selected,status:'BLOCKED_PACKAGING_HOLD'});throw new Error('Private packaging requires separate approval for this exact clean source commit or identical-tree PR merge');}
  }
  const result=await execute(entry,results.length);results.push({...result,lane:selected});
  fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2),{mode:0o600});
  if(result.status!=='AUTOMATED_PASS')throw new Error('Required release check failed; remaining checks were not launched');
 }
}finally {
 process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
 const after=sourceIdentity(),unchanged=JSON.stringify(before)===JSON.stringify(after);
 fs.writeFileSync(path.join(directory,'source-before.json'),JSON.stringify(before,null,2),{mode:0o600});
 fs.writeFileSync(path.join(directory,'source-after.json'),JSON.stringify(after,null,2),{mode:0o600});
 fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify(catalog,null,2),{mode:0o600});
 const pass=unchanged&&!cancelled&&results.length>0&&results.every(result=>result.status==='AUTOMATED_PASS');
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({schema:'coop-release-result-v1',lane,node:process.version,commit:process.env.GITHUB_SHA??null,sourceSnapshotSha256:createHash('sha256').update(JSON.stringify(before)).digest('hex'),sourceUnchanged:unchanged,cancelled,pass,results},null,2),{mode:0o600});
 process.exitCode=pass?0:1;
 console.log(pass?'Selected automated lane passed; full qualification remains separate.':'Required release check failed or is blocked; inspect result.json.');
}

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyPrivatePackage} from './release-catalog.mjs';
const javaPins=JSON.parse(fs.readFileSync(new URL('./indexer-tools/scip-java.json',import.meta.url),'utf8'));

function hashFile(file) {
 const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(file,'r');
 try {let read;while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,read));}
 finally {fs.closeSync(fd);}
 return hash.digest('hex');
}

export function validateJavaArchiveReport(report,inventory) {
 const issues=[],components=inventory?.components,results=report?.Results;
 if(!Array.isArray(components)||components.length===0)return {pass:false,issues:['Missing declared Java resources']};
 const resources=components.map(item=>item?.resource);
 if(resources.some(name=>typeof name!=='string'||path.basename(name)!==name||!name.endsWith('.jar'))||new Set(resources).size!==resources.length)return {pass:false,issues:['Invalid or duplicate declared Java resources']};
 if(!Array.isArray(results))return {pass:false,issues:['Missing Java scanner results']};
 const packages=[],findings=[];
 for(const result of results){
  if(result?.Type!=='jar')continue;
  if(!Array.isArray(result.Packages))issues.push('Missing Java package inventory');
  else packages.push(...result.Packages);
  if(result.Vulnerabilities!==undefined&&!Array.isArray(result.Vulnerabilities))issues.push('Invalid Java findings');
  else findings.push(...(result.Vulnerabilities??[]));
 }
 const covered=new Set();
 for(const pkg of packages){
  if(typeof pkg?.Name!=='string'||typeof pkg.Version!=='string'||typeof pkg.FilePath!=='string'||pkg.AnalyzedBy!=='jar'){issues.push('Malformed Java package record');continue;}
  covered.add(pkg.FilePath.split('/')[0]);
 }
 const producerCovered=new Set(),provenance=inventory.buildProvenance;
 if(provenance){
  if(provenance.schema!=='coop-scip-java-build-v1'||JSON.stringify(provenance.inputs)!==JSON.stringify(javaPins)||!Array.isArray(provenance.files)||!Array.isArray(provenance.resources)||!Array.isArray(provenance.sourceOnlyResources)||provenance.files.some(f=>typeof f?.path!=='string'||path.isAbsolute(f.path)||f.path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(f.sha256??''))||new Set(provenance.files.map(f=>f.path)).size!==provenance.files.length)return {pass:false,issues:['Invalid producer build provenance']};
  if(JSON.stringify(provenance.sourceOnlyResources)!==JSON.stringify(components.filter(c=>c.producerSource!==undefined)))issues.push('Changed producer-source classification');
 }
 if(provenance&&JSON.stringify(provenance.resources)!==JSON.stringify(components))issues.push("Incomplete or changed producer resource corpus");
 if(provenance)for(const file of provenance.files??[]){if(file.path?.startsWith("lib/")&&file.path.endsWith(".jar")&&!components.some(c=>c.origin===file.path&&c.sha256===file.sha256))issues.push("Missing or changed distribution JAR: "+file.path);}
 for(const component of components){
  if(component.producerSource===undefined)continue;
  const proof=provenance?.sourceOnlyResources?.find(row=>row.resource===component.resource);
  const project=component.producerSource?.project;
  const origin=project==='scip-gradle-plugin'?`lib/scip-java-${javaPins.releaseVersion}.jar!/gradle-plugin.jar`:`lib/${project}-${javaPins.releaseVersion}.jar`;
  if(provenance?.schema!=='coop-scip-java-build-v1'||JSON.stringify(provenance.inputs)!==JSON.stringify(javaPins)||!['scip-java','scip-shared','scip-aggregator','scip-gradle-plugin'].includes(project)||component.origin!==origin||!Number.isSafeInteger(component.producerSource.classCount)||component.producerSource.classCount<=0||!proof||JSON.stringify(proof)!==JSON.stringify(component)||!/^[a-f0-9]{64}$/.test(component.sha256??'')||!provenance.files?.some(row=>row.path===origin.split('!/')[0]&&/^[a-f0-9]{64}$/.test(row.sha256??'')))issues.push('Unverified producer-source Java resource: '+component.resource);
  else producerCovered.add(component.resource);
 }
 const missing=resources.filter(resource=>!covered.has(resource)&&!producerCovered.has(resource));
 if(missing.length)issues.push('Unrecognized Java resources: '+missing.join(', '));
 for(const resource of covered)if(!resources.includes(resource))issues.push('Undeclared Java resource: '+resource);
 if(findings.some(item=>typeof item?.Severity!=='string'||typeof item.VulnerabilityID!=='string'))issues.push('Malformed vulnerability record');
 const severe=findings.filter(item=>['HIGH','CRITICAL'].includes(item.Severity));
 if(severe.length)issues.push('Unaccepted HIGH/CRITICAL Java findings');
 return {pass:issues.length===0,issues,declaredResources:resources.length,coveredResources:new Set([...covered,...producerCovered]).size,advisoryCoveredResources:covered.size,producerSourceResources:producerCovered.size,coverageScope:"Third-party advisory matching plus explicit pinned producer-source provenance; not first-party advisory clearance",packages:packages.length,missingResources:missing,severeFindings:severe};
}

export function scanJavaArchives({directory,inventoryPath,executable,expectedExecutableSha256,cacheDirectory,evidenceDirectory}) {
 const record={pass:false,issues:[],scannerExecuted:false};
 try {
  if([directory,inventoryPath,executable,cacheDirectory,evidenceDirectory].some(value=>typeof value!=='string'||!value))throw new Error('Java archive mode requires explicit resource, inventory, pinned tool/cache and evidence paths');
  if(!/^[a-f0-9]{64}$/.test(expectedExecutableSha256??''))throw new Error('Missing approved Trivy executable SHA256');
  const inventorySha256=hashFile(inventoryPath),inventory=JSON.parse(fs.readFileSync(inventoryPath,'utf8'));
  const shape=validateJavaArchiveReport({Results:[]},inventory);
  if(!Array.isArray(inventory.components)||shape.issues.some(x=>x.startsWith('Invalid')||x.startsWith('Missing declared')))throw new Error('Invalid declared Java inventory');
  const inputs=inventory.components.map(item=>{
   if(!/^[a-f0-9]{64}$/.test(item.sha256??''))throw new Error('Missing resource SHA256');
   const file=path.join(directory,item.resource);if(hashFile(file)!==item.sha256)throw new Error('Java resource identity mismatch: '+item.resource);
   return {resource:item.resource,sha256:item.sha256};
  });
  if(hashFile(executable)!==expectedExecutableSha256)throw new Error('Trivy executable identity mismatch');
  const version=spawnSync(executable,['--version'],{encoding:'utf8',timeout:5000});
  if(version.status!==0||!/^Version: 0\.72\.0(?:\s|$)/.test(version.stdout??''))throw new Error('Trivy 0.72.0 required');
  const databases=['db/trivy.db','java-db/trivy-java.db'].map(name=>{
   const file=path.join(cacheDirectory,name),metadata=JSON.parse(fs.readFileSync(path.join(path.dirname(file),'metadata.json'),'utf8'));
   if(!Number.isFinite(Date.parse(metadata.NextUpdate))||Date.parse(metadata.NextUpdate)<=Date.now())throw new Error('Expired or unbound scanner database: '+name);
   return {file,sha256:hashFile(file),metadata};
  });
  const reportFile=path.join(evidenceDirectory,'java-report.json');
  const args=['rootfs','--scanners','vuln','--format','json','--list-all-pkgs','--offline-scan','--skip-db-update','--skip-java-db-update','--disable-telemetry','--skip-version-check','--ignorefile','/dev/null','--cache-dir',cacheDirectory,'--severity','HIGH,CRITICAL','--exit-code','1','--timeout','60s','--output',reportFile,directory];
  const scanned=spawnSync(executable,args,{encoding:'utf8',timeout:75000,cwd:evidenceDirectory,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
  record.scannerExecuted=true;record.command=[executable,...args];record.exitCode=scanned.status;
  fs.writeFileSync(path.join(evidenceDirectory,'java-scan.log'),(scanned.stdout??'')+(scanned.stderr??''),{mode:0o600});
  if(scanned.error||![0,1].includes(scanned.status)||scanned.signal)throw new Error('Java scanner did not complete');
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8')),validation=validateJavaArchiveReport(report,inventory);
  Object.assign(record,validation,{scannerVersion:'0.72.0',scannerSha256:expectedExecutableSha256,databases,inventorySha256,inputs,reportSha256:hashFile(reportFile)});
  if(scanned.status!==0&&!record.issues.length)record.issues.push('Scanner exit does not establish a clean result');
  for(const item of inputs)if(hashFile(path.join(directory,item.resource))!==item.sha256)record.issues.push('Java resource changed during scan: '+item.resource);
  for(const db of databases)if(hashFile(db.file)!==db.sha256)record.issues.push('Scanner database changed during scan');
  if(hashFile(inventoryPath)!==inventorySha256)record.issues.push('Declared Java inventory changed during scan');
  if(hashFile(executable)!==expectedExecutableSha256)record.issues.push('Scanner executable changed during scan');
  record.pass=record.issues.length===0&&scanned.status===0;
 }catch(error){record.pass=false;record.issues.push(error instanceof Error?error.message:'Java archive scan failed');}
 return record;
}

const SHA=/^[a-f0-9]{64}$/;
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const outcome=(issues,extra={})=>({pass:issues.length===0,issues,...extra});
const INPUT_BINDING_SCHEMA='coop-input-binding-v2';
export function canonicalInputBindings(files,root) {
 if(typeof root!=='string'||!root||!Array.isArray(files)||!files.length)throw new Error('Missing exact input bindings/root');
 const base=fs.realpathSync(root),logicalBase=path.resolve(root),seen=new Set(),records=[];
 for(const file of files){
  if(typeof file?.path!=='string'||!file.path||file.path.split(/[\\/]/).includes('..')||!SHA.test(file.sha256??''))throw new Error('Malformed input binding');
  const declared=path.resolve(logicalBase,file.path),real=fs.realpathSync(declared),relative=path.relative(base,real).split(path.sep).join('/');
  if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))throw new Error('Input outside declared root');
  const lexical=path.relative(logicalBase,declared);
  if(lexical==='..'||lexical.startsWith('..'+path.sep)||path.isAbsolute(lexical))throw new Error('Input outside declared root');
  let component=logicalBase;
  for(const part of lexical.split(path.sep)){component=path.join(component,part);if(fs.lstatSync(component).isSymbolicLink())throw new Error('Input symlink unsupported');}
  if(!fs.statSync(real).isFile()||seen.has(relative))throw new Error('Duplicate or non-file input binding');
  seen.add(relative);if(hashFile(real)!==file.sha256)throw new Error('Input identity mismatch: '+relative);
  records.push({path:relative,sha256:file.sha256});
 }
 return records.sort((a,b)=>a.path.localeCompare(b.path));
}
function binding(files,root) {
 return digest({schema:INPUT_BINDING_SCHEMA,files:canonicalInputBindings(files,root)});
}
function findingPath(file,target) {
 if(typeof file!=='string'||!file||file.split(/[\\/]/).includes('..'))throw new Error('Unsafe secret finding path');
 const base=path.resolve(target),relative=path.relative(base,path.resolve(base,file)).split(path.sep).join('/');
 if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))throw new Error('Secret finding outside declared root');
 return relative;
}
function pinnedTool(tool,version,args=['--version']) {
 if(!tool||!SHA.test(tool.sha256??'')||hashFile(tool.path)!==tool.sha256)throw new Error('Missing or mismatched pinned scanner');
 const probe=spawnSync(tool.path,args,{encoding:'utf8',timeout:5000});
 if(probe.status!==0||probe.error||probe.stdout.trim()!==version)throw new Error('Pinned scanner version mismatch');
}
export function validateAudit(report) {
 const counts=report?.metadata?.vulnerabilities;
 if(report?.error||report?.auditReportVersion!==2||!report.vulnerabilities||typeof report.vulnerabilities!=='object'||Array.isArray(report.vulnerabilities)||!counts)return outcome(['Incomplete npm audit report']);
 const kinds=['info','low','moderate','high','critical'];
 if(kinds.some(k=>!Number.isSafeInteger(counts[k])||counts[k]<0)||!Number.isSafeInteger(counts.total)||counts.total!==kinds.reduce((n,k)=>n+counts[k],0))return outcome(['Malformed audit counts']);
 if(counts.total!==0||Object.keys(report.vulnerabilities).length)return outcome(['Unaccepted dependency findings'],{counts});
 return outcome([],{counts});
}
export function enforceFindingPolicy(findings,exceptions=[],context={},now=Date.now()) {
 const issues=[],unaccepted=[],accepted=[];
 if(!Array.isArray(findings)||!Array.isArray(exceptions)||!SHA.test(context.scopeSha256??''))return outcome(['Missing exact finding scope']);
 const keys=new Set();
 for(const exception of exceptions){
  if(!SHA.test(exception?.findingSha256??'')||exception.scopeSha256!==context.scopeSha256||exception.approved!==true||typeof exception.owner!=='string'||!exception.owner.trim()||typeof exception.approvalReference!=='string'||!exception.approvalReference.trim()||typeof exception.reason!=='string'||!exception.reason.trim()||!Number.isFinite(Date.parse(exception.expiresAt))||Date.parse(exception.expiresAt)<=now||keys.has(exception.findingSha256))issues.push('Invalid, inactive, duplicate, mismatched or expired finding exception');
  keys.add(exception?.findingSha256);
 }
 for(const finding of findings){
  const findingSha256=digest(finding),exception=exceptions.find(e=>e.findingSha256===findingSha256);
  if(exception&&!issues.length)accepted.push({findingSha256,owner:exception.owner,expiresAt:exception.expiresAt,approvalReference:exception.approvalReference});
  else unaccepted.push({findingSha256,...finding});
 }
 if(unaccepted.length)issues.push('Unaccepted security findings');
 return outcome(issues,{unaccepted,accepted});
}
export function runAudits({root=process.cwd(),npmCli,receipts=[],evidenceDirectory,now=Date.now()}) {
 const results=[];
 for(const area of ['root','admin','ops','website'])for(const kind of ['full','production']){
  const record={area,kind,pass:false,issues:[]};results.push(record);
  try {
   const cwd=area==='root'?root:path.join(root,area),lock=path.join(cwd,'package-lock.json'),lockSha256=hashFile(lock);
   const receipt=receipts.find(r=>r.area===area&&r.kind===kind);
   if(receipts.filter(r=>r.area===area&&r.kind===kind).length>1)throw new Error('Duplicate audit receipt');
   let report;
   if(receipt){
    if(receipt.lockSha256!==lockSha256||!SHA.test(receipt.reportSha256??'')||hashFile(receipt.reportPath)!==receipt.reportSha256||receipt.node!=='22.23.3'||receipt.npm!=='10.9.9'||receipt.exitCode!==0||!Number.isFinite(Date.parse(receipt.scannedAt))||Date.parse(receipt.scannedAt)>now||now-Date.parse(receipt.scannedAt)>24*60*60*1000)throw new Error('Stale or mismatched audit receipt');
    report=readJson(receipt.reportPath);record.reused=true;record.reportSha256=receipt.reportSha256;
   }else{
    if(process.versions.node!=='22.23.3'||!SHA.test(npmCli?.sha256??'')||hashFile(npmCli.path)!==npmCli.sha256)throw new Error('Pinned Node22.23.3/npm10.9.9 required for audit');
    const version=spawnSync(process.execPath,[npmCli.path,'--version'],{encoding:'utf8',timeout:5000});if(version.status!==0||version.stdout.trim()!=='10.9.9')throw new Error('npm version mismatch');
    const args=[npmCli.path,'audit','--json','--package-lock-only','--audit-level=low',...(kind==='production'?['--omit=dev']:[])];
    const scan=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:45000,maxBuffer:20*1024*1024});
    if(scan.error||scan.signal||![0,1].includes(scan.status))throw new Error('npm audit did not complete');
    const reportPath=path.join(evidenceDirectory,`audit-${area}-${kind}.json`);fs.writeFileSync(reportPath,scan.stdout,{mode:0o600});report=JSON.parse(scan.stdout);record.reportSha256=hashFile(reportPath);record.exitCode=scan.status;
   }
   Object.assign(record,validateAudit(report),{lockSha256});if(hashFile(lock)!==lockSha256)throw new Error('Lock changed during audit');
  }catch(error){record.pass=false;record.issues.push(error.message);}
 }
 return {pass:results.length===8&&results.every(r=>r.pass),results};
}
export function scanSecrets({scope,target,tool,config,evidenceDirectory,files,exceptions=[],artifact,root=process.cwd()}) {
 const record={scope,pass:false,issues:[],scannerExecuted:false};
 try {
  if(!['candidate','history','package'].includes(scope)||typeof target!=='string'||!target)throw new Error('Missing declared secret scan scope/target');
  const inputsSha256=binding(files,target);
  const verifyCorpus=()=>{if(scope!=='history'){
   const base=fs.realpathSync(target),actual=[];
   const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('Secret corpus contains symlink');if(entry.isDirectory())walk(file);else if(entry.isFile())actual.push(fs.realpathSync(file));else throw new Error('Unsupported secret corpus entry');}};
   walk(base);
   const declared=files.map(f=>fs.realpathSync(f.path)).sort();
   if(!actual.length||JSON.stringify(actual.sort())!==JSON.stringify(declared))throw new Error('Secret corpus does not match complete declared files');
  }};
  verifyCorpus();
  if(scope==='package'){
   if(!artifact||!SHA.test(artifact.sha256??'')||hashFile(artifact.path)!==artifact.sha256)throw new Error('Exact final package artifact binding required');
   const content=verifyPrivatePackage(artifact.path,root);if(!content.pass||content.artifactSha256!==artifact.sha256)throw new Error('Final package content/source qualification failed');
   const actual=files.map(f=>({path:path.relative(target,f.path).split(path.sep).join('/'),sha256:f.sha256}));
   if(actual.length!==content.entries.length||content.entries.some(e=>!actual.some(f=>f.path===e.path&&f.sha256===e.sha256)))throw new Error('Unpacked package corpus does not match qualified archive');
  }
  if(!config||!SHA.test(config.sha256??'')||hashFile(config.path)!==config.sha256||fs.readFileSync(config.path,'utf8').trim()!=='[extend]\nuseDefault = true')throw new Error('Gitleaks default rules must be retained');
  pinnedTool(tool,'8.30.1',['version']);
  let refs;
  const gitRefs=()=>{const r=spawnSync('git',['-C',target,'show-ref','--head'],{encoding:'utf8',timeout:5000});if(r.status!==0)throw new Error('Git refs unavailable');return digest(r.stdout);};
  if(scope==='history')refs=gitRefs();
  const reportPath=path.join(evidenceDirectory,`secrets-${scope}.json`),ignore=path.join(evidenceDirectory,'empty-gitleaks-ignore');fs.writeFileSync(ignore,'',{mode:0o600});
  const args=[scope==='history'?'git':'dir','--redact=100','--no-banner','--no-color','--ignore-gitleaks-allow','--config',config.path,'--gitleaks-ignore-path',ignore,'--report-format=json','--report-path',reportPath,'--timeout=60',...(scope==='history'?['--log-opts=--all --full-history']:[]),target];
  const scan=spawnSync(tool.path,args,{encoding:'utf8',timeout:75000,maxBuffer:20*1024*1024});record.scannerExecuted=true;record.exitCode=scan.status;
  if(scan.error||scan.signal||![0,1].includes(scan.status))throw new Error('Secret scanner did not complete');
  const report=readJson(reportPath);if(!Array.isArray(report)||report.some(f=>f.Secret!=='REDACTED'||typeof f.RuleID!=='string'||typeof f.File!=='string'||!Number.isSafeInteger(f.StartLine)||!Number.isSafeInteger(f.EndLine)||typeof f.Commit!=='string'))throw new Error('Malformed or non-redacted secret report');
  const findings=report.map(f=>({rule:f.RuleID,file:findingPath(f.File,target),startLine:f.StartLine,endLine:f.EndLine,commit:f.Commit}));
  const scopeSha256=digest({bindingSchema:INPUT_BINDING_SCHEMA,scope,inputsSha256,refs,scannerSha256:tool.sha256,configSha256:config.sha256});
  Object.assign(record,enforceFindingPolicy(findings,exceptions,{scopeSha256}),{bindingSchema:INPUT_BINDING_SCHEMA,inputsSha256,scopeSha256,reportSha256:hashFile(reportPath),findings:findings.length});
  if((scan.status===0)!==(findings.length===0))throw new Error('Secret scan exit/findings mismatch');
  if(binding(files,target)!==inputsSha256||(scope==='history'&&gitRefs()!==refs)||hashFile(tool.path)!==tool.sha256||hashFile(config.path)!==config.sha256)throw new Error('Secret scan inputs changed');
  verifyCorpus();
 }catch(error){record.pass=false;record.issues.push(error.message);}
 return record;
}
export function validateImageReport(report,{artifactId,requiredTypes}) {
 if(!/^sha256:[a-f0-9]{64}$/.test(artifactId??'')||report?.ArtifactType!=='container_image'||report?.Metadata?.ImageID!==artifactId||!Array.isArray(report.Results)||!Array.isArray(requiredTypes)||!requiredTypes.length||new Set(requiredTypes).size!==requiredTypes.length)return outcome(['Unbound image report/coverage']);
 const issues=[],findings=[];
 for(const type of requiredTypes){const records=report.Results.filter(r=>r.Type===type);if(!records.length||records.some(r=>!Array.isArray(r.Packages)||!r.Packages.length||r.Packages.some(p=>typeof p.Name!=='string'||!p.Name||typeof p.Version!=='string'||!p.Version)))issues.push('Missing image package coverage: '+type);}
 for(const r of report.Results){
  if(r.Vulnerabilities!==undefined&&!Array.isArray(r.Vulnerabilities)){issues.push('Malformed image findings');continue;}
  for(const v of r.Vulnerabilities??[]){
   if(typeof v.VulnerabilityID!=='string'||typeof v.PkgName!=='string'||typeof v.InstalledVersion!=='string'||!['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL'].includes(v.Severity)){issues.push('Malformed image finding');continue;}
   if(['HIGH','CRITICAL'].includes(v.Severity))findings.push({id:v.VulnerabilityID,package:v.PkgName,version:v.InstalledVersion,severity:v.Severity,target:r.Target});
  }
 }
 return outcome(issues,{findings});
}
export function checkImageReceipt(receipt,{exceptions=[],now=Date.now(),root=process.cwd()}={}) {
 try {
  if(!receipt||!['api','worker'].includes(receipt.role)||receipt.scannerVersion!=='0.72.0'||!SHA.test(receipt.scannerSha256??'')||!SHA.test(receipt.reportSha256??'')||hashFile(receipt.reportPath)!==receipt.reportSha256||!Number.isFinite(Date.parse(receipt.scannedAt))||Date.parse(receipt.scannedAt)>now||now-Date.parse(receipt.scannedAt)>24*60*60*1000||!Array.isArray(receipt.databases)||!receipt.databases.length)throw new Error('Missing, malformed or stale image scan receipt');
  const required=receipt.role==='api'?['debian','node-pkg']:['debian','node-pkg','gobinary'];if(!Array.isArray(receipt.requiredTypes)||required.some(type=>!receipt.requiredTypes.includes(type)))throw new Error('Incomplete declared image role coverage');
  const inputsSha256=binding(receipt.inputs,root);
  if(hashFile(receipt.scannerPath)!==receipt.scannerSha256)throw new Error('Image scanner identity mismatch');
  for(const db of receipt.databases){const metadata=readJson(db.metadataPath);if(!SHA.test(db.sha256??'')||hashFile(db.path)!==db.sha256||!SHA.test(db.metadataSha256??'')||hashFile(db.metadataPath)!==db.metadataSha256||metadata.NextUpdate!==db.nextUpdate||!Number.isFinite(Date.parse(db.nextUpdate))||Date.parse(db.nextUpdate)<=now)throw new Error('Expired or mismatched image advisory database');}
  const validation=validateImageReport(readJson(receipt.reportPath),receipt);if(!validation.pass)return validation;
  const scopeSha256=digest({bindingSchema:INPUT_BINDING_SCHEMA,role:receipt.role,artifactId:receipt.artifactId,inputsSha256,scannerSha256:receipt.scannerSha256,databases:receipt.databases.map(db=>db.sha256)});
  return {...enforceFindingPolicy(validation.findings,exceptions,{scopeSha256},now),role:receipt.role,bindingSchema:INPUT_BINDING_SCHEMA,inputsSha256,scopeSha256,reportSha256:receipt.reportSha256};
 }catch(error){return outcome([error.message]);}
}
export function reuseJavaReceipt(receipt) {
 try {
  if(!receipt||receipt.scannerVersion!=='0.72.0'||!SHA.test(receipt.scannerSha256??'')||hashFile(receipt.scannerPath)!==receipt.scannerSha256||!SHA.test(receipt.reportSha256??'')||hashFile(receipt.reportPath)!==receipt.reportSha256||!SHA.test(receipt.inventorySha256??'')||hashFile(receipt.inventoryPath)!==receipt.inventorySha256||!Array.isArray(receipt.databases)||receipt.databases.length!==2)throw new Error('Missing or mismatched Java receipt');
  const inventory=readJson(receipt.inventoryPath);
  const shape=validateJavaArchiveReport({Results:[]},inventory);if(shape.issues.some(x=>x.startsWith('Invalid')||x.startsWith('Missing declared')))throw new Error('Invalid Java resources');
  if(JSON.stringify(fs.readdirSync(receipt.directory).sort())!==JSON.stringify(inventory.components.map(x=>x.resource).sort()))throw new Error('Java resource set drift');
  for(const item of inventory.components){if(!SHA.test(item.sha256??'')||hashFile(path.join(receipt.directory,item.resource))!==item.sha256)throw new Error('Java resource identity drift');}
  for(const db of receipt.databases){const metadata=readJson(db.metadataPath);if(!SHA.test(db.sha256??'')||hashFile(db.path)!==db.sha256||!SHA.test(db.metadataSha256??'')||hashFile(db.metadataPath)!==db.metadataSha256||!Number.isFinite(Date.parse(metadata.NextUpdate))||Date.parse(metadata.NextUpdate)<=Date.now())throw new Error('Java advisory database drift/expiry');}
  return {...validateJavaArchiveReport(readJson(receipt.reportPath),inventory),reused:true,scannerExecuted:false,reportSha256:receipt.reportSha256};
 }catch(error){return outcome([error.message],{reused:false,scannerExecuted:false});}
}
const REQUIRED_SECURITY_CHECKS=['regression','builds','database','code-security','container-api','container-worker','stage5-acceptance'];
export function securitySourceContext(root=process.cwd(),ref) {
 const git=args=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:5000});if(r.status!==0)throw new Error('Candidate Git identity unavailable');return r.stdout.trim();};
 if(git(['status','--porcelain','--untracked-files=all']))throw new Error('External security proof requires an exact clean candidate; dirty work remains preserved');
 const commit=git(['rev-parse','HEAD']),url=git(['remote','get-url','origin']),match=/^(?:https:\/\/github\.com\/|git@github\.com:)([-\w.]+\/[-\w.]+?)(?:\.git)?$/.exec(url);
 if(!match||!/^[a-f0-9]{40}$/.test(commit))throw new Error('Candidate repository identity unsupported/unavailable');
 ref=ref??process.env.GITHUB_REF??git(['symbolic-ref','HEAD']);
 if(typeof ref!=='string'||!ref.startsWith('refs/'))throw new Error('Candidate reference unavailable');
 return {repository:match[1],commit,ref,workflowSha256:hashFile(path.join(root,'.github/workflows/ci.yml')),ownerSha256:hashFile(path.join(root,'scripts/release-security.mjs'))};
}
export function validateGovernanceEvidence(payload,policy) {
 const issues=[],rules=payload?.branchRules,sets=payload?.rulesets,checks=policy?.requiredChecks;
 if(policy?.approved!==true||typeof policy.approvalReference!=='string'||!policy.approvalReference.trim()||typeof policy.reviewer!=='string'||!policy.reviewer||typeof policy.recoveryOwner!=='string'||!policy.recoveryOwner||!Number.isFinite(Date.parse(policy.expiresAt))||Date.parse(policy.expiresAt)<=Date.now()||!Array.isArray(checks)||checks.length!==REQUIRED_SECURITY_CHECKS.length||new Set(checks.map(x=>x.job)).size!==checks.length||new Set(checks.map(x=>x.context)).size!==checks.length||checks.some(x=>!REQUIRED_SECURITY_CHECKS.includes(x.job)||typeof x.context!=='string'||!x.context||!Number.isSafeInteger(x.appId)||x.appId<=0))return outcome(['Missing exact approved governance/check/reviewer/recovery decision']);
 if(!Array.isArray(rules)||!rules.length||!Array.isArray(sets)||!sets.length)return outcome(['Missing actual applied branch rules/ruleset observations']);
 for(const rule of rules){const set=sets.find(s=>s.id===rule.ruleset_id);if(!Number.isSafeInteger(rule.ruleset_id)||!set||set.enforcement!=='active'||!Array.isArray(set.bypass_actors)||set.bypass_actors.length)issues.push('Inactive, unknown or bypassed observed ruleset');}
 const status=rules.filter(r=>r.type==='required_status_checks'&&r.parameters?.strict_required_status_checks_policy===true).flatMap(r=>r.parameters.required_status_checks??[]);
 if(checks.some(c=>!status.some(x=>x.context===c.context&&x.integration_id===c.appId)))issues.push('Actual required check/app identity mismatch');
 if(!rules.some(r=>r.type==='pull_request'&&r.parameters?.required_approving_review_count>=1&&r.parameters.dismiss_stale_reviews_on_push===true))issues.push('Actual review protection missing');
 if(!rules.some(r=>r.type==='code_scanning'&&r.parameters?.code_scanning_tools?.some(t=>t.tool==='CodeQL'&&['high_or_higher','medium_or_higher','all'].includes(t.security_alerts_threshold)&&['errors','errors_and_warnings','all'].includes(t.alerts_threshold))))issues.push('Actual CodeQL findings protection missing');
 if(payload.reviewerPermission?.user?.login!==policy.reviewer||!['write','maintain','admin'].includes(payload.reviewerPermission?.permission))issues.push('Approved reviewer cannot satisfy required review');
 if(payload.recoveryPermission?.user?.login!==policy.recoveryOwner||payload.recoveryPermission?.permission!=='admin')issues.push('Approved recovery owner lacks administration');
 return outcome(issues,{reviewer:policy.reviewer,recoveryOwner:policy.recoveryOwner});
}
export function validateExternalObservation(observation,{kind,context,policy,now=Date.now()}) {
 const issues=[];
 if(observation?.schema!=='coop-security-observation-v1'||observation.kind!==kind||observation.complete!==true||!context||['repository','commit','workflowSha256','ownerSha256'].some(k=>observation[k]!==context[k])||!Number.isFinite(Date.parse(observation.observedAt))||Date.parse(observation.observedAt)>now||now-Date.parse(observation.observedAt)>24*60*60*1000)return outcome(['Missing, stale, partial or wrong-candidate external observation']);
 if(kind==='codeql'){
  if(observation.ref!==context.ref)return outcome(['CodeQL reference mismatch']);
  return validateCodeqlFindings({...observation.payload,commit:context.commit,ref:context.ref,complete:true});
 }
 if(kind==='governance'){
  if(observation.branch!==policy?.branch||policy?.repository!==context.repository)return outcome(['Governance target mismatch']);
  return validateGovernanceEvidence(observation.payload,policy);
 }
 return outcome(['Undeclared external security observation']);
}
export function checkExternalSecurity({root=process.cwd(),external}) {
 try {
  if(!external||typeof external.ref!=='string')throw new Error('Actual source-bound CodeQL/governance evidence and approved decision required');
  const context=securitySourceContext(root,external.ref),results=[];
  const read=entry=>{if(!entry||!SHA.test(entry.sha256??''))throw new Error('External evidence/decision hash mismatch');const bytes=fs.readFileSync(entry.path);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('External evidence/decision hash mismatch');return JSON.parse(bytes.toString('utf8'));};
  const policy=read(external.policy);
  for(const kind of ['codeql','governance']){const value=read(external[kind]);results.push({kind,...validateExternalObservation(value.observation??value,{kind,context,policy})});}
  if(JSON.stringify(securitySourceContext(root,external.ref))!==JSON.stringify(context))throw new Error('Candidate changed during external verification');
  return {pass:results.every(x=>x.pass),issues:results.flatMap(x=>x.issues),results,context};
 }catch(error){return outcome([error.message]);}
}
function observation(kind,payload,extra={}) {
 const context=securitySourceContext(process.cwd(),process.env.GITHUB_REF);if(process.env.GITHUB_ACTIONS==='true'&&(context.commit!==process.env.GITHUB_SHA||context.repository!==process.env.GITHUB_REPOSITORY))throw new Error('CI source/repository differs from observed request context');
 return {schema:'coop-security-observation-v1',kind,...context,observedAt:new Date().toISOString(),complete:true,payload,...extra};
}
function collectGovernance(policy) {
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.GH_TOKEN)throw new Error('Governance observation requires separately authorized CI read context');
 const shape=validateGovernanceEvidence({},policy);if(shape.issues[0]?.startsWith('Missing exact approved'))throw new Error(shape.issues[0]);
 const context=securitySourceContext();if(policy?.approved!==true||policy.repository!==context.repository||typeof policy.branch!=='string'||!/^[\w./-]+$/.test(policy.branch))throw new Error('Approved exact governance target missing');
 const get=endpoint=>{const r=spawnSync('gh',['api','--method','GET',endpoint],{encoding:'utf8',timeout:15000,maxBuffer:10*1024*1024});if(r.status!==0||r.error)throw new Error('Governance read unavailable; no proof');return JSON.parse(r.stdout);};
 const prefix='repos/'+context.repository,branchRules=get(prefix+'/rules/branches/'+encodeURIComponent(policy.branch));if(!Array.isArray(branchRules))throw new Error('Malformed applied branch rules');
 const ids=[...new Set(branchRules.map(r=>r.ruleset_id))];if(ids.length>20||ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('Incomplete ruleset identity/observation cap');
 const rulesets=ids.map(id=>get(prefix+'/rulesets/'+id));
 const reviewerPermission=get(prefix+'/collaborators/'+encodeURIComponent(policy.reviewer)+'/permission'),recoveryPermission=get(prefix+'/collaborators/'+encodeURIComponent(policy.recoveryOwner)+'/permission');
 return observation('governance',{branchRules,rulesets:rulesets.map(s=>({id:s.id,enforcement:s.enforcement,bypass_actors:s.bypass_actors})),reviewerPermission:{user:{login:reviewerPermission.user?.login},permission:reviewerPermission.permission},recoveryPermission:{user:{login:recoveryPermission.user?.login},permission:recoveryPermission.permission}},{branch:policy.branch});
}

function verifyCandidateInput(root,entry) {
 const listed=spawnSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8',timeout:5000});
 if(listed.status!==0||!entry?.target||!Array.isArray(entry.files))throw new Error('Complete current candidate inputs unavailable');
 const expected=listed.stdout.split('\0').filter(Boolean).map(file=>({path:file,sha256:hashFile(path.join(root,file))})).sort((a,b)=>a.path.localeCompare(b.path));
 const actual=entry.files.map(f=>({path:path.relative(entry.target,f.path).split(path.sep).join('/'),sha256:f.sha256})).sort((a,b)=>a.path.localeCompare(b.path));
 if(!expected.length||JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('Candidate corpus differs from complete current Git source');
}
export function runSecurity({root=process.cwd(),inputs={},evidenceDirectory}) {
 let before;try{before=securitySourceContext(root,inputs.external?.ref);}catch{}
 const results=[{scan:'audits',...runAudits({root,npmCli:inputs.npmCli,receipts:inputs.auditReceipts,evidenceDirectory})}];
 for(const scope of ['candidate','history','package']){
  const entry=inputs.secrets?.[scope];
  try{if(scope==='candidate')verifyCandidateInput(root,entry);results.push({scan:'secret-'+scope,...scanSecrets({scope,...entry,tool:inputs.gitleaks,config:inputs.gitleaksConfig,evidenceDirectory,exceptions:inputs.exceptions?.[scope],root})});}catch(error){results.push({scan:'secret-'+scope,...outcome([error.message])});}
 }
 for(const role of ['api','worker']){
  const receipts=(inputs.images??[]).filter(x=>x.role===role);
  try{if(receipts.length!==1)throw new Error('Exactly one bound '+role+' image receipt required');if(JSON.stringify(canonicalInputBindings(receipts[0].inputs,root))!==JSON.stringify(canonicalInputBindings(imageSourceInputs(root),root)))throw new Error('Incomplete current image source binding');results.push({scan:'image-'+role,...checkImageReceipt(receipts[0],{exceptions:inputs.exceptions?.[role],root})});}catch(error){results.push({scan:'image-'+role,...outcome([error.message])});}

 }
 results.push({scan:'embedded-java',...(inputs.javaReceipt?reuseJavaReceipt(inputs.javaReceipt):scanJavaArchives({directory:process.env.COOP_RELEASE_JAVA_ROOT,inventoryPath:process.env.COOP_RELEASE_JAVA_INVENTORY,executable:process.env.TRIVY_BIN,expectedExecutableSha256:process.env.COOP_RELEASE_TRIVY_SHA256,cacheDirectory:process.env.TRIVY_CACHE_DIR,evidenceDirectory}))});
 // Actual CodeQL findings/repository enforcement are supplied by the separately
 // authorized remote campaign; analysis-success or local status cannot replace it.
 const external=checkExternalSecurity({root,external:inputs.external});
 if(external.pass&&JSON.stringify(before)!==JSON.stringify(external.context)){external.pass=false;external.issues.push('Candidate changed during local security checks');}
 const scopes=['candidate','history','package','api','worker'];
 if(inputs.exceptions&&(typeof inputs.exceptions!=='object'||Array.isArray(inputs.exceptions)||Object.keys(inputs.exceptions).some(k=>!scopes.includes(k)||!Array.isArray(inputs.exceptions[k]))))results.push({scan:'exception-input',...outcome(['Unknown or malformed exception scope'])});
 const localPass=results.every(x=>x.pass),externalRequirements=external.pass?[]:external.issues;
 return {schema:'coop-release-security-v1',pass:localPass&&external.pass,localPass,results,external,externalRequirements,qualification:'Automated security evidence only; package/live/provider/operations/production authorization remain separate required gates.'};
}
export function validateCodeqlFindings({analyses,alerts,commit,ref,complete}) {
 const issues=[];
 if(!/^[a-f0-9]{40}$/.test(commit??'')||typeof ref!=='string'||!ref.startsWith('refs/')||complete!==true||!Array.isArray(analyses)||!Array.isArray(alerts))return outcome(['Missing complete source-bound CodeQL evidence']);
 const current=analyses.filter(a=>a.commit_sha===commit&&a.ref===ref&&a.tool?.name==='CodeQL');
 if(!current.length||current.some(a=>a.error!==''||!Number.isSafeInteger(a.results_count)||a.results_count<0||!Number.isSafeInteger(a.rules_count)||a.rules_count<=0))issues.push('Current CodeQL analysis absent/failed');
 const findings=[];
 for(const alert of alerts){
  const severity=alert?.rule?.severity,security=alert?.rule?.security_severity_level;
  if(alert?.state!=='open'||alert.tool?.name!=='CodeQL'||!['error','warning','note'].includes(severity)||(security!==null&&security!==undefined&&!['critical','high','medium','low'].includes(security))){issues.push('Malformed/unscoped CodeQL alert');continue;}
  if(severity==='error'||['critical','high'].includes(security))findings.push({number:alert.number,rule:alert.rule.id,severity,securitySeverity:security??null});
 }
 if(findings.length)issues.push('Blocking CodeQL HIGH/CRITICAL/security ERROR findings');
 return outcome(issues,{commit,ref,alertsReviewed:alerts.length,findings});
}
function codeqlFindings() {
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.GH_TOKEN||!/^[-\w.]+\/[-\w.]+$/.test(process.env.GITHUB_REPOSITORY??''))return outcome(['CodeQL requires authorized GitHub CI context and read access']);
 try {
  const fetchPages=kind=>{const all=[];for(let page=1;page<=20;page++){
   const args=['api','--method','GET',`repos/${process.env.GITHUB_REPOSITORY}/code-scanning/${kind}`,'-f',`ref=${process.env.GITHUB_REF}`,'-f','tool_name=CodeQL','-F','per_page=100','-F',`page=${page}`,...(kind==='alerts'?['-f','state=open']:[])];
   const result=spawnSync('gh',args,{encoding:'utf8',timeout:15000,maxBuffer:20*1024*1024});if(result.status!==0||result.error)throw new Error('CodeQL evidence inaccessible; no findings pass');
   const rows=JSON.parse(result.stdout);if(!Array.isArray(rows))throw new Error('Malformed CodeQL API response');all.push(...rows);if(kind==='analyses'||rows.length<100)return all;
  }throw new Error('CodeQL pagination cap reached; incomplete evidence');};
  const analyses=fetchPages('analyses').map(a=>({commit_sha:a.commit_sha,ref:a.ref,tool:{name:a.tool?.name},error:a.error===''?'':'analysis error',results_count:a.results_count,rules_count:a.rules_count})),alerts=fetchPages('alerts').map(a=>({number:a.number,state:a.state,tool:{name:a.tool?.name},rule:{id:a.rule?.id,severity:a.rule?.severity,security_severity_level:a.rule?.security_severity_level}}));
  const receipt=observation('codeql',{analyses,alerts});
  return {...validateCodeqlFindings({analyses,alerts,commit:process.env.GITHUB_SHA,ref:process.env.GITHUB_REF,complete:true}),observation:receipt};
 }catch(error){return outcome([error.message]);}
}
function frozenImageDecision(policy,{role,context,root=process.cwd(),now=Date.now()}) {
 if(policy?.schema!=='coop-frozen-image-import-v1'||policy.approved!==true||typeof policy.owner!=='string'||!policy.owner.trim()||typeof policy.approvalReference!=='string'||!policy.approvalReference.trim()||!Number.isFinite(Date.parse(policy.expiresAt))||Date.parse(policy.expiresAt)<=now||policy.sourceRepository!==context?.repository||policy.candidateCommit!==context?.commit||!/^[a-f0-9]{40}$/.test(context?.commit??'')||!/^[-\w.]+\/[-\w.]+$/.test(policy.custodyRepository??'')||policy.custodyRepository===context.repository||!SHA.test(policy.inputsSha256??'')||policy.inputsSha256!==binding(imageSourceInputs(root),root)||!Array.isArray(policy.images)||policy.images.length!==2||new Set(policy.images.map(x=>x.role)).size!==2||policy.images.some(x=>!['api','worker'].includes(x.role)))throw new Error('Missing exact approved frozen image/source/custody decision');
 for(const image of policy.images)if(!Number.isSafeInteger(image.runId)||image.runId<=0||!Number.isSafeInteger(image.artifactId)||image.artifactId<=0||!/^sha256:[a-f0-9]{64}$/.test(image.artifactDigest??'')||!/^sha256:[a-f0-9]{64}$/.test(image.configurationId??'')||!SHA.test(image.archiveSha256??'')||!Number.isSafeInteger(image.archiveBytes)||image.archiveBytes<=0||image.platform!=='linux/amd64'||!/^[a-f0-9]{40}$/.test(image.custodyCommit??''))throw new Error('Invalid frozen artifact identity');
 const image=policy.images.find(x=>x.role===role);if(!image)throw new Error('Unknown frozen image role');return image;
}
export function validateFrozenImageCustody(policy,{role,context,root=process.cwd(),repository,artifact,now=Date.now()}) {
 const image=frozenImageDecision(policy,{role,context,root,now});
 if(repository?.full_name!==policy.custodyRepository||repository.private!==true||artifact?.id!==image.artifactId||artifact.expired!==false||artifact.digest!==image.artifactDigest||artifact.workflow_run?.id!==image.runId||artifact.workflow_run?.head_sha!==image.custodyCommit||!Number.isFinite(Date.parse(artifact.expires_at))||Date.parse(artifact.expires_at)<Date.parse(policy.expiresAt))throw new Error('Missing private immutable artifact custody/freshness proof');
 return {pass:true,role,repository:policy.custodyRepository,runId:image.runId,artifactId:image.artifactId,artifactDigest:image.artifactDigest,configurationId:image.configurationId,archiveSha256:image.archiveSha256,archiveBytes:image.archiveBytes,inputsSha256:policy.inputsSha256,policySha256:digest(policy)};
}
export function verifyFrozenImageArchive(policy,{role,context,root=process.cwd(),directory,repository,artifact,now=Date.now()}) {
 const receipt=validateFrozenImageCustody(policy,{role,context,root,repository,artifact,now});
 if(typeof directory!=='string'||!directory||fs.lstatSync(directory).isSymbolicLink()||JSON.stringify(fs.readdirSync(directory).sort())!==JSON.stringify(['image.tar']))throw new Error('Frozen image bundle must contain only the exact archive');
 const archive=path.join(directory,'image.tar');if(fs.lstatSync(archive).isSymbolicLink()||!fs.statSync(archive).isFile()||fs.statSync(archive).size!==receipt.archiveBytes||hashFile(archive)!==receipt.archiveSha256||imageIdentityFromArchive(archive,'linux/amd64')!==receipt.configurationId)throw new Error('Frozen image archive/configuration changed');
 return receipt;
}
function frozenImageFromEnvironment(verifyArchive=false) {
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.COOP_RELEASE_FROZEN_IMAGE_POLICY)throw new Error('Frozen import requires explicit CI context and decision');
 const policy=JSON.parse(process.env.COOP_RELEASE_FROZEN_IMAGE_POLICY),role=process.env.COOP_RELEASE_IMAGE_ROLE,context=securitySourceContext();
 if(context.commit!==process.env.GITHUB_SHA||context.repository!==process.env.GITHUB_REPOSITORY)throw new Error('Frozen import CI candidate mismatch');
 frozenImageDecision(policy,{role,context});
 const metadataPath=path.join(process.env.RUNNER_TEMP,'frozen-image-custody-'+role+'.json');let metadata;
 if(verifyArchive){metadata=readJson(metadataPath);return verifyFrozenImageArchive(policy,{role,context,directory:path.join(process.env.RUNNER_TEMP,'frozen-image'),...metadata});}
 if(!process.env.GH_TOKEN)throw new Error('Private artifact read credential unavailable');
 const get=endpoint=>{const r=spawnSync('gh',['api','--method','GET',endpoint],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});if(r.status!==0||r.error)throw new Error('Private custody metadata read unavailable');return JSON.parse(r.stdout);};
 const image=policy.images.find(x=>x.role===role),repository=get('repos/'+policy.custodyRepository),artifact=get('repos/'+policy.custodyRepository+'/actions/artifacts/'+image.artifactId);metadata={repository:{full_name:repository.full_name,private:repository.private},artifact:{id:artifact.id,expired:artifact.expired,digest:artifact.digest,expires_at:artifact.expires_at,workflow_run:artifact.workflow_run}};
 const receipt=validateFrozenImageCustody(policy,{role,context,...metadata});fs.writeFileSync(metadataPath,JSON.stringify(metadata),{mode:0o600});
 if(!process.env.GITHUB_OUTPUT)throw new Error('CI output path unavailable');fs.appendFileSync(process.env.GITHUB_OUTPUT,`repository=${receipt.repository}\nrun-id=${receipt.runId}\nartifact-id=${receipt.artifactId}\n`);return receipt;
}
export function imageIdentityFromArchive(archivePath,expectedPlatform) {
 const result=spawnSync('python3',['-c',`import hashlib,json,sys,tarfile,pathlib
with tarfile.open(sys.argv[1]) as archive:
 manifest=json.load(archive.extractfile('manifest.json'))
 assert isinstance(manifest,list) and len(manifest)==1, 'Expected one exact image archive'
 name=manifest[0]['Config']
 assert not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts, 'Unsafe image configuration path'
 data=archive.extractfile(name).read()
 identity=hashlib.sha256(data).hexdigest()
 assert identity in pathlib.PurePosixPath(name).name, 'Image configuration digest mismatch'
 config=json.loads(data)
 assert config.get('os')=='linux' and config.get('architecture') in ['amd64','arm64'], 'Unsupported image platform'
 assert not sys.argv[2] or config.get('os')+'/'+config.get('architecture')==sys.argv[2], 'Wrong frozen image platform'
 print('sha256:'+identity)
`,archivePath,expectedPlatform??''],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
 if(result.status!==0||result.error||!/^sha256:[a-f0-9]{64}$/.test(result.stdout.trim()))throw new Error('Exact image archive configuration identity unavailable');
 return result.stdout.trim();
}
export function imageSourceInputs(root=process.cwd()) {
 const files=[];
 const visit=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('Image source symlink unsupported');if(entry.isDirectory())visit(file);else if(entry.isFile())files.push({path:file,sha256:hashFile(file)});}};
 for(const directory of ['src','migrations','scripts/indexer-tools'])visit(path.join(root,directory));
 for(const name of ['Dockerfile','.dockerignore','package.json','package-lock.json','tsconfig.backend.json','scripts/admin-org.ts','scripts/run-migrations.mjs','scripts/runtime-entrypoint'])files.push({path:path.join(root,name),sha256:hashFile(path.join(root,name))});
 return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function imageReceiptFromEnvironment() {
 const cache=process.env.TRIVY_CACHE_DIR,databases=[];
 for(const name of ['db/trivy.db','java-db/trivy-java.db']){const file=path.join(cache,name),metadataPath=path.join(path.dirname(file),'metadata.json'),metadata=readJson(metadataPath);databases.push({path:file,sha256:hashFile(file),metadataPath,metadataSha256:hashFile(metadataPath),nextUpdate:metadata.NextUpdate});}
 const reportPath=process.env.COOP_RELEASE_IMAGE_REPORT,report=readJson(reportPath);
 return {role:process.env.COOP_RELEASE_IMAGE_ROLE,artifactId:process.env.COOP_RELEASE_IMAGE_ID,scannerVersion:'0.72.0',scannerPath:process.env.TRIVY_BIN,scannerSha256:process.env.COOP_RELEASE_TRIVY_SHA256,reportPath,reportSha256:hashFile(reportPath),scannedAt:new Date().toISOString(),databases,inputs:canonicalInputBindings(readJson(process.env.COOP_RELEASE_IMAGE_INPUTS),process.cwd()),requiredTypes:process.env.COOP_RELEASE_IMAGE_ROLE==='api'?['debian','node-pkg']:['debian','node-pkg','gobinary']};
}

function main() {
 const args=process.argv.slice(2);
 if(args.length===2&&args[0]==='--image-identity'){console.log(imageIdentityFromArchive(args[1]));return;}
 if(args.length===1&&args[0]==='--image-inputs'){console.log(JSON.stringify(imageSourceInputs(),null,2));return;}
 if(args.length===1&&['--frozen-image-source','--frozen-image-import'].includes(args[0])){const receipt=frozenImageFromEnvironment(args[0]==='--frozen-image-import');if(args[0]==='--frozen-image-import')fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'frozen-image-import-'+receipt.role+'.json'),JSON.stringify(receipt),{mode:0o600});return;}
 const scope=args[0]==='--governance-observation'?'governance':args[0]==='--codeql-findings'?'codeql':args[0]==='--image-report'?'image':args[0]==='--java-archive'?'java':'security',directory=process.env.COOP_RELEASE_EVIDENCE_DIR?path.join(process.env.COOP_RELEASE_EVIDENCE_DIR,scope):fs.mkdtempSync(path.join(os.tmpdir(),'coop-security-'));
 fs.mkdirSync(directory,{recursive:true,mode:0o700});if(fs.readdirSync(directory).length)throw new Error('Security evidence directory must be empty');fs.chmodSync(directory,0o700);
 console.log('Security evidence: '+directory);
 let result;
 if(args.length===1&&args[0]==='--governance-observation'){try{const policy=readJson(process.env.COOP_RELEASE_GOVERNANCE_POLICY),receipt=collectGovernance(policy);result={...validateExternalObservation(receipt,{kind:'governance',context:securitySourceContext(),policy}),observation:receipt};}catch(error){result=outcome([error.message]);}}
 else if(args.length===1&&args[0]==='--codeql-findings')result=codeqlFindings();
 else if(args.length===1&&args[0]==='--image-report'){try{const custody=process.env.COOP_RELEASE_FROZEN_IMAGE_POLICY?frozenImageFromEnvironment(true):null;result=checkImageReceipt(imageReceiptFromEnvironment());if(custody)result.frozenImport={pass:true,archiveSha256:custody.archiveSha256,configurationId:custody.configurationId,inputsSha256:custody.inputsSha256,policySha256:custody.policySha256};}catch(error){result=outcome([error.message]);}}
 else if(args.length===1&&args[0]==='--java-archive')result=scanJavaArchives({directory:process.env.COOP_RELEASE_JAVA_ROOT,inventoryPath:process.env.COOP_RELEASE_JAVA_INVENTORY,executable:process.env.TRIVY_BIN,expectedExecutableSha256:process.env.COOP_RELEASE_TRIVY_SHA256,cacheDirectory:process.env.TRIVY_CACHE_DIR,evidenceDirectory:directory});
 else if(args.length===1&&args[0]==='--source'){
  try{const inputs=readJson(process.env.COOP_RELEASE_SECURITY_INPUTS),results=[{scan:'audits',...runAudits({npmCli:inputs.npmCli,receipts:inputs.auditReceipts,evidenceDirectory:directory})}];
   for(const scope of ['candidate','history','package']){if(scope==='candidate')verifyCandidateInput(process.cwd(),inputs.secrets?.[scope]);results.push({scan:'secret-'+scope,...scanSecrets({scope,...inputs.secrets?.[scope],tool:inputs.gitleaks,config:inputs.gitleaksConfig,exceptions:inputs.exceptions?.[scope],evidenceDirectory:directory})});}
   result={schema:'coop-source-security-v1',pass:results.every(x=>x.pass),results,qualification:'Source checks only; image, Java, static and governance remain required.'};
  }catch(error){result=outcome([error.message]);}
 }
 else if(!args.length){
  try {const inputs=process.env.COOP_RELEASE_SECURITY_INPUTS?readJson(process.env.COOP_RELEASE_SECURITY_INPUTS):{};result=runSecurity({inputs,evidenceDirectory:directory});}
  catch(error){result=outcome([error.message]);}
 }else throw new Error('Use no arguments, --source, --java-archive, --image-inputs, --image-report, --codeql-findings or --governance-observation; no arbitrary commands or targets accepted');
 if(result.observation)fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify(result.observation,null,2),{mode:0o600});
 fs.writeFileSync(path.join(directory,scope==='codeql'?'findings.json':scope==='image'?'result.json':'results.json'),JSON.stringify(result,null,2),{mode:0o600});process.exitCode=result.pass?0:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

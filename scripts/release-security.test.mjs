import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateFrozenImageCustody,verifyFrozenImageArchive,canonicalInputBindings,imageIdentityFromArchive,validateJavaArchiveReport,scanJavaArchives,validateAudit,enforceFindingPolicy,runAudits,scanSecrets,validateImageReport,checkImageReceipt,runSecurity,validateCodeqlFindings,validateExternalObservation,validateGovernanceEvidence,checkExternalSecurity,securitySourceContext,imageSourceInputs} from './release-security.mjs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashValue=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inventory={components:[{resource:'one.jar',sha256:'0'.repeat(64)},{resource:'two.jar',sha256:'1'.repeat(64)}]};
const report=()=>({Results:[{Type:'jar',Packages:inventory.components.map(x=>({Name:'fixture:'+x.resource,Version:'1.0',FilePath:x.resource,AnalyzedBy:'jar'}))}]});
test('complete declared Java coverage passes; zero-package and partial scans fail',()=>{
 assert.equal(validateJavaArchiveReport(report(),inventory).pass,true);
 assert.equal(validateJavaArchiveReport({Results:[]},inventory).pass,false);
 const missing=report();missing.Results[0].Packages.pop();assert.equal(validateJavaArchiveReport(missing,inventory).pass,false);
});
test('new HIGH/CRITICAL findings, malformed metadata and undeclared resources fail',()=>{
 for(const Severity of ['HIGH','CRITICAL']){const r=report();r.Results[0].Vulnerabilities=[{Severity,VulnerabilityID:'CVE-fixture'}];assert.equal(validateJavaArchiveReport(r,inventory).pass,false);}
 const malformed=report();delete malformed.Results[0].Packages[0].Version;assert.equal(validateJavaArchiveReport(malformed,inventory).pass,false);
 const extra=report();extra.Results[0].Packages.push({Name:'fixture:extra',Version:'1',FilePath:'extra.jar',AnalyzedBy:'jar'});assert.equal(validateJavaArchiveReport(extra,inventory).pass,false);
 assert.equal(validateJavaArchiveReport(report(),{components:[{resource:'../escape.jar'}]}).pass,false);
 assert.equal(validateJavaArchiveReport(report(),{components:[inventory.components[0],inventory.components[0]]}).pass,false);
});
test('resource drift rejects before scanner execution; missing configuration cannot pass',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'coop-java-identity-'));
 try {
  const inventoryPath=path.join(directory,'inventory.json');fs.writeFileSync(inventoryPath,JSON.stringify({components:[inventory.components[0]]}));fs.writeFileSync(path.join(directory,'one.jar'),'changed');
  const result=scanJavaArchives({directory,inventoryPath,executable:'/nonexistent/pinned-tool',expectedExecutableSha256:'a'.repeat(64),cacheDirectory:directory,evidenceDirectory:directory});
  assert.equal(result.pass,false);assert.equal(result.scannerExecuted,false);assert.match(result.issues.join(' '),/resource identity mismatch/);
  assert.equal(scanJavaArchives({}).pass,false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

const cleanAudit=()=>({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}});
test('audit findings, missing setup, malformed totals and stale evidence cannot pass',()=>{
 assert.equal(validateAudit(cleanAudit()).pass,true);
 for(const r of [{}, {...cleanAudit(),error:{message:'registry'}}, {...cleanAudit(),vulnerabilities:{hidden:{}}}])assert.equal(validateAudit(r).pass,false);
 const r=cleanAudit();r.metadata.vulnerabilities.high=1;assert.equal(validateAudit(r).pass,false);
 const result=runAudits({root:'/nonexistent',receipts:[],evidenceDirectory:'/nonexistent'});assert.equal(result.results.length,8);assert.equal(result.pass,false);
});
test('exact explicit exceptions work; proposals, expiry, scope drift and new findings fail',()=>{
 const finding={id:'CVE-fixture',package:'fixture',version:'1',severity:'HIGH'},context={scopeSha256:'a'.repeat(64)},now=Date.parse('2026-10-13T00:00:00Z');
 const approval={findingSha256:hashValue(finding),scopeSha256:context.scopeSha256,approved:true,owner:'fixture-owner',reason:'synthetic control',approvalReference:'fixture-explicit-approval',expiresAt:'2026-10-14T00:00:00Z'};
 assert.equal(enforceFindingPolicy([finding],[approval],context,now).pass,true);
 for(const changed of [{approved:false},{expiresAt:'2026-10-12T00:00:00Z'},{scopeSha256:'b'.repeat(64)},{approvalReference:''}])assert.equal(enforceFindingPolicy([finding],[{...approval,...changed}],context,now).pass,false);
 assert.equal(enforceFindingPolicy([finding,{...finding,version:'2'}],[approval],context,now).pass,false);
 assert.equal(enforceFindingPolicy([finding],[approval,approval],context,now).pass,false);
 assert.equal(enforceFindingPolicy([],[],{}).pass,false);
});
test('empty/subset/changed secret corpus cannot borrow a clean receipt',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-secret-corpus-'));
 try{
  const a=path.join(d,'a.txt');fs.writeFileSync(a,'fixture');const files=[{path:a,sha256:sha(a)}];
  const empty=path.join(d,'empty');fs.mkdirSync(empty);
  assert.match(scanSecrets({scope:'candidate',target:empty,files}).issues.join(' '),/corpus|outside declared root/);
  fs.writeFileSync(path.join(d,'undeclared.txt'),'fixture');assert.match(scanSecrets({scope:'candidate',target:d,files}).issues.join(' '),/corpus|outside declared root/);
  fs.writeFileSync(a,'changed');assert.match(scanSecrets({scope:'candidate',target:d,files}).issues.join(' '),/identity/);
  assert.equal(scanSecrets({scope:'package'}).pass,false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
const imageReport=()=>({ArtifactType:'container_image',Metadata:{ImageID:'sha256:'+'a'.repeat(64)},Results:[{Type:'debian',Target:'fixture',Packages:[{Name:'fixture',Version:'1'}],Vulnerabilities:[]},{Type:'node-pkg',Target:'fixture-node',Packages:[{Name:'fixture-node',Version:'1'}],Vulnerabilities:[]}]});
test('image artifacts require package coverage and exact identity; HIGH rows remain visible',()=>{
 const config={artifactId:'sha256:'+'a'.repeat(64),requiredTypes:['debian']};
 assert.equal(validateImageReport(imageReport(),config).pass,true);
 assert.equal(validateImageReport(imageReport(),{...config,artifactId:'sha256:'+'b'.repeat(64)}).pass,false);
 const missing=imageReport();delete missing.Results[0].Packages;assert.equal(validateImageReport(missing,config).pass,false);
 const high=imageReport();high.Results[0].Vulnerabilities=[{VulnerabilityID:'CVE-fixture',PkgName:'fixture',InstalledVersion:'1',Severity:'HIGH'}];assert.equal(validateImageReport(high,config).findings.length,1);
 high.Results[0].Vulnerabilities[0].Severity='not-severity';assert.equal(validateImageReport(high,config).pass,false);
 assert.equal(checkImageReceipt({}).pass,false);
});
test('all eight exact current audit receipts pass; lock/report/age drift fails',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-audit-reuse-')),now=Date.parse('2026-10-13T00:00:00Z');
 try{
  const reportPath=path.join(d,'audit.json');fs.writeFileSync(reportPath,JSON.stringify(cleanAudit()));const receipts=[];
  for(const area of ['root','admin','ops','website']){const folder=area==='root'?d:path.join(d,area);fs.mkdirSync(folder,{recursive:true});const lock=path.join(folder,'package-lock.json');fs.writeFileSync(lock,JSON.stringify({area}));for(const kind of ['full','production'])receipts.push({area,kind,lockSha256:sha(lock),reportPath,reportSha256:sha(reportPath),node:'22.23.3',npm:'10.9.9',exitCode:0,scannedAt:'2026-10-12T23:00:00Z'});}
  assert.equal(runAudits({root:d,receipts,evidenceDirectory:d,now}).pass,true);
  const stale=receipts.map(x=>({...x,scannedAt:'2026-10-10T00:00:00Z'}));assert.equal(runAudits({root:d,receipts:stale,evidenceDirectory:d,now}).pass,false);
  fs.writeFileSync(path.join(d,'package-lock.json'),'changed');assert.equal(runAudits({root:d,receipts,evidenceDirectory:d,now}).pass,false);
  fs.writeFileSync(reportPath,'{}');assert.equal(runAudits({root:d,receipts,evidenceDirectory:d,now}).pass,false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('default CLI invokes all required local adapters and denies missing external qualification',()=>{
 const env={PATH:process.env.PATH};const r=spawnSync(process.execPath,['scripts/release-security.mjs'],{encoding:'utf8',env,timeout:15000});
 assert.equal(r.status,1);const d=/Security evidence: (.*)/.exec(r.stdout)?.[1];assert.ok(d);
 try{const result=JSON.parse(fs.readFileSync(path.join(d,'results.json'),'utf8'));assert.equal(result.pass,false);assert.equal(result.results.length,7);assert.equal(result.results.every(x=>x.pass===false),true);assert.match(result.externalRequirements.join(' '),/CodeQL/);}
 finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('secret adapter executes pinned scanner, passes clean declared corpus and rejects detected findings',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-secret-execution-'));
 try{
  const corpus=path.join(d,'corpus');fs.mkdirSync(corpus);const source=path.join(corpus,'source.txt');fs.writeFileSync(source,'clean fixture');
  const tool=path.join(d,'scanner');fs.writeFileSync(tool,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='version'){console.log('8.30.1');process.exit(0);}const args=process.argv.slice(2);const file=args[args.indexOf('--report-path')+1];const found=fs.readFileSync(args.at(-1)+'/source.txt','utf8').includes('detected');fs.writeFileSync(file,JSON.stringify(found?[{Secret:'REDACTED',RuleID:'fixture-rule',File:'source.txt',StartLine:1,EndLine:1,Commit:''}]:[]));process.exit(found?1:0);`);fs.chmodSync(tool,0o700);
  const config=path.join(d,'config.toml');fs.writeFileSync(config,'[extend]\nuseDefault = true\n');
  const run=()=>scanSecrets({scope:'candidate',target:corpus,files:[{path:source,sha256:sha(source)}],tool:{path:tool,sha256:sha(tool)},config:{path:config,sha256:sha(config)},evidenceDirectory:d});
  assert.equal(run().pass,true);fs.writeFileSync(source,'detected synthetic finding');const found=run();assert.equal(found.scannerExecuted,true);assert.equal(found.findings,1);assert.equal(found.pass,false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('image receipt binds current source, scanner, report and advisory metadata; expiry/drift denies',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-image-receipt-')),now=Date.parse('2026-10-13T00:00:00Z');
 try{
  const write=(name,value)=>{const file=path.join(d,name);fs.writeFileSync(file,value);return file;};
  const reportPath=write('report.json',JSON.stringify(imageReport())),source=write('input','fixture'),scannerPath=write('scanner','fixture scanner'),db=write('db','fixture db');
  const metadataPath=write('metadata.json',JSON.stringify({NextUpdate:'2026-10-14T00:00:00Z'}));
  const receipt={role:'api',artifactId:'sha256:'+'a'.repeat(64),requiredTypes:['debian','node-pkg'],scannerVersion:'0.72.0',scannerPath,scannerSha256:sha(scannerPath),reportPath,reportSha256:sha(reportPath),scannedAt:'2026-10-12T23:00:00Z',inputs:[{path:source,sha256:sha(source)}],databases:[{path:db,sha256:sha(db),metadataPath,metadataSha256:sha(metadataPath),nextUpdate:'2026-10-14T00:00:00Z'}]};
  assert.equal(checkImageReceipt(receipt,{now,root:d}).pass,true);
  assert.equal(checkImageReceipt(receipt,{now:Date.parse('2026-10-14T00:00:00Z'),root:d}).pass,false);
  fs.writeFileSync(source,'changed');assert.equal(checkImageReceipt(receipt,{now,root:d}).pass,false);fs.writeFileSync(source,'fixture');
  fs.writeFileSync(metadataPath,JSON.stringify({NextUpdate:'2026-10-12T00:00:00Z'}));assert.equal(checkImageReceipt(receipt,{now,root:d}).pass,false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('CodeQL analysis success alone cannot waive HIGH/CRITICAL/ERROR or incomplete current findings',()=>{
 const commit='a'.repeat(40),ref='refs/heads/fixture',base={commit,ref,complete:true,analyses:[{commit_sha:commit,ref,tool:{name:'CodeQL'},error:'',results_count:0,rules_count:1}],alerts:[]};
 assert.equal(validateCodeqlFindings(base).pass,true);
 for(const changed of [{complete:false},{analyses:[]},{commit:'b'.repeat(40)},{ref:'refs/heads/other'}])assert.equal(validateCodeqlFindings({...base,...changed}).pass,false);
 for(const [severity,security] of [['warning','high'],['warning','critical'],['error',null],['invented',null]])assert.equal(validateCodeqlFindings({...base,alerts:[{state:'open',tool:{name:'CodeQL'},rule:{id:'fixture',severity,security_severity_level:security},number:1}]}).pass,false);
 assert.equal(validateCodeqlFindings({...base,alerts:[{state:'open',tool:{name:'CodeQL'},rule:{id:'fixture',severity:'warning',security_severity_level:'medium'},number:1}]}).pass,true);
});

const externalContext={repository:'fixture/repo',commit:'a'.repeat(40),ref:'refs/heads/fixture',workflowSha256:'b'.repeat(64),ownerSha256:'c'.repeat(64)};
const govPolicy=()=>({approved:true,repository:'fixture/repo',branch:'main',approvalReference:'synthetic-explicit-decision',reviewer:'fixture-reviewer',recoveryOwner:'fixture-admin',expiresAt:'2099-01-01T00:00:00Z',requiredChecks:['regression','builds','database','code-security','container-api','container-worker','stage5-acceptance'].map((job,i)=>({job,context:job,appId:i+1}))});
const govPayload=()=>({branchRules:[{ruleset_id:1,type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,required_status_checks:govPolicy().requiredChecks.map(c=>({context:c.context,integration_id:c.appId}))}},{ruleset_id:1,type:'pull_request',parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true}},{ruleset_id:1,type:'code_scanning',parameters:{code_scanning_tools:[{tool:'CodeQL',security_alerts_threshold:'high_or_higher',alerts_threshold:'errors'}]}}],rulesets:[{id:1,enforcement:'active',bypass_actors:[]}],reviewerPermission:{user:{login:'fixture-reviewer'},permission:'write'},recoveryPermission:{user:{login:'fixture-admin'},permission:'admin'}});
const externalObservation=kind=>({schema:'coop-security-observation-v1',kind,...externalContext,complete:true,observedAt:new Date().toISOString(),branch:'main',payload:kind==='governance'?govPayload():{analyses:[{commit_sha:externalContext.commit,ref:externalContext.ref,tool:{name:'CodeQL'},error:'',results_count:0,rules_count:1}],alerts:[]}});
test('external handoff accepts exact observed candidate and denies summary-only, drift, expiry and partial proof',()=>{
 for(const kind of ['codeql','governance']){const good=externalObservation(kind),options={kind,context:externalContext,policy:govPolicy()};assert.equal(validateExternalObservation(good,options).pass,true);
  for(const delta of [{schema:undefined},{ownerSha256:'d'.repeat(64)},{commit:'e'.repeat(40)},{workflowSha256:'f'.repeat(64)},{repository:'other/repo'},{complete:false},{observedAt:'2020-01-01T00:00:00Z'}])assert.equal(validateExternalObservation({...good,...delta},options).pass,false);
 }
 const high=externalObservation('codeql');high.payload.alerts=[{state:'open',number:1,tool:{name:'CodeQL'},rule:{id:'fixture',severity:'warning',security_severity_level:'high'}}];assert.equal(validateExternalObservation(high,{kind:'codeql',context:externalContext}).pass,false);
 assert.equal(validateExternalObservation({pass:true}, {kind:'codeql',context:externalContext}).pass,false);
});
test('governance proves active exact checks/apps, actual findings blocking, viable reviewer and admin recovery',()=>{
 assert.equal(validateGovernanceEvidence(govPayload(),govPolicy()).pass,true);
 for(const fault of ['app','review','findings','inactive','bypass','reviewer','recovery']){const p=govPayload();if(fault==='app')p.branchRules[0].parameters.required_status_checks[0].integration_id=999;if(fault==='review')p.branchRules[1].parameters.required_approving_review_count=0;if(fault==='findings')p.branchRules.pop();if(fault==='inactive')p.rulesets[0].enforcement='evaluate';if(fault==='bypass')p.rulesets[0].bypass_actors=[{actor_id:1}];if(fault==='reviewer')p.reviewerPermission.permission='read';if(fault==='recovery')p.recoveryPermission.permission='write';assert.equal(validateGovernanceEvidence(p,govPolicy()).pass,false);}
 for(const delta of [{approved:false},{approvalReference:''},{expiresAt:'2020-01-01T00:00:00Z'},{requiredChecks:[]}])assert.equal(validateGovernanceEvidence(govPayload(),{...govPolicy(),...delta}).pass,false);
});
test('full security owner can pass complete synthetic retained proof; missing/drifted/partial inputs and new Java findings deny',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coop-full-security-')),data=path.join(root,'_evidence');fs.mkdirSync(data);
 const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;};
 const g=args=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},timeout:10000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 try{
  for(const name of ['src/fixture.ts','migrations/fixture.sql','scripts/indexer-tools/go.mod','tsconfig.backend.json','scripts/admin-org.ts','scripts/run-migrations.mjs','scripts/runtime-entrypoint','.dockerignore','Dockerfile','.github/workflows/ci.yml','scripts/release-security.mjs'])write(name,'fixture');
  write('.gitignore','_evidence/\n');
  const pkg={name:'fixture',publisher:'fixture',version:'1.0.0'};write('package.json',pkg);
  for(const name of ['package-lock.json','admin/package-lock.json','ops/package-lock.json','website/package-lock.json'])write(name,{fixture:name});
  for(const name of ['CHANGELOG.md','LICENSE','README.md','dist/webview.css','media/coop-icon.png','media/coop-icon.svg'])write(name,'fixture');
  for(const name of ['dist/extension.js','dist/webview.js'])write(name,'const fixture = 1;');
  g(['init','--initial-branch=fixture']);g(['config','user.name','Fixture']);g(['config','user.email','fixture@example.invalid']);g(['remote','add','origin','https://github.com/fixture/repo.git']);g(['add','.']);g(['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-m','synthetic source']);
  const corpus=path.join(data,'candidate');fs.mkdirSync(corpus);const candidateFiles=g(['ls-files','-z']).split('\0').filter(Boolean).map(name=>{const file=path.join(corpus,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,name),file);return {path:file,sha256:sha(file)};});
  const tool=write('_evidence/gitleaks',`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]==='version'){console.log('8.30.1');process.exit(0);}const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--report-path')+1],'[]');`);fs.chmodSync(tool,0o700);
  const config=write('_evidence/scanner.toml','[extend]\nuseDefault = true\n'),scanner=write('_evidence/trivy','synthetic pinned tool'),audit=write('_evidence/audit.json',cleanAudit());
  const archive=path.join(data,'fixture.vsix'),unpacked=path.join(data,'unpacked');
  const zipped=spawnSync('python3',['-c',`import pathlib,zipfile,sys\nr=pathlib.Path(sys.argv[1]);z=zipfile.ZipFile(sys.argv[2],'w');z.writestr('extension.vsixmanifest','<PackageManifest><Identity Id="fixture" Publisher="fixture" Version="1.0.0"/></PackageManifest>');z.writestr('[Content_Types].xml','<Types/>')\nfor name,source in {'changelog.md':'CHANGELOG.md','LICENSE.txt':'LICENSE','readme.md':'README.md','package.json':'package.json','dist/extension.js':'dist/extension.js','dist/webview.css':'dist/webview.css','dist/webview.js':'dist/webview.js','media/coop-icon.png':'media/coop-icon.png','media/coop-icon.svg':'media/coop-icon.svg'}.items():z.writestr('extension/'+name,(r/source).read_bytes())\nz.close();zipfile.ZipFile(sys.argv[2]).extractall(sys.argv[3])`,root,archive,unpacked],{encoding:'utf8',timeout:10000});assert.equal(zipped.status,0,zipped.stderr);
  const list=folder=>{const files=[];for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())files.push(...list(file));else files.push({path:file,sha256:sha(file)});}return files;};
  const dbs=[1,2].map(n=>{const file=write('_evidence/db'+n,'fixture database'+n),metadataPath=write('_evidence/db'+n+'.json',{NextUpdate:'2099-01-01T00:00:00Z'});return {path:file,sha256:sha(file),metadataPath,metadataSha256:sha(metadataPath),nextUpdate:'2099-01-01T00:00:00Z'};});
  const javaDir=path.join(data,'jars');fs.mkdirSync(javaDir);const resource=write('_evidence/jars/one.jar','synthetic resource');
  const inventoryPath=write('_evidence/java-inventory.json',{components:[{resource:'one.jar',sha256:sha(resource)}]}),javaReport=write('_evidence/java.json',{Results:[{Type:'jar',Packages:[{Name:'fixture:one',Version:'1',FilePath:'one.jar',AnalyzedBy:'jar'}]}]});
  const inputs={gitleaks:{path:tool,sha256:sha(tool)},gitleaksConfig:{path:config,sha256:sha(config)},auditReceipts:[],secrets:{candidate:{target:corpus,files:candidateFiles},history:{target:root,files:[{path:path.join(root,'.git/HEAD'),sha256:sha(path.join(root,'.git/HEAD'))}]},package:{target:unpacked,files:list(unpacked),artifact:{path:archive,sha256:sha(archive)}}},images:[],javaReceipt:{scannerVersion:'0.72.0',scannerPath:scanner,scannerSha256:sha(scanner),directory:javaDir,inventoryPath,inventorySha256:sha(inventoryPath),reportPath:javaReport,reportSha256:sha(javaReport),databases:dbs}};
  for(const area of ['root','admin','ops','website'])for(const kind of ['full','production'])inputs.auditReceipts.push({area,kind,node:'22.23.3',npm:'10.9.9',exitCode:0,scannedAt:new Date().toISOString(),lockSha256:sha(path.join(root,area==='root'?'package-lock.json':area+'/package-lock.json')),reportPath:audit,reportSha256:sha(audit)});
  const imagePath=write('_evidence/image.json',{ArtifactType:'container_image',Metadata:{ImageID:'sha256:'+'a'.repeat(64)},Results:['debian','node-pkg','gobinary'].map(Type=>({Type,Target:Type,Packages:[{Name:'fixture',Version:'1'}]}))});
  for(const role of ['api','worker'])inputs.images.push({role,artifactId:'sha256:'+'a'.repeat(64),requiredTypes:['debian','node-pkg','gobinary'],scannerVersion:'0.72.0',scannerPath:scanner,scannerSha256:sha(scanner),reportPath:imagePath,reportSha256:sha(imagePath),scannedAt:new Date().toISOString(),databases:dbs,inputs:canonicalInputBindings(imageSourceInputs(root),root)});
  const context=securitySourceContext(root,'refs/heads/fixture'),policy=govPolicy();
  const codeql={...externalObservation('codeql'),...context,payload:{analyses:[{commit_sha:context.commit,ref:context.ref,tool:{name:'CodeQL'},error:'',results_count:0,rules_count:1}],alerts:[]}},gov={...externalObservation('governance'),...context};
  const bind=(name,value)=>{const file=write('_evidence/'+name,value);return {path:file,sha256:sha(file)};};
  inputs.external={ref:context.ref,policy:bind('policy.json',policy),codeql:bind('codeql.json',{pass:true,observation:codeql}),governance:bind('governance.json',gov)};
  const run=()=>{const directory=fs.mkdtempSync(path.join(data,'result-'));return runSecurity({root,inputs,evidenceDirectory:directory});};
  const good=run();assert.equal(good.pass,true,JSON.stringify(good));assert.equal(good.localPass,true);assert.deepEqual(good.externalRequirements,[]);
  const inputFile=write('_evidence/inputs.json',inputs);const cli=spawnSync(process.execPath,[path.resolve('scripts/release-security.mjs')],{cwd:root,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,COOP_RELEASE_SECURITY_INPUTS:inputFile}});assert.equal(cli.status,0,cli.stderr+cli.stdout);const output=/Security evidence: (.*)/.exec(cli.stdout)?.[1];assert.ok(output);try{assert.equal(JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8')).pass,true);}finally{fs.rmSync(output,{recursive:true,force:true});}
  const original=inputs.external.governance.sha256;inputs.external.governance.sha256='0'.repeat(64);assert.equal(run().pass,false);inputs.external.governance.sha256=original;
  const files=inputs.secrets.candidate.files;inputs.secrets.candidate.files=files.slice(1);assert.equal(run().pass,false);inputs.secrets.candidate.files=files;
  const imageInputs=inputs.images[0].inputs;inputs.images[0].inputs=imageInputs.slice(1);assert.equal(run().pass,false);inputs.images[0].inputs=imageInputs;
  const artifact=inputs.secrets.package.artifact;delete inputs.secrets.package.artifact;assert.equal(run().pass,false);inputs.secrets.package.artifact=artifact;
  write('_evidence/java.json',{Results:[{Type:'jar',Packages:[{Name:'fixture:one',Version:'1',FilePath:'one.jar',AnalyzedBy:'jar'}],Vulnerabilities:[{Severity:'HIGH',VulnerabilityID:'CVE-fixture'}]}]});inputs.javaReceipt.reportSha256=sha(javaReport);assert.equal(run().pass,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

const javaPins=JSON.parse(fs.readFileSync(new URL('./indexer-tools/scip-java.json',import.meta.url),'utf8'));
function producerInventory(){
 const resource=`scip-shared-${javaPins.releaseVersion}.jar`,component={resource,origin:`lib/${resource}`,sha256:'a'.repeat(64),bytes:100,producerSource:{project:'scip-shared',classCount:2}};
 return {components:[component,...inventory.components],buildProvenance:{schema:'coop-scip-java-build-v1',inputs:javaPins,files:[{path:component.origin,sha256:component.sha256}],resources:[component,...inventory.components],sourceOnlyResources:[component]}};
}
test('producer source coverage requires exact pinned build proof; never invent advisory coordinates',()=>{
 const i=producerInventory(),r=report(),good=validateJavaArchiveReport(r,i);assert.equal(good.pass,true);assert.equal(good.producerSourceResources,1);assert.equal(good.coveredResources,3);
 for(const mutate of [x=>x.buildProvenance.inputs.sourceCommit='0'.repeat(40),x=>x.components[0].sha256='b'.repeat(64),x=>x.components[0].producerSource.project='unknown',x=>x.components[0].producerSource.classCount=0,x=>delete x.buildProvenance,x=>x.buildProvenance.sourceOnlyResources=[]]){
  const bad=structuredClone(i);mutate(bad);assert.equal(validateJavaArchiveReport(r,bad).pass,false);
 }
});
test('producer coverage rejects corpus omissions and never exempts third-party gaps or severe findings',()=>{
 const i=producerInventory();for(const remove of [0,1]){const bad=structuredClone(i);bad.components.splice(remove,1);assert.equal(validateJavaArchiveReport(report(),bad).pass,false);}
 const missing=report();missing.Results[0].Packages.pop();assert.equal(validateJavaArchiveReport(missing,i).pass,false);
 const severe=report();severe.Results[0].Vulnerabilities=[{Severity:'HIGH',VulnerabilityID:'CVE-fixture'}];assert.equal(validateJavaArchiveReport(severe,i).pass,false);
});

test('malformed producer proof fails closed and cannot remove source classification',()=>{
 for(const mutate of [x=>x.buildProvenance.files={},x=>x.buildProvenance.sourceOnlyResources={},x=>x.buildProvenance.files.push(x.buildProvenance.files[0]),x=>x.buildProvenance.files[0].path='../escape']){const bad=producerInventory();mutate(bad);assert.equal(validateJavaArchiveReport(report(),bad).pass,false);}
 const stripped=producerInventory();delete stripped.components[0].producerSource;assert.equal(validateJavaArchiveReport(report(),stripped).pass,false);
});
test('image archive identity uses exact configuration bytes and rejects wrong digests or ambiguous archives',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-image-archive-'));
 try{
  const archive=path.join(d,'image.tar'),config={os:'linux',architecture:'amd64',rootfs:{type:'layers',diff_ids:[]}},bytes=JSON.stringify(config),identity=createHash('sha256').update(bytes).digest('hex');
  const script=`import io,json,tarfile,sys
b=sys.argv[2].encode();name=('0'*64 if sys.argv[4]=='digest' else sys.argv[3])+'.json'
manifest=[{'Config':name,'Layers':[]}]*(2 if sys.argv[4]=='multiple' else 1)
with tarfile.open(sys.argv[1],'w') as t:
 for name,data in [(name,b),('manifest.json',json.dumps(manifest).encode())]:
  i=tarfile.TarInfo(name);i.size=len(data);t.addfile(i,io.BytesIO(data))
`;
  for(const fault of ['none','digest','multiple']){
   const r=spawnSync('python3',['-c',script,archive,bytes,identity,fault],{encoding:'utf8'});assert.equal(r.status,0);
   if(fault==='none'){assert.equal(imageIdentityFromArchive(archive),'sha256:'+identity);assert.equal(imageIdentityFromArchive(archive,'linux/amd64'),'sha256:'+identity);assert.throws(()=>imageIdentityFromArchive(archive,'linux/arm64'));}else assert.throws(()=>imageIdentityFromArchive(archive));
  }
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('canonical source bindings move between roots but retain namespace/content and path safety',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-portable-inputs-'));
 try{
  const roots=['a','b'].map(name=>{const dir=path.join(d,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'source.txt'),'same source');return dir;});
  const files=root=>[{path:'source.txt',sha256:sha(path.join(root,'source.txt'))}];
  assert.deepEqual(canonicalInputBindings(files(roots[0]),roots[0]),canonicalInputBindings(files(roots[1]),roots[1]));
  assert.deepEqual(canonicalInputBindings(files(roots[0]),roots[0]),canonicalInputBindings(files(roots[0]),fs.realpathSync(roots[0])));
  assert.throws(()=>canonicalInputBindings([{path:'source.txt',sha256:'0'.repeat(64)}],roots[0]));
  assert.throws(()=>canonicalInputBindings([{path:'../b/source.txt',sha256:files(roots[0])[0].sha256}],roots[0]));
  assert.throws(()=>canonicalInputBindings([{path:path.join(roots[1],'source.txt'),sha256:files(roots[0])[0].sha256}],roots[0]));
  assert.throws(()=>canonicalInputBindings([...files(roots[0]),...files(roots[0])],roots[0]));
  fs.symlinkSync(path.join(roots[0],'source.txt'),path.join(roots[0],'link.txt'));assert.throws(()=>canonicalInputBindings([{path:'link.txt',sha256:files(roots[0])[0].sha256}],roots[0]));
  fs.unlinkSync(path.join(roots[1],'source.txt'));assert.throws(()=>canonicalInputBindings(files(roots[0]),roots[1]));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('secret finding scopes and exact synthetic approval transfer across corpus roots; extras and unsafe findings deny',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-portable-secret-'));
 try{
  const tool=path.join(d,'scanner');fs.writeFileSync(tool,`#!${process.execPath}
const fs=require('fs'),args=process.argv.slice(2);if(args[0]==='version'){console.log('8.30.1');process.exit(0)};
const target=args.at(-1);fs.writeFileSync(args[args.indexOf('--report-path')+1],JSON.stringify([{Secret:'REDACTED',RuleID:'synthetic-rule',File:target+'/source.txt',StartLine:1,EndLine:1,Commit:''}]));process.exit(1);
`,{mode:0o700});const config=path.join(d,'config');fs.writeFileSync(config,'[extend]\nuseDefault = true\n');
  const roots=['a','b'].map(name=>{const dir=path.join(d,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'source.txt'),'synthetic fixture');return dir;});
  const run=(root,exceptions=[])=>scanSecrets({scope:'candidate',target:root,files:[{path:path.join(root,'source.txt'),sha256:sha(path.join(root,'source.txt'))}],tool:{path:tool,sha256:sha(tool)},config:{path:config,sha256:sha(config)},evidenceDirectory:d,exceptions});
  const first=run(roots[0]);assert.equal(first.scannerExecuted,true);assert.equal(first.findings,1);assert.equal(first.unaccepted[0].file,'source.txt');
  const approval={findingSha256:first.unaccepted[0].findingSha256,scopeSha256:first.scopeSha256,approved:true,owner:'synthetic-owner',approvalReference:'synthetic-only-control',reason:'synthetic fixture',expiresAt:'2099-01-01T00:00:00Z'};
  const moved=run(roots[1],[approval]);assert.equal(moved.scopeSha256,first.scopeSha256);assert.equal(moved.pass,true);
  assert.equal(run(roots[1],[{...approval,scopeSha256:'0'.repeat(64)}]).pass,false);
  fs.writeFileSync(path.join(roots[1],'extra.txt'),'extra');const extra=run(roots[1],[approval]);assert.equal(extra.pass,false);assert.equal(extra.scannerExecuted,false);fs.unlinkSync(path.join(roots[1],'extra.txt'));
  fs.writeFileSync(path.join(roots[1],'source.txt'),'changed source');assert.equal(run(roots[1],[approval]).pass,false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('frozen image scope transfers between source roots but changed image/report/database/source cannot inherit approval',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'coop-portable-image-')),now=Date.parse('2026-10-13T00:00:00Z');
 try{
  const write=(name,value)=>{const p=path.join(d,name);fs.writeFileSync(p,value);return p;};
  const report=imageReport();report.Results[0].Vulnerabilities=[{VulnerabilityID:'CVE-synthetic',PkgName:'fixture',InstalledVersion:'1',Severity:'HIGH'}];
  const reportPath=write('report',JSON.stringify(report)),scannerPath=write('scanner','synthetic scanner'),db=write('db','synthetic db'),metadataPath=write('metadata',JSON.stringify({NextUpdate:'2099-01-01T00:00:00Z'}));
  const roots=['a','b'].map(name=>{const p=path.join(d,name);fs.mkdirSync(p);fs.writeFileSync(path.join(p,'source'),'same source');return p;});
  const receipt={role:'api',artifactId:report.Metadata.ImageID,requiredTypes:['debian','node-pkg'],scannerVersion:'0.72.0',scannerPath,scannerSha256:sha(scannerPath),reportPath,reportSha256:sha(reportPath),scannedAt:'2026-10-12T23:00:00Z',inputs:[{path:'source',sha256:sha(path.join(roots[0],'source'))}],databases:[{path:db,sha256:sha(db),metadataPath,metadataSha256:sha(metadataPath),nextUpdate:'2099-01-01T00:00:00Z'}]};
  const first=checkImageReceipt(receipt,{root:roots[0],now});assert.equal(first.unaccepted.length,1);
  const approval={findingSha256:first.unaccepted[0].findingSha256,scopeSha256:first.scopeSha256,approved:true,owner:'synthetic-owner',approvalReference:'synthetic-only-control',reason:'synthetic fixture',expiresAt:'2099-01-01T00:00:00Z'};
  const moved=checkImageReceipt(receipt,{root:roots[1],now,exceptions:[approval]});assert.equal(moved.pass,true);assert.equal(moved.scopeSha256,first.scopeSha256);
  assert.equal(checkImageReceipt({...receipt,artifactId:'sha256:'+'b'.repeat(64)},{root:roots[1],now,exceptions:[approval]}).pass,false);
  fs.writeFileSync(db,'changed db');assert.equal(checkImageReceipt(receipt,{root:roots[1],now,exceptions:[approval]}).pass,false);fs.writeFileSync(db,'synthetic db');
  fs.writeFileSync(reportPath,'{}');assert.equal(checkImageReceipt(receipt,{root:roots[1],now,exceptions:[approval]}).pass,false);fs.writeFileSync(reportPath,JSON.stringify(report));
  fs.writeFileSync(path.join(roots[1],'source'),'changed source');assert.equal(checkImageReceipt(receipt,{root:roots[1],now,exceptions:[approval]}).pass,false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});


function frozenFixture(base) {
 const root=path.join(base,'source'),directory=path.join(base,'bundle');fs.mkdirSync(root);fs.mkdirSync(directory);
 for(const name of ['src','migrations','scripts/indexer-tools']){fs.mkdirSync(path.join(root,name),{recursive:true});fs.writeFileSync(path.join(root,name,'fixture'),'same synthetic input');}
 for(const name of ['Dockerfile','.dockerignore','package.json','package-lock.json','tsconfig.backend.json','scripts/admin-org.ts','scripts/run-migrations.mjs','scripts/runtime-entrypoint'])fs.writeFileSync(path.join(root,name),'synthetic input');
 const archive=path.join(directory,'image.tar'),bytes=JSON.stringify({os:'linux',architecture:'amd64',rootfs:{type:'layers',diff_ids:[]}}),configurationId='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const program=`import io,json,tarfile,sys
b=sys.argv[2].encode();name=sys.argv[3]+'.json'
with tarfile.open(sys.argv[1],'w') as t:
 for n,data in [(name,b),('manifest.json',json.dumps([{'Config':name,'Layers':[]}]).encode())]:
  item=tarfile.TarInfo(n);item.size=len(data);t.addfile(item,io.BytesIO(data))
`;
 const built=spawnSync('python3',['-c',program,archive,bytes,configurationId.slice(7)],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const context={repository:'synthetic/product',commit:'a'.repeat(40)},now=Date.now(),image={role:'api',runId:1,artifactId:2,artifactDigest:'sha256:'+'c'.repeat(64),configurationId,archiveSha256:sha(archive),archiveBytes:fs.statSync(archive).size,platform:'linux/amd64',custodyCommit:'d'.repeat(40)},policy={schema:'coop-frozen-image-import-v1',approved:true,owner:'synthetic control',approvalReference:'synthetic-only',expiresAt:new Date(now+3600000).toISOString(),sourceRepository:context.repository,candidateCommit:context.commit,custodyRepository:'synthetic/private-custody',inputsSha256:hashValue({schema:'coop-input-binding-v2',files:canonicalInputBindings(imageSourceInputs(root),root)}),images:[image,{...image,role:'worker',artifactId:3}]},repository={full_name:policy.custodyRepository,private:true},artifact={id:image.artifactId,expired:false,digest:image.artifactDigest,expires_at:new Date(now+7200000).toISOString(),workflow_run:{id:image.runId,head_sha:image.custodyCommit}};
 return {root,directory,archive,context,now,policy,repository,artifact};
}
test('frozen import requires exact approved private immutable custody and current image source; metadata drift denies',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'coop-frozen-custody-'));
 try{
  const f=frozenFixture(base),run=(p=f.policy,extra={})=>validateFrozenImageCustody(p,{...f,role:'api',...extra});assert.equal(run().pass,true);
  for(const mutate of [p=>p.approved=false,p=>p.owner='',p=>p.approvalReference='',p=>p.expiresAt=new Date(f.now-1).toISOString(),p=>p.candidateCommit='b'.repeat(40),p=>p.sourceRepository='other/source',p=>p.inputsSha256='b'.repeat(64),p=>p.custodyRepository=f.context.repository,p=>p.images.pop(),p=>p.images[0].artifactId=0,p=>p.images[0].platform='linux/arm64']){const p=structuredClone(f.policy);mutate(p);assert.throws(()=>run(p));}
  for(const change of [{repository:{...f.repository,private:false}},{repository:{...f.repository,full_name:'other/custody'}},{artifact:{...f.artifact,id:99}},{artifact:{...f.artifact,expired:true}},{artifact:{...f.artifact,digest:'sha256:'+'e'.repeat(64)}},{artifact:{...f.artifact,workflow_run:{id:99,head_sha:'d'.repeat(40)}}},{artifact:{...f.artifact,workflow_run:{id:1,head_sha:'e'.repeat(40)}}},{artifact:{...f.artifact,expires_at:new Date(f.now+1).toISOString()}}])assert.throws(()=>run(f.policy,change));
  fs.writeFileSync(path.join(f.root,'src/fixture'),'changed');assert.throws(()=>run());
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('frozen import verifies unchanged archive/configuration and rejects extras, symlinks and changed bytes',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'coop-frozen-archive-'));
 try{
  const f=frozenFixture(base),run=(p=f.policy)=>verifyFrozenImageArchive(p,{...f,role:'api'});assert.equal(run().pass,true);
  const wrong=structuredClone(f.policy);wrong.images[0].configurationId='sha256:'+'f'.repeat(64);assert.throws(()=>run(wrong));
  fs.writeFileSync(path.join(f.directory,'extra'),'unexpected');assert.throws(()=>run());fs.unlinkSync(path.join(f.directory,'extra'));
  const original=fs.readFileSync(f.archive);fs.unlinkSync(f.archive);fs.symlinkSync(path.join(base,'original.tar'),f.archive);fs.writeFileSync(path.join(base,'original.tar'),original);assert.throws(()=>run());fs.unlinkSync(f.archive);fs.writeFileSync(f.archive,original);
  fs.appendFileSync(f.archive,'changed');assert.throws(()=>run());
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('actual frozen CLI denies inactive approval before metadata reads and verifies private download through archive import',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'coop-frozen-cli-'));
 try{
  const f=frozenFixture(base),runner=path.join(base,'runner'),bin=path.join(base,'bin');fs.mkdirSync(runner);fs.mkdirSync(bin);fs.renameSync(f.directory,path.join(runner,'frozen-image'));
  fs.mkdirSync(path.join(f.root,'.github/workflows'),{recursive:true});fs.writeFileSync(path.join(f.root,'.github/workflows/ci.yml'),'synthetic workflow');fs.writeFileSync(path.join(f.root,'scripts/release-security.mjs'),'synthetic owner');
  const git=args=>{const r=spawnSync('git',['-C',f.root,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Synthetic',GIT_AUTHOR_EMAIL:'synthetic@example.invalid',GIT_COMMITTER_NAME:'Synthetic',GIT_COMMITTER_EMAIL:'synthetic@example.invalid'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(['init']);git(['add','.']);git(['commit','-m','Synthetic disposable frozen fixture']);git(['remote','add','origin','https://github.com/synthetic/product']);f.policy.candidateCommit=git(['rev-parse','HEAD']);
  const metadata=path.join(base,'metadata.json'),calls=path.join(base,'reads.log');fs.writeFileSync(metadata,JSON.stringify({repository:f.repository,artifact:f.artifact}));fs.writeFileSync(path.join(bin,'gh'),`#!${process.execPath}\nconst fs=require('fs');fs.appendFileSync(process.env.SYNTHETIC_READS,'read\\n');const m=JSON.parse(fs.readFileSync(process.env.SYNTHETIC_METADATA));console.log(JSON.stringify(process.argv.at(-1).includes('/actions/artifacts/')?m.artifact:m.repository));\n`);fs.chmodSync(path.join(bin,'gh'),0o700);
  const scanner=path.join(base,'scanner'),reportPath=path.join(base,'report.json'),imageInputs=path.join(base,'image-inputs.json'),cache=path.join(base,'cache');fs.writeFileSync(scanner,'synthetic scanner');const scan=imageReport();scan.Metadata.ImageID=f.policy.images[0].configurationId;fs.writeFileSync(reportPath,JSON.stringify(scan));fs.writeFileSync(imageInputs,JSON.stringify(canonicalInputBindings(imageSourceInputs(f.root),f.root)));
  for(const name of ['db/trivy.db','java-db/trivy-java.db']){const file=path.join(cache,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic database');fs.writeFileSync(path.join(path.dirname(file),'metadata.json'),JSON.stringify({NextUpdate:new Date(f.now+7200000).toISOString()}));}
  let evidenceIndex=0;
  const run=(mode,policy=f.policy)=>spawnSync(process.execPath,[path.resolve('scripts/release-security.mjs'),mode],{cwd:f.root,encoding:'utf8',timeout:10000,env:{PATH:bin+path.delimiter+process.env.PATH,GH_TOKEN:'synthetic-unusable',GITHUB_ACTIONS:'true',GITHUB_SHA:f.policy.candidateCommit,GITHUB_REPOSITORY:'synthetic/product',GITHUB_REF:'refs/heads/main',RUNNER_TEMP:runner,GITHUB_OUTPUT:path.join(runner,'outputs'),COOP_RELEASE_IMAGE_ROLE:'api',COOP_RELEASE_FROZEN_IMAGE_POLICY:JSON.stringify(policy),SYNTHETIC_READS:calls,SYNTHETIC_METADATA:metadata,COOP_RELEASE_EVIDENCE_DIR:path.join(base,'evidence-'+evidenceIndex++),COOP_RELEASE_IMAGE_REPORT:reportPath,COOP_RELEASE_IMAGE_INPUTS:imageInputs,COOP_RELEASE_IMAGE_ID:f.policy.images[0].configurationId,TRIVY_BIN:scanner,TRIVY_CACHE_DIR:cache,COOP_RELEASE_TRIVY_SHA256:sha(scanner)}});
  assert.notEqual(run('--frozen-image-source',{...f.policy,approved:false}).status,0);assert.equal(fs.existsSync(calls),false);
  const prepared=run('--frozen-image-source');assert.equal(prepared.status,0,prepared.stderr);assert.equal(fs.readFileSync(calls,'utf8').trim().split('\n').length,2);assert.match(fs.readFileSync(path.join(runner,'outputs'),'utf8'),/artifact-id=2/);
  const imported=run('--frozen-image-import');assert.equal(imported.status,0,imported.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(runner,'frozen-image-import-api.json'))).pass,true);
  const checked=run('--image-report');assert.equal(checked.status,0,checked.stderr+fs.readFileSync(path.join(base,'evidence-'+(evidenceIndex-1),'image/result.json'),'utf8'));const record=JSON.parse(fs.readFileSync(path.join(base,'evidence-'+(evidenceIndex-1),'image/result.json')));assert.equal(record.pass,true);assert.deepEqual(Object.keys(record.frozenImport).sort(),['pass','archiveSha256','configurationId','inputsSha256','policySha256'].sort());assert.equal(JSON.stringify(record).includes(f.policy.custodyRepository),false);
  fs.appendFileSync(path.join(runner,'frozen-image/image.tar'),'tampered');assert.notEqual(run('--frozen-image-import').status,0);assert.notEqual(run('--image-report').status,0);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('image source binding includes runtime entrypoint and Docker exclusions; drift or missing input refuses reuse',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coop-image-launch-binding-'));
 try{
  for(const folder of ['src','migrations','scripts/indexer-tools'])fs.mkdirSync(path.join(root,folder),{recursive:true});
  for(const name of ['Dockerfile','.dockerignore','package.json','package-lock.json','tsconfig.backend.json','scripts/admin-org.ts','scripts/run-migrations.mjs','scripts/runtime-entrypoint'])fs.writeFileSync(path.join(root,name),'fixture');
  const bound=()=>canonicalInputBindings(imageSourceInputs(root),root);
  const original=bound();
  for(const name of ['.dockerignore','scripts/runtime-entrypoint']){
   assert.ok(original.some(input=>input.path===name));
   fs.writeFileSync(path.join(root,name),'changed');assert.notDeepEqual(bound(),original);
   assert.throws(()=>canonicalInputBindings(original,root),/identity mismatch/);
   fs.writeFileSync(path.join(root,name),'fixture');assert.deepEqual(bound(),original);
   fs.unlinkSync(path.join(root,name));assert.throws(bound,/ENOENT/);fs.writeFileSync(path.join(root,name),'fixture');
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

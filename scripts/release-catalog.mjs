import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DATABASE_SUITES} from './enterprise-database-suites.mjs';

export const SUPPLEMENTAL_SCRIPT_GROUPS=['test:status-transition','test:email-template-grounding','test:existing-capability','test:request-batcher','test:project-instructions','test:fim','test:repo-grants-ui'];

export function privatePackageSourceApproved({approvedSha,checkoutSha,checkoutTree,parents,approvedTree}) {
 const sha=/^[a-f0-9]{40}$/;
 if(!sha.test(approvedSha??'')||!sha.test(checkoutSha??'')||!sha.test(checkoutTree??'')||!Array.isArray(parents)||parents.some(value=>!sha.test(value)))return false;
 if(checkoutSha===approvedSha)return true;
 return parents.length===2&&parents[1]===approvedSha&&checkoutTree===approvedTree&&sha.test(approvedTree??'');
}

// Split shell AND only outside quotes/parentheses; grouped cwd changes stay owned.
export function splitAnd(value) {
  const parts=[];let start=0,quote=null,depth=0;
  for(let i=0;i<value.length;i++) {
    const ch=value[i];
    if(ch==='\\' && quote!=="'") {i++;continue;}
    if(quote) {if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='(')depth++;if(ch===')')depth--;
    if(depth<0)throw new Error('Unbalanced script group');
    if(depth===0&&ch==='&'&&value[i+1]==='&'){parts.push(value.slice(start,i).trim());start=i+2;i++;}
  }
  if(quote||depth)throw new Error('Unbalanced script');
  parts.push(value.slice(start).trim());return parts.filter(Boolean);
}
export function expandScripts(scripts,names) {
  const leaves=new Map();
  function visit(name,parents=[]) {
    if(parents.includes(name)||!Object.hasOwn(scripts,name))throw new Error('Missing or cyclic release script: '+name);
    const commands=splitAnd(scripts[name]);
    // npm owns a script's shell/cwd; keep directory changes with their children.
    const scoped=commands.some(command=>/^cd(?:\s|$)/.test(command))?['('+scripts[name]+')']:commands;
    for(const command of scoped) {
      const nested=/^npm run ([\w:-]+)$/.exec(command);
      if(nested)visit(nested[1],[...parents,name]);
      else {const prior=leaves.get(command);if(prior)prior.groups.push(name);else leaves.set(command,{command,groups:[name]});}
    }
  }
  for(const name of names)visit(name);return [...leaves.values()];
}
export function releaseCatalog(root=process.cwd()) {
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const unit=expandScripts(pkg.scripts,['test:ci','test:agent-ship:a','test:codegen','test:enterprise-unit']);
  // Builds are performed once in their own lane. Database behavior has separate
  // required fixture lanes; no unit lane is allowed to quietly execute/skip it.
  const tests=unit.filter(entry=>!entry.command.includes('.integration.')&&!/^(?:esbuild |npm run build|node scripts\/run-.*database)/.test(entry.command));
  const supplemental=expandScripts(pkg.scripts,SUPPLEMENTAL_SCRIPT_GROUPS);
  supplemental.push({command:'node --require ./scripts/vscode-test-stub.cjs --import tsx --test scripts/enterprise-eval.test.ts',groups:['enterprise-eval-contract']},{command:'node --test scripts/dogfood-release.test.mjs',groups:['dogfood-release-contract']});
  const contextEvidenceControls=[
  "src/context/countFilesViaDirectoryWalk.test.ts",
  "src/context/outsideWorkspaceFile.test.ts",
  "src/context/quickActionScope.test.ts",
  "src/context/contextScope.test.ts",
  "src/context/contextBundleEvidence.test.ts",
  "src/context/knowledgeGapTreePaths.test.ts",
  "src/context/intentDetector.requestTypes.test.ts",
  "src/context/teamsContext.test.ts",
  "src/context/incidentIntent.test.ts",
  "src/context/evidenceStaleness.test.ts",
  "src/context/integrationFetchPolicy.test.ts",
  "src/context/integrationActivityLabels.test.ts",
  "src/context/notionContext.test.ts",
  "src/context/repoFilePath.test.ts",
  "src/context/fileChipIdentity.test.ts",
  "src/context/evidenceBodyPreview.test.ts",
  "src/context/repoContextMerge.test.ts",
  "src/context/openTabFileContext.test.ts",
  "src/context/editorFileContext.test.ts",
  "src/context/integrationSearchTerms.test.ts",
  "src/context/fetchIntegrationsAllowlist.test.ts",
  "src/context/contextPreviewSummary.test.ts",
  "src/context/sessionMode.test.ts",
  "src/context/googleDocsContext.test.ts",
  "src/context/projectInstructionsLoader.test.ts",
  "src/context/intentIntegrationEnrichment.test.ts",
  "src/context/fileHistoryIntent.test.ts",
  "src/context/traceDecisionSearch.test.ts",
  "src/context/integrationEvidenceVisibility.test.ts",
  "src/context/newWindowContext.test.ts"
];
  supplemental.push(...contextEvidenceControls.map(file=>({command:`node --require ./scripts/vscode-test-stub.cjs --import tsx ${file}`,groups:['supplemental-context-evidence']})));
  const contextChatPromptControls=[
  "src/context/activeEditorIdentity.test.ts",
  "src/context/dualRepoCompare.test.ts",
  "src/context/jobSearchPlan.test.ts",
  "src/context/localFileContext.test.ts",
  "src/context/slackContext.test.ts",
  "src/workspace/turnEvidenceIsolation.test.ts",
  "src/workspace/zeroClonePolicy.test.ts",
  "src/chat/cancellationRouting.test.ts",
  "src/chat/fileAskActivity.test.ts",
  "src/chat/fileAssistantAnswer.test.ts",
  "src/chat/mentionSearchMerge.test.ts",
  "src/chat/openFileSelectionChange.test.ts",
  "src/chat/paperclipAttachments.test.ts",
  "src/chat/plainChatExplain.test.ts",
  "src/chat/planUpgradePoll.test.ts",
  "src/chat/quickActionIntegrationRouting.test.ts",
  "src/chat/quotaNotice.test.ts",
  "src/chat/sessionLifecycle.test.ts",
  "src/chat/settingsScreens.test.ts",
  "src/chat/timezone.test.ts",
  "src/prompts/blastRadiusSourceLabels.test.ts",
  "src/prompts/evidenceSynthesis.test.ts",
  "src/prompts/incidentReconstruction.test.ts",
  "src/prompts/integrationDocsCompactEnrichment.test.ts",
  "src/prompts/integrationSynthesis.test.ts",
  "src/prompts/knowledgeGapsSourceLabels.test.ts",
  "src/prompts/mentionResponseEnrichment.test.ts",
  "src/prompts/plainChatCallerEnrichment.test.ts",
  "src/prompts/sourceCitationRegistry.test.ts",
  "src/prompts/sourcesFooterEnrichment.test.ts"
];
  supplemental.push(...contextChatPromptControls.map(file=>({command:`node --require ./scripts/vscode-test-stub.cjs --import tsx ${file}`,groups:['supplemental-context-chat-prompt']})));
  const browserIndexControls=[
  "src/config/modelCreditWeights.test.ts",
  "src/config/publicUrls.test.ts",
  "src/extension/launchConfiguration.test.ts",
  "src/identity/identityAutoSeed.test.ts",
  "src/identity/identityDirectory.test.ts",
  "src/license/planSearchScope.test.ts",
  "src/manifest/scoreManifest.test.ts",
  "src/integrationScope/teamsQuery.test.ts",
  "src/indexing/importGraphExtractor.test.ts",
  "src/indexing/mentionPathSearch.test.ts",
  "src/indexing/repoDependencyEdgesStore.test.ts",
  "src/indexing/searchProvenance.test.ts",
  "src/indexing/verifyRepoBrowse.test.ts",
  "src/webview/EvidenceCardShell.test.ts",
  "src/webview/EvidenceRichDetail.test.ts",
  "src/webview/agentNarrative.test.ts",
  "src/webview/chatInlineThinking.test.ts",
  "src/webview/components/chatTimelineEntries.test.ts",
  "src/webview/components/settings/integrationStatus.test.ts",
  "src/webview/components/settings/onboardingDismiss.test.ts",
  "src/webview/evidenceCardActionHandler.test.ts",
  "src/webview/evidenceCardSummary.test.ts",
  "src/webview/evidenceCodeHostParity.test.ts",
  "src/webview/evidenceConnectionBriefs.test.ts",
  "src/webview/integrationEvidenceVisibility.test.ts",
  "src/webview/lib/chatFollowUpQueue.test.ts",
  "src/webview/lib/explorerPaths.test.ts",
  "src/webview/lib/fileMentionUtils.test.ts",
  "src/webview/lib/parseHistoryAttachments.test.ts",
  "src/webview/prNotesDiff.test.ts"
];
  supplemental.push(...browserIndexControls.map(file=>({command:`node --require ./scripts/vscode-test-stub.cjs --import tsx ${file}`,groups:['supplemental-browser-indexing']})));
  const apiJobTraceControls=[
  "src/api/agent/locateEvidence.test.ts",
  "src/api/codeHosts/bitbucketClient.test.ts",
  "src/api/codeHosts/cloudRepoFileSearchFallback.test.ts",
  "src/api/codeHosts/explorerFileTreeSearch.test.ts",
  "src/api/codeHosts/explorerSearch.test.ts",
  "src/api/codeHosts/githubClient.test.ts",
  "src/api/codeHosts/types.test.ts",
  "src/api/confluence/confluenceClient.test.ts",
  "src/api/costEstimate.test.ts",
  "src/api/googleDocs/googleDocsClient.test.ts",
  "src/api/integrations/integrationSecrets.test.ts",
  "src/api/jira/jiraClient.test.ts",
  "src/api/notion/notionClient.test.ts",
  "src/api/slack/presenceCheck.test.ts",
  "src/jobs/hydrateKnowledgeGapGraph.test.ts",
  "src/jobs/jobActivityPolicy.test.ts",
  "src/jobs/jobReuse.test.ts",
  "src/jobs/knowledgeGapDetector.test.ts",
  "src/webview/slackPresenceDisplay.test.ts",
  "src/engines/decisionFocusCommit.test.ts",
  "src/engines/traceEvidenceRelevance.test.ts",
  "src/engines/traceFileGrounding.test.ts"
];
  supplemental.push(...apiJobTraceControls.map(file=>({command:`node --require ./scripts/vscode-test-stub.cjs --import tsx ${file}`,groups:['supplemental-api-job-trace']})));
  const serverDegradationControls=[
  "src/server/teamsAppService.test.ts",
  "src/server/usageTracker.productMix.test.ts",
  "src/server/oauthCallbackRedirect.test.ts",
  "src/server/githubRelinkService.test.ts",
  "src/server/meAnalyticsApi.test.ts",
  "src/server/bitbucketAppConfig.test.ts",
  "src/server/gitlabAppConfig.test.ts",
  "src/server/githubInstallUrl.test.ts",
  "src/server/publicBaseUrl.test.ts",
  "src/server/orgApiAdminGate.test.ts",
  "src/server/userWorkspaceStore.test.ts",
  "src/server/githubAppConfig.test.ts",
  "src/server/planGates.test.ts",
  "src/server/meAuditApi.test.ts",
  "src/server/analyticsPrincipals.test.ts",
  "src/server/adminIntegrationTest.test.ts",
  "src/server/teamsAppConfig.test.ts",
  "src/server/catalogSyncService.errors.test.ts",
  "src/server/catalogSyncService.test.ts",
  "src/server/queueOrgRepoIndex.test.ts",
  "src/server/githubOAuthService.test.ts",
  "src/server/auth/authConfig.test.ts",
  "src/server/billing/adminPortalUrl.test.ts",
  "src/integrations/teamsAvailability.test.ts",
  "src/edit/editSutAttach.test.ts",
  "src/degradation/codeHostOnlineForQuickActions.test.ts",
  "src/degradation/fallbackMatrix.test.ts",
  "src/degradation/features/index.test.ts"
];
  supplemental.push(...serverDegradationControls.map(file=>({command:`node --require ./scripts/vscode-test-stub.cjs --import tsx ${file}`,groups:['supplemental-server-degradation']})));
  const build=expandScripts(pkg.scripts,['lint','build','package']);
  for(const area of ['admin','ops','website'])build.push({command:`npm run build --prefix ${area}`,groups:['portal-build']});
  build.push({command:'npm test --prefix website',groups:['website-frontmatter']});
  // Target-rejection unit controls need the compiled fixture, never its database execution.
  const jobFixtureBuild=splitAnd(pkg.scripts['test:jobs-leases']).filter(command=>command.startsWith('esbuild ')&&command.includes('--outfile=dist/tests/jobLeases.integration.test.cjs'));
  if(jobFixtureBuild.length!==1)throw new Error('Missing or ambiguous declared unit job fixture build');
  const lanes={unitPreparation:[{command:jobFixtureBuild[0],groups:['unit-fixture-preparation']}],unit:tests,supplemental,build,database:Object.keys(DATABASE_SUITES).filter(suite=>!['auth','tls','publication-extra'].includes(suite)).map(suite=>({command:`node scripts/run-enterprise-database.mjs --suite ${suite}`,suite})),
    publication:[{command:'npm run test:publication-regression',requiresSeparateAuthorization:true},{command:'node scripts/run-enterprise-database.mjs --suite publication-extra',suite:'publication-extra',requiresSeparateAuthorization:true}],
    tls:[{command:'node scripts/run-enterprise-database.mjs --suite tls',suite:'tls'}],
    auth:[{command:'node scripts/run-enterprise-database.mjs --suite auth',suite:'auth'}],
    security:[{command:'node scripts/release-security.mjs',requiredTools:['gitleaks','trivy'],registryAudit:'REQUIRED_PINNED_REGISTRY_AUDITS',staticSecurity:'REQUIRED_FINAL_CANDIDATE_CODEQL_FINDINGS',javaArchives:'REQUIRED_PINNED_ARCHIVE_SCAN_WITH_COMPLETE_RESOURCE_COVERAGE'}]};
  const inputs=['package.json','package-lock.json','admin/package.json','admin/package-lock.json','ops/package.json','ops/package-lock.json','website/package.json','website/package-lock.json','scripts/indexer-tools/go.mod','scripts/indexer-tools/go.sum','scripts/indexer-tools/package.json','scripts/indexer-tools/package-lock.json','.github/workflows/ci.yml','Dockerfile','docs/dogfood/scenarios.json','.vscode/launch.json'];
  return {schema:'coop-release-catalog-v1',node:'22.23.3',npm:'10.9.9',lanes,inputs:inputs.map(file=>({path:file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')})),qualification:'Real-provider, native UI, external security/account evidence and production remain separate required gates.'};
}
export function verifyPrivatePackage(archive,root=process.cwd()) {
 const program=`import json,pathlib,zipfile,hashlib,sys,xml.etree.ElementTree as ET
try:
 archive=pathlib.Path(sys.argv[1]);root=pathlib.Path(sys.argv[2]);expected=json.loads(sys.argv[3]);z=zipfile.ZipFile(archive);names=z.namelist()
 assert len(names)==len(set(names)) and sorted(names)==sorted(expected), 'VSIX allowlist/duplicates mismatch'
 assert z.testzip() is None, 'VSIX CRC failure'
 pkg=json.loads((root/'package.json').read_text());entries=[]
 for name in names:
  data=z.read(name)
  if name.startswith('extension/'):
   source=name[len('extension/'):];source={'readme.md':'README.md','changelog.md':'CHANGELOG.md','LICENSE.txt':'LICENSE'}.get(source,source)
   assert data==(root/source).read_bytes(), 'Packaged bytes differ from current build/source'
  entries.append({'path':name,'sha256':hashlib.sha256(data).hexdigest()})
 identity=next(x for x in ET.fromstring(z.read('extension.vsixmanifest')).iter() if x.tag.split('}')[-1]=='Identity')
 assert identity.attrib['Id']==pkg['name'] and identity.attrib['Publisher']==pkg['publisher'] and identity.attrib['Version']==pkg['version'], 'VSIX manifest identity mismatch'
 print(json.dumps({'pass':True,'artifactSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'entries':entries,'scope':'Private content/CRC/exact source bytes only; no install/publication/native or release authorization'}))
except Exception as e:
 print(json.dumps({'pass':False,'issues':[str(e)]}))`;
 const expected=['extension.vsixmanifest','[Content_Types].xml','extension/changelog.md','extension/LICENSE.txt','extension/readme.md','extension/package.json','extension/dist/extension.js','extension/dist/webview.css','extension/dist/webview.js','extension/media/coop-icon.png','extension/media/coop-icon.svg'];
 const result=spawnSync('python3',['-c',program,archive,root,JSON.stringify(expected)],{encoding:'utf8',timeout:15000,maxBuffer:5*1024*1024});
 if(result.status!==0||result.error)return {pass:false,issues:['Package content verifier unavailable/failed']};
 const report=JSON.parse(result.stdout);if(report.pass)for(const file of ['dist/extension.js','dist/webview.js']){const syntax=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8',timeout:5000});if(syntax.status!==0||syntax.error)return {pass:false,issues:['Packaged runtime syntax failed']};}return report;
}

export const REQUIRED_CI_JOBS=['regression','builds','database','code-security','container'];
export const CI_EVIDENCE_FILES={regression:['unit/result.json','unit/source-before.json','unit/source-after.json','supplemental/result.json','supplemental/source-before.json','supplemental/source-after.json'],builds:['build/result.json','build/source-before.json','build/source-after.json','sbom/manifest.json','package-content/result.json'],database:['database/result.json','database/source-before.json','database/source-after.json'],'code-security':['security/results.json','codeql/findings.json'],'container-api':['image/result.json'],'container-worker':['image/result.json','java/results.json']};
const fileSha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function validateStage5Receipts({jobs,receipts,commit}) {
 const issues=[];
 if(!/^[a-f0-9]{40}$/.test(commit??'')||!Array.isArray(receipts))return {pass:false,issues:['Missing exact candidate/evidence']};
 for(const job of REQUIRED_CI_JOBS)if(jobs?.[job]?.result!=='success')issues.push('Required job failed/skipped/canceled/missing: '+job);
 const expected=['regression','builds','database','code-security','container-api','container-worker'];
 for(const name of expected){const matches=receipts.filter(r=>r.job===name);if(matches.length!==1){issues.push('Missing or duplicate retained receipt: '+name);continue;}const r=matches[0];
  if(!Array.isArray(r.files)||JSON.stringify(r.files.map(x=>x.path).sort())!==JSON.stringify([...CI_EVIDENCE_FILES[name]].sort()))issues.push('Required evidence allowlist mismatch: '+name);
  if(r.schema!=='coop-ci-receipt-v1'||r.commit!==commit||r.pass!==true||!Array.isArray(r.files)||!r.files.length||r.files.some(f=>typeof f.path!=='string'||path.isAbsolute(f.path)||f.path.split('/').includes('..')||!/^[a-f0-9]{64}$/.test(f.sha256??''))||new Set(r.files.map(f=>f.path)).size!==r.files.length)issues.push('Invalid, failed or wrong-source receipt: '+name);
 }
 if(receipts.some(r=>!expected.includes(r.job)))issues.push('Undeclared CI receipt');
 return {pass:issues.length===0,issues,commit,qualification:'Stage5 automated evidence acceptance only. Governance, provider/native/operations and production authorization remain separate required gates.'};
}
export function writeCiReceipt(job,directory,commit) {
 const expected=CI_EVIDENCE_FILES[job];
 if(!expected)throw new Error('Unknown CI evidence owner');
 const files=[],issues=[];
 for(const file of expected){
  try{const absolute=path.join(directory,file),value=JSON.parse(fs.readFileSync(absolute,'utf8'));
   const pass=file.includes('/source-')?Array.isArray(value)&&value.length>0:file==='sbom/manifest.json'?value.tool==='npm10.9.9'&&Array.isArray(value.records)&&value.records.length===8&&new Set(value.records.map(x=>x.area+':'+x.kind)).size===8:value.pass===true;
   if(!pass)issues.push('Required evidence did not pass: '+file);
   if(file.endsWith('/result.json')&&['unit','supplemental','database','build'].includes(file.split('/')[0])&&(value.commit!==commit||value.sourceUnchanged!==true||!Array.isArray(value.results)||!value.results.length||value.results.some(x=>x.status!=='AUTOMATED_PASS')))issues.push('Lane/source qualification mismatch: '+file);
   if(file.endsWith('/source-before.json')||file.endsWith('/source-after.json'))for(const source of value)if(path.isAbsolute(source.path)||source.path.split('/').includes('..')||fileSha(source.path)!==source.sha256)issues.push('Current source drift: '+file);
   files.push({path:file,sha256:fileSha(absolute)});
  }catch{issues.push('Missing or malformed required evidence: '+file);}
 }
 fs.mkdirSync(directory,{recursive:true,mode:0o700});const receipt={schema:'coop-ci-receipt-v1',job,commit,pass:issues.length===0,issues,files};fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});return receipt;
}
function catalogMain(){
 const args=process.argv.slice(2);
 if(!args.length){console.log(JSON.stringify(releaseCatalog(),null,2));return;}
 if(args.length===1&&args[0]==='--package-content'){const result=verifyPrivatePackage(path.resolve('coop-ai.vsix')),directory=path.join(process.env.COOP_RELEASE_EVIDENCE_DIR,'package-content');fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;return;}
 if(args.length===2&&args[0]==='--ci-receipt'){
  const result=writeCiReceipt(args[1],process.env.COOP_RELEASE_EVIDENCE_DIR,process.env.GITHUB_SHA);process.exitCode=result.pass?0:1;return;
 }
 if(args.length===1&&args[0]==='--stage5-acceptance'){
  const directory=process.env.COOP_RELEASE_DOWNLOADED_EVIDENCE,receipts=[];
  for(const name of ['regression','builds','database','code-security','container-api','container-worker']){
   const folder=path.join(directory,name);const receipt=JSON.parse(fs.readFileSync(path.join(folder,'receipt.json'),'utf8'));
   for(const file of receipt.files){if(path.isAbsolute(file.path)||file.path.split('/').includes('..')||fileSha(path.join(folder,file.path))!==file.sha256)throw new Error('Downloaded evidence hash/identity mismatch');}
   receipts.push(receipt);
  }
  const result=validateStage5Receipts({jobs:JSON.parse(process.env.COOP_RELEASE_JOB_RESULTS),receipts,commit:process.env.GITHUB_SHA});fs.writeFileSync(path.join(directory,'stage5-result.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;return;
 }
 throw new Error('Use --ci-receipt named-job or --stage5-acceptance');
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)catalogMain();

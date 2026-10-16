import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

if(process.versions.node!=='22.23.3')throw new Error('SBOM requires pinned Node22.23.3');
const directory=process.env.COOP_RELEASE_EVIDENCE_DIR?path.join(process.env.COOP_RELEASE_EVIDENCE_DIR,'sbom'):fs.mkdtempSync(path.join(os.tmpdir(),'coop-sbom-'));
fs.mkdirSync(directory,{recursive:true,mode:0o700});if(fs.readdirSync(directory).length)throw new Error('SBOM evidence directory must be empty');fs.chmodSync(directory,0o700);
const npm=process.env.npm_execpath;
if(!npm||!npm.endsWith('/npm-cli.js'))throw new Error('Run npm run release:sbom with pinned npm10.9.9');
if(execFileSync(process.execPath,[npm,'--version'],{encoding:'utf8'}).trim()!=='10.9.9')throw new Error('Pinned npm10.9.9 required');
const records=[];
for(const area of ['root','admin','ops','website'])for(const kind of ['full','production']){
 const cwd=area==='root'?process.cwd():path.join(process.cwd(),area);
 const output=execFileSync(process.execPath,[npm,'sbom','--sbom-format=cyclonedx','--package-lock-only','--offline',...(kind==='production'?['--omit=dev']:[])],{cwd,encoding:'utf8',maxBuffer:20*1024*1024});
 const value=JSON.parse(output);if(value.bomFormat!=='CycloneDX'||!Array.isArray(value.components))throw new Error('Invalid SBOM output');
 const file=area+'-'+kind+'.cdx.json';fs.writeFileSync(path.join(directory,file),output,{mode:0o600});
 records.push({area,kind,file,components:value.components.length,lockSha256:createHash('sha256').update(fs.readFileSync(path.join(cwd,'package-lock.json'))).digest('hex'),sha256:createHash('sha256').update(output).digest('hex')});
}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({tool:'npm10.9.9',source:'lock metadata only; OS/global npm/Go/Java images require separate image SBOM',records},null,2),{mode:0o600});
console.log('SBOM artifacts: '+directory);

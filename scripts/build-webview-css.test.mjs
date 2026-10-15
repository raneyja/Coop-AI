import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const fixture='src/webview/.css-watch-compatibility.ts';
const config='tailwind.config.js';
const original=await fs.readFile(config,'utf8');
const child=spawn(process.execPath,['scripts/build-webview-css.mjs','--watch'],{stdio:['ignore','pipe','pipe']});
let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
async function until(predicate){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(50);}throw new Error('CSS watch bound: '+errors);}
const css=()=>fs.readFile('dist/webview.css','utf8');
try{
 await until(()=>output.includes('[webview-css] built'));
 await fs.writeFile(fixture,'export const cssFixture = "h-[123.456px] text-coop-accent";\n');
 await until(async()=> (await css()).includes('123.456px'));
 await fs.writeFile(config,original.replace('#3B82F6','#010203'));
 await until(async()=> (await css()).includes('#010203'));
 console.log('build-webview-css: actual source/config watch and compile PASS');
}finally{
 await fs.writeFile(config,original);await fs.rm(fixture,{force:true});
 const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await Promise.race([ended,sleep(5000).then(()=>{child.kill('SIGKILL');throw Error('CSS watch did not shut down');})]);
}

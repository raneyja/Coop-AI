import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {command} from './run-publication-regression.mjs';

const fixtures=[],cancellations=new Set();
function ownedCancellation(){const value=new AbortController();cancellations.add(value);return value;}
const abortOwnedChildren=()=>{for(const value of cancellations)value.abort();};
process.once('SIGTERM',abortOwnedChildren);process.once('SIGINT',abortOwnedChildren);
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'coop-eh13-command-'));fixtures.push(directory);return directory;}
function records(directory){return fs.readFileSync(path.join(directory,'commands.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));}
function settled(record){assert.equal(record.physicalClose,true);assert.throws(()=>process.kill(record.pid,0),error=>error.code==='ESRCH');}
async function ready(directory){
 const until=Date.now()+3000;
 while(Date.now()<until){if(fs.existsSync(path.join(directory,'held.log')) && fs.readFileSync(path.join(directory,'held.log'),'utf8').includes('READY'))return;await new Promise(resolve=>setTimeout(resolve,10));}
 throw new Error('Owned command did not become ready');
}
const held="process.on('SIGTERM',()=>process.exit(0));console.log('READY');setInterval(()=>{},1000)";

test('clean physical zero-exit succeeds and drains exact output',async()=>{
 const directory=fixture();await command(['--eval',"process.stdout.write('positive');process.stderr.write('control')"],'clean.log',{directory,timeoutMs:2000,killGraceMs:50});
 const [r]=records(directory);settled(r);assert.equal(r.code,0);assert.equal(r.expired,false);assert.equal(r.terminationRequested,false);assert.equal(fs.readFileSync(path.join(directory,'clean.log'),'utf8'),'positivecontrol');
});
test('timeout is failure even when actual SIGTERM handler exits zero',async()=>{
 const directory=fixture();await assert.rejects(command(['--eval',held],'held.log',{directory,timeoutMs:500,killGraceMs:100}),/timeout/);
 const [r]=records(directory);settled(r);assert.equal(r.code,0);assert.equal(r.expired,true);assert.equal(r.terminationRequested,true);assert.match(fs.readFileSync(path.join(directory,'held.log'),'utf8'),/READY/);
});
test('SIGTERM-ignoring child is physically SIGKILLed before timeout rejection',async()=>{
 const directory=fixture();await assert.rejects(command(['--eval',"process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)"],'held.log',{directory,timeoutMs:300,killGraceMs:80}),/timeout/);
 const [r]=records(directory);settled(r);assert.equal(r.childSignal,'SIGKILL');assert.equal(r.expired,true);assert.ok(r.elapsedMs>=300);
});
test('actual owned child killed externally cannot pass',async()=>{
 const directory=fixture(),cancel=ownedCancellation();const promise=command(['--eval',held],'held.log',{directory,abortSignal:cancel.signal,timeoutMs:3000,killGraceMs:80});
 const rejection=assert.rejects(promise,/failed/);
 try{await ready(directory);const start=JSON.parse(fs.readFileSync(path.join(directory,'processes.jsonl'),'utf8').trim());assert.equal(start.parentPid,process.pid);assert.ok(start.pid>1);process.kill(start.pid,'SIGKILL');await rejection;const [r]=records(directory);settled(r);assert.equal(r.childSignal,'SIGKILL');assert.equal(r.expired,false);}finally{cancel.abort();await promise.catch(()=>{});}
});
test('cancellation fails even when SIGTERM exits zero, after actual close',async()=>{
 const directory=fixture(),cancel=ownedCancellation();const promise=command(['--eval',held],'held.log',{directory,abortSignal:cancel.signal,timeoutMs:3000,killGraceMs:80});const rejection=assert.rejects(promise,/cancelled/);
 try{await ready(directory);cancel.abort();await rejection;const [r]=records(directory);settled(r);assert.equal(r.code,0);assert.equal(r.cancelled,true);assert.equal(r.terminationRequested,true);assert.equal(r.expired,false);}finally{cancel.abort();await promise.catch(()=>{});}
});
test('nonzero completed child fails without inventing timeout',async()=>{
 const directory=fixture();await assert.rejects(command(['--eval','process.exit(7)'],'exit.log',{directory,timeoutMs:2000,killGraceMs:50}),/failed \(7\)/);const [r]=records(directory);settled(r);assert.equal(r.code,7);assert.equal(r.expired,false);
});
test('already cancelled command starts no child or log',async()=>{
 const directory=fixture(),cancel=ownedCancellation();cancel.abort();await assert.rejects(command(['--eval','process.exit(0)'],'missing.log',{directory,abortSignal:cancel.signal}),/before start/);assert.deepEqual(fs.readdirSync(directory),[]);
});
test.after(()=>{process.removeListener('SIGTERM',abortOwnedChildren);process.removeListener('SIGINT',abortOwnedChildren);for(const directory of fixtures)fs.rmSync(directory,{recursive:true,force:true});});

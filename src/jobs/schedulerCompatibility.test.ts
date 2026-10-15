import assert from 'node:assert/strict';
import * as cron from 'node-cron';
import { JobScheduler } from './scheduler';
import { JobType } from './types';
import { loadJobQueueConfig } from '../config/jobQueueConfig';
import type { JobQueue } from './jobQueue';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
void(async()=>{
  assert.equal(cron.validate('invalid'),false);
  let queued=0;
  const queue={createJob:async()=>({jobId:String(++queued)}),results:{purgeExpired:async()=>0}} as unknown as JobQueue;
  const scheduler=new JobScheduler(queue,{...loadJobQueueConfig({}),schedules:[{name:'compatibility-fixture',trigger:'* * * * * *',jobType:JobType.GENERATE_REPO_SUMMARY,priority:'normal'}]});
  await scheduler.start();
  try{
    const bound=Date.now()+3500;while(queued===0&&Date.now()<bound)await sleep(25);
    assert.ok(queued>0,'actual cron4 should enqueue a scheduled callback');
    scheduler.stop();const atStop=queued;await sleep(1200);assert.equal(queued,atStop,'stop must prevent subsequent callbacks');
  }finally{scheduler.stop();}
  console.log('schedulerCompatibility: actual cron4 schedule/stop PASS');
})();

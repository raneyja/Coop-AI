const {publicationDatabaseFromEnvironment}=require('../../scripts/publication-test-fixture.mjs');
const url:string=publicationDatabaseFromEnvironment(process.env,'jobs');
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {PostgresQueueBackend} from './backends/postgresBackend';
const backend=new PostgresQueueBackend(url);
void(async()=>{
 try{
  const job=await backend.get(process.env.S79_CONTROL_JOB!);if(!job)throw Error('Missing own fixture job');
  const pool=(backend as unknown as {pool:Pool}).pool,connect=pool.connect.bind(pool);let paused=false;
  pool.connect=(async()=>{
   const client=await connect(),query=client.query.bind(client);
   client.query=(async(text:string,values?:unknown[])=>{
    const value=await query(text,values);
    if(!paused&&text.includes('SELECT pg_advisory_xact_lock')){paused=true;process.send?.({phase:'locked'});process.kill(process.pid,'SIGSTOP');}
    return value;
   }) as typeof client.query;
   return client;
  }) as typeof pool.connect;
  switch(process.env.S79_CONTROL_MODE){
   case 'claim':await backend.claimNext(randomUUID(),30000);break;
   case 'save':await backend.save({...job,id:randomUUID(),graphGenerations:undefined});break;
   case 'progress':await backend.updateOwned({...job,progress:33},{ownerId:job.ownerId!,attemptId:job.attemptId!});break;
   default:throw Error('Unknown control mode');
  }
  process.send?.({phase:'unexpected-success'});process.exitCode=1;
 }catch(error){process.send?.({phase:'controlled-rejection',message:error instanceof Error?error.message:'UnknownError'});}
 finally{await backend.close();process.disconnect?.();}
})();

const {publicationDatabaseFromEnvironment}=require('../../scripts/publication-test-fixture.mjs');
const url:string=publicationDatabaseFromEnvironment(process.env,'jobs');
import {Pool} from 'pg';
import {withEmbeddingConcurrencyLimit} from './embeddingRateLimiter';
const pool=new Pool({connectionString:url,ssl:false,max:2,application_name:`s79-embedding-${process.pid}`});
const key=process.env.S79_SYNTHETIC_EMBEDDING_KEY;
if(!key?.startsWith('synthetic-'))throw Error('Synthetic embedding key required');
let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);const abort=new AbortController();
process.on('message',message=>{if(message==='release')release();if(message==='abort')abort.abort();});
void (async()=>{
 try {
  process.send?.({phase:'ready',pid:process.pid});
  await withEmbeddingConcurrencyLimit(pool,key,async signal=>{
   if(process.env.S79_EMBEDDING_DISCONNECT==='1'){
    const row=(await pool.query("SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE locktype='advisory' AND granted AND a.application_name=$1 AND l.pid<>pg_backend_pid()",[`s79-embedding-${process.pid}`])).rows[0];
    process.send?.({phase:'lock-held',backendPid:row?.pid});
    await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>{process.send?.({phase:'callback-cancelled'});reject(signal.reason);},{once:true}));
   }
   await pool.query("UPDATE s79_embedding_counter SET active=active+1,peak=GREATEST(peak,active+1) WHERE id=1");
   process.send?.({phase:'entered',pid:process.pid});
   try{await held;}finally{await pool.query('UPDATE s79_embedding_counter SET active=active-1 WHERE id=1');}
  },abort.signal);
  process.send?.({phase:'done',pid:process.pid});
 }catch(error){process.send?.({phase:'error',name:error instanceof Error?error.name:'UnknownError'});process.exitCode=abort.signal.aborted||process.env.S79_EMBEDDING_DISCONNECT==='1'?0:1;}
 finally{await pool.end();process.disconnect?.();}
})();

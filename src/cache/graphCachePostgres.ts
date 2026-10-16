import type { Pool } from "pg";
import {randomUUID,createHash} from 'node:crypto';
import {withJobOwnedEffect,withJobEffectExclusion} from '../jobs/jobEffectAdmission';
import {GRAPH_JOB_TYPES,type Job} from '../jobs/types';
import { GraphCache, type GraphCacheOptions, type RepositoryGraph,graphCacheKey,type GraphReadyPatch } from "./graphCache";

type PersistOptions = GraphCacheOptions & {
  pool: Pool;
  orgId?: string;
};

type PendingPersist = {
  orgId: string;
  repoId: string;
  id:string;payload:string|null;baseRevision:string;baseGeneration:string;predecessor?:string;
};

let loggedMissingOrgPersist = false;

export class PersistingGraphCache extends GraphCache {
  private readonly pool: Pool;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingPersist = new Map<string, PendingPersist>();
  private readonly heads = new Map<string, {revision:string;requested:string;published:string}>();
  private readonly reads = new Map<string,number>();
  private readonly localWrites = new Map<string,number>();
  private flushPromise?: Promise<void>;
  private activePersist?: PendingPersist;
  private persistenceFailure?: Error;
  private closed=false;
  private readonly failedJobPublications=new Map<string,{job:Job;payload:string}>();

  /** Private payloads stay in this owner; diagnostics reveal identity/hash only.
   * Failure may mean COMMIT succeeded without its acknowledgement. Never replay. */
  public getFailedJobPublications(): Array<{jobId:string;attemptId?:string;payloadSha256:string;payloadBytes:number;state:'FAILED_OR_COMMIT_UNCERTAIN'}> {
    return [...this.failedJobPublications.values()].map(item=>({jobId:item.job.id,attemptId:item.job.attemptId,
      payloadSha256:createHash('sha256').update(item.payload).digest('hex'),payloadBytes:Buffer.byteLength(item.payload),state:'FAILED_OR_COMMIT_UNCERTAIN'}));
  }

  public constructor(options: PersistOptions) { super(options);this.pool=options.pool; }

  /** Refresh durable heads even on a local hit. A late read never rolls memory
   * back over another read/local mutation or a newer confirmed revision. */
  public async hydrateOrg(orgId: string): Promise<void> {
    const rows=await this.pool.query('SELECT repo_id FROM graph_publication_heads WHERE org_id=$1',[orgId]);
    for(const row of rows.rows) await this.ensureLoaded(orgId,String(row.repo_id));
  }

  public override async ensureLoaded(orgId: string,repoId: string): Promise<void> {
    if(!orgId) return;
    const key=graphCacheKey(orgId,repoId),read=(this.reads.get(key) ?? 0)+1;
    this.reads.set(key,read);
    const rows=await this.pool.query(`SELECT h.*,s.payload,s.generation FROM graph_publication_heads h
      LEFT JOIN graph_snapshots s ON s.org_id=h.org_id AND s.repo_id=h.repo_id
      WHERE h.org_id=$1 AND h.repo_id=$2`,[orgId,repoId]);
    if(this.reads.get(key)!==read) return;
    const row=rows.rows[0];
    if(!row) return; // Absent scope is not an invented generation/current snapshot.
    const previous=this.heads.get(key),revision=String(row.revision);
    if(previous && BigInt(revision)<BigInt(previous.revision)) return;
    this.heads.set(key,{revision,requested:String(row.requested_generation),published:String(row.published_generation)});
    const pending=this.pendingPersist.get(key);
    // Preserve a not-yet-durable local standalone mutation only on its exact base.
    if(pending && pending.baseRevision===revision && pending.baseGeneration===String(row.requested_generation)
      && String(row.requested_generation)===String(row.published_generation)) return;
    const graph=row.tombstone ? undefined : reviveGraph(parseJson(row.payload));
    if(graph) {
      graph.metadata.publication={generation:String(row.published_generation),requestedGeneration:String(row.requested_generation),revision,origin:String(row.origin)};
      this.installGraph(orgId,graph);
    } else super.deleteGraph(orgId,repoId,{persist:false});
  }

  public override setGraph(orgId: string,graph: RepositoryGraph): void {
    if(!orgId) {logSkipPersist(graph.repoId);return;}
    const key=graphCacheKey(orgId,graph.repoId);
    if(this.closed || this.persistenceFailure && this.pendingPersist.has(key)) throw new Error('Graph persistence requires reconciliation');
    const snapshot=this.sanitizeGraph(graph);
    delete snapshot.metadata.publication;
    this.installGraph(orgId,snapshot);
    this.capture(orgId,graph.repoId,JSON.stringify(snapshot,dateReplacer));
  }

  public override deleteGraph(orgId: string,repoId: string,options?: {persist?:boolean}): boolean {
    if(options?.persist!==false && (this.closed || this.persistenceFailure && this.pendingPersist.has(graphCacheKey(orgId,repoId)))) {
      throw new Error('Graph persistence requires reconciliation');
    }
    const deleted=super.deleteGraph(orgId,repoId,{persist:false});
    if(orgId && options?.persist!==false) this.capture(orgId,repoId,null);
    return deleted;
  }

  private capture(orgId:string,repoId:string,payload:string|null): void {
    const key=graphCacheKey(orgId,repoId),head=this.heads.get(key);
    const predecessor=this.pendingPersist.get(key) ?? (this.activePersist?.orgId===orgId && this.activePersist.repoId===repoId ? this.activePersist : undefined);
    this.pendingPersist.set(key,{orgId,repoId,payload,id:randomUUID(),
      predecessor:predecessor?.predecessor ?? predecessor?.id,
      baseRevision:predecessor?.baseRevision ?? head?.revision ?? '0',
      baseGeneration:predecessor?.baseGeneration ?? head?.requested ?? '0'});
    this.reads.set(key,(this.reads.get(key) ?? 0)+1);
    this.localWrites.set(key,(this.localWrites.get(key) ?? 0)+1);
    if(this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer=setTimeout(()=>{
      this.persistTimer=undefined;
      void this.flush().catch(()=>{console.error('[graph-cache] retained failed persistence; reconciliation required');});
    },250);
  }

  public getPersistenceState(): {pending:number;failed:boolean;closed:boolean} {
    return {pending:this.pendingPersist.size,failed:!!this.persistenceFailure,closed:this.closed};
  }

  public override async flush(): Promise<void> {
    if(this.persistTimer) {clearTimeout(this.persistTimer);this.persistTimer=undefined;}
    if(this.flushPromise) return this.flushPromise;
    this.flushPromise=this.flushPending();
    try { await this.flushPromise; }
    finally {this.flushPromise=undefined;}
  }

  private async flushPending(): Promise<void> {
    try {
      while(this.pendingPersist.size) {
        const item=this.pendingPersist.values().next().value as PendingPersist;
        this.activePersist=item;
        const revision=await withJobEffectExclusion(this.pool,async client=>{
          await client.query('INSERT INTO graph_publication_heads(org_id,repo_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[item.orgId,item.repoId]);
          const head=(await client.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE',[item.orgId,item.repoId])).rows[0];
          if(String(head.revision)!==item.baseRevision || String(head.requested_generation)!==item.baseGeneration
            || String(head.requested_generation)!==String(head.published_generation)) throw new Error('Standalone graph generation conflicted');
          const next=String(BigInt(item.baseGeneration)+1n),revision=String(BigInt(item.baseRevision)+1n);
          if(item.payload===null) await client.query('DELETE FROM graph_snapshots WHERE org_id=$1 AND repo_id=$2',[item.orgId,item.repoId]);
          else await client.query(`INSERT INTO graph_snapshots(org_id,repo_id,payload,generation,revision,origin,updated_at)
            VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) ON CONFLICT(org_id,repo_id) DO UPDATE SET
            payload=EXCLUDED.payload,generation=EXCLUDED.generation,revision=EXCLUDED.revision,origin=EXCLUDED.origin,updated_at=EXCLUDED.updated_at`,
            [item.orgId,item.repoId,item.payload,next,revision,'standalone:'+item.id]);
          await client.query(`UPDATE graph_publication_heads SET requested_generation=$3,published_generation=$3,revision=$4,
            tombstone=$5,requested_job_id=NULL,published_job_id=NULL,origin=$6 WHERE org_id=$1 AND repo_id=$2`,
            [item.orgId,item.repoId,next,revision,item.payload===null,'standalone:'+item.id]);
          return {revision,generation:next};
        });
        const key=graphCacheKey(item.orgId,item.repoId);
        this.heads.set(key,{revision:revision.revision,requested:revision.generation,published:revision.generation});
        this.markGraphPublication(item.orgId,item.repoId,{generation:revision.generation,requestedGeneration:revision.generation,revision:revision.revision,origin:'standalone:'+item.id});
        const current=this.pendingPersist.get(key);
        if(current===item) this.pendingPersist.delete(key);
        else if(current?.predecessor===item.id) {
          // Same captured local lineage, not a rebase over a foreign writer.
          this.pendingPersist.set(key,{...current,baseRevision:revision.revision,baseGeneration:revision.generation,predecessor:undefined});
        }
        this.activePersist=undefined;
      }
      this.persistenceFailure=undefined;
    } catch(error) {this.persistenceFailure=error instanceof Error ? error : new Error('Graph persistence failed');throw error;}
    finally {this.activePersist=undefined;}
  }

  public override async close(): Promise<void> {this.closed=true;await this.flush();
    if(this.failedJobPublications.size)throw new Error('Graph publication failure requires reconciliation');
  }

  public override async publishJobGraph(job:Job,graph:RepositoryGraph,ready?:GraphReadyPatch,signal?:AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if(this.closed) throw new Error('Graph cache closed');
    const orgId=String(job.params.orgId ?? ''),token=job.graphGenerations?.find(item=>item.orgId===orgId&&item.repoId===graph.repoId);
    if(!token || !GRAPH_JOB_TYPES.includes(job.type)) throw new Error('Graph publication has no submitted scope');
    // Capture bytes/identity BEFORE pool/head lock waits. No public cache mutation.
    const snapshot=this.sanitizeGraph(graph);
    delete snapshot.metadata.publication;
    const payload=JSON.stringify(snapshot,dateReplacer),repoId=snapshot.repoId;
    const key=graphCacheKey(orgId,repoId),readsAtStart=this.reads.get(key) ?? 0,localWritesAtStart=this.localWrites.get(key) ?? 0;
    const frozenToken=Object.freeze({...token}),readyStore=ready?.store,readyPatch=ready && structuredClone(ready.patch);
    const frozenJob=structuredClone(job),failureKey=frozenJob.id+':'+frozenJob.attemptId;
    if(this.failedJobPublications.has(failureKey))throw new Error('Graph publication failure requires reconciliation');
    const revision=await withJobOwnedEffect(this.pool,frozenJob,async client=>{
      const head=(await client.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE',[orgId,repoId])).rows[0];
      if(!head || String(head.requested_generation)!==frozenToken.generation || head.requested_job_id!==frozenJob.id) throw new Error('Graph publication superseded');
      const revision=String(BigInt(String(head.revision))+1n);
      await client.query(`INSERT INTO graph_snapshots(org_id,repo_id,payload,generation,revision,origin,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) ON CONFLICT(org_id,repo_id) DO UPDATE SET payload=EXCLUDED.payload,
        generation=EXCLUDED.generation,revision=EXCLUDED.revision,origin=EXCLUDED.origin,updated_at=EXCLUDED.updated_at`,
        [orgId,repoId,payload,frozenToken.generation,revision,'job:'+frozenJob.id+':'+frozenJob.attemptId]);
      await client.query(`UPDATE graph_publication_heads SET published_generation=$3,published_job_id=$4,revision=$5,
        tombstone=FALSE,origin=$6 WHERE org_id=$1 AND repo_id=$2`,[orgId,repoId,frozenToken.generation,frozenJob.id,revision,'job:'+frozenJob.id+':'+frozenJob.attemptId]);
      if(readyStore && readyPatch) await readyStore.upsertOrgRepoForJob(frozenJob,repoId,readyPatch,client);
      return revision;
    },signal).catch(error=>{this.failedJobPublications.set(failureKey,{job:frozenJob,payload});throw error;});
    const knownHead=this.heads.get(key);
    // A durable head refresh or a newer publication may complete while this
    // transaction's COMMIT acknowledgement is delayed. Do not let that older
    // acknowledgement erase known staleness or install its superseded payload.
    const localWriteChanged=(this.localWrites.get(key) ?? 0)!==localWritesAtStart;
    const newerHead=knownHead && (BigInt(knownHead.requested)>BigInt(frozenToken.generation) || BigInt(knownHead.revision)>BigInt(revision));
    const readInFlight=(this.reads.get(key) ?? 0)!==readsAtStart;
    if(localWriteChanged || newerHead || readInFlight) {
      // The durable effect is confirmed even though this owner's newer state
      // must win. Invalidate any hydration started before a known newer local
      // write/head; let an in-flight refresh apply its own database snapshot.
      if(localWriteChanged || newerHead) this.reads.set(key,(this.reads.get(key) ?? 0)+1);
      this.confirmJobPublication(frozenJob);
      return;
    }
    this.heads.set(key,{revision,requested:frozenToken.generation,published:frozenToken.generation});
    this.reads.set(key,(this.reads.get(key) ?? 0)+1);
    snapshot.metadata.publication={generation:frozenToken.generation,requestedGeneration:frozenToken.generation,revision,origin:'job:'+frozenJob.id+':'+frozenJob.attemptId};
    this.installGraph(orgId,snapshot);
    this.confirmJobPublication(frozenJob);
  }

  public override async assertJobPublished(job:Job,signal?:AbortSignal): Promise<void> {
    if(!this.hasJobPublication(job)) throw new Error('Job returned without confirmed graph publication');
    await withJobOwnedEffect(this.pool,job,async client=>{
      for(const token of job.graphGenerations ?? []) {
        const rows=await client.query(`SELECT 1 FROM graph_publication_heads h JOIN graph_snapshots s USING(org_id,repo_id)
          WHERE h.org_id=$1 AND h.repo_id=$2 AND h.requested_generation=$3 AND h.published_generation=$3
          AND s.generation=$3 AND h.published_job_id=$4 AND NOT h.tombstone`,[token.orgId,token.repoId,token.generation,job.id]);
        if(rows.rows.length!==1) throw new Error('Confirmed graph generation no longer current');
      }
    },signal);
  }
}

export async function createGraphCache(
  backend: "memory" | "postgres" | "redis" | "hybrid",
  options: GraphCacheOptions & { pool?: Pool | null; connectionString?: string }
): Promise<GraphCache> {
  if (backend === "postgres") {
    const pool = options.pool ?? (options.connectionString ? await import("../server/db").then((m) => m.getDbPool(options.connectionString)) : null);
    if (!pool) {
      throw new Error("GRAPH_CACHE_BACKEND=postgres requires DATABASE_URL");
    }
    // Do not hydrate every tenant into this process. Rows load on demand per org+repo.
    return new PersistingGraphCache({ ...options, pool });
  }
  return new GraphCache(options);
}

function logSkipPersist(repoId: string): void {
  if (loggedMissingOrgPersist) {
    return;
  }
  loggedMissingOrgPersist = true;
  console.warn(`[graph-cache] skip persist — missing orgId (first repo ${repoId})`);
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

function reviveGraph(value: unknown): RepositoryGraph | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const graph = value as RepositoryGraph;
  graph.lastUpdated = new Date(graph.lastUpdated);
  if (graph.metadata?.lastIndexedAt) {
    graph.metadata.lastIndexedAt = new Date(graph.metadata.lastIndexedAt);
  }
  graph.fileTree = (graph.fileTree ?? []).map((file) => ({
    ...file,
    lastModified: new Date(file.lastModified)
  }));
  graph.recentCommits = (graph.recentCommits ?? []).map((commit) => ({
    ...commit,
    date: new Date(commit.date)
  }));
  return graph;
}

function dateReplacer(_key: string, value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

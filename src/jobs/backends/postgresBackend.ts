import { randomUUID } from "node:crypto";
import type { PoolConfig } from "pg";
import databasePoolOptions from "../../server/databasePoolOptions.cjs";
import type { Job, JobLease, JobParams, JobResultRecord, JobStatus } from "../types";
import { EFFECT_JOB_TYPES, GRAPH_JOB_TYPES, JobType } from "../types";
import { JOB_EFFECT_ADMISSION_LOCK } from "../jobEffectAdmission";
import type { PostgresCapableBackend } from "../resultStorage";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end?: () => Promise<void>;
  connect: () => Promise<{query: PgPool['query']; release: () => void}>;
};


export class PostgresQueueBackend implements PostgresCapableBackend {
  public readonly name = "postgres";
  private pool: PgPool | null = null;
  private initPromise: Promise<void> | null = null;

  public constructor(private readonly connectionString: string) {}

  /** Head allocation and the queued row are one logical submission. */
  public async save(job: Job): Promise<Job> {
    await this.ensureInit();
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      // Serialize submission/dedup with actual effect admission and purge.
      await client.query('SELECT pg_advisory_xact_lock($1)', [JOB_EFFECT_ADMISSION_LOCK]);
      const previous = await client.query('SELECT * FROM jobs WHERE id=$1', [job.id]);
      if (previous.rows[0]) { await client.query('COMMIT'); return rowToJob(previous.rows[0]); }
      const generations: NonNullable<Job['graphGenerations']> = [];
      if (EFFECT_JOB_TYPES.includes(job.type)) {
        const orgId = String(job.params.orgId ?? '').trim();
        if (!orgId) throw new Error('Effect submission requires an organization');
        const repoId = String(job.params.repoId ?? '').trim();
        const collectionId = String(job.params.collectionId ?? '').trim();
        const repos = repoId ? [repoId] : job.type === JobType.BUILD_STRUCTURE_MANIFEST && collectionId
          ? (await client.query(`SELECT cr.repo_id FROM collection_repos cr JOIN org_collections oc ON oc.id=cr.collection_id
              WHERE oc.org_id=$1 AND cr.collection_id=$2 ORDER BY cr.repo_id`, [orgId,collectionId])).rows.map(row => String(row.repo_id)) : [];
        if (!repos.length) throw new Error('Effect submission requires an admitted repository scope');
        for (const scopedRepo of [...new Set(repos)].sort()) {
          await client.query('INSERT INTO graph_publication_heads(org_id,repo_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [orgId,scopedRepo]);
          const head = await client.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE', [orgId,scopedRepo]);
          if (job.type === JobType.INDEX_REPOSITORY) {
            const active = await client.query(`SELECT * FROM jobs WHERE type=$1 AND status IN ('queued','running')
              AND params->>'orgId'=$2 AND params->>'repoId'=$3 AND id=$4 ORDER BY created_at DESC LIMIT 1`, [job.type,orgId,scopedRepo,head.rows[0].requested_job_id]);
            if (active.rows[0]) { await client.query('COMMIT'); return rowToJob(active.rows[0]); }
          }
          let generation = String(head.rows[0].requested_generation);
          if (GRAPH_JOB_TYPES.includes(job.type)) {
            const advanced = await client.query(`UPDATE graph_publication_heads SET requested_generation=requested_generation+1,
              requested_job_id=$3 WHERE org_id=$1 AND repo_id=$2 RETURNING requested_generation`, [orgId,scopedRepo,job.id]);
            generation = String(advanced.rows[0].requested_generation);
            await client.query(`UPDATE jobs SET status='cancelled',completed_at=clock_timestamp(),error='Queued graph generation superseded'
              WHERE status='queued' AND EXISTS(SELECT 1 FROM jsonb_array_elements(graph_generations) token
                WHERE token->>'orgId'=$1 AND token->>'repoId'=$2 AND token->>'generation'<>$3)`,[orgId,scopedRepo,generation]);
          }
          generations.push({orgId,repoId:scopedRepo,generation});
        }
      }
      const stored = await client.query(`INSERT INTO jobs (id,type,status,priority,user_id,params,result,error,progress,
        retry_count,scheduled,created_at,started_at,completed_at,estimated_duration_ms,graph_generations)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [job.id,job.type,job.status,job.priority,job.userId ?? null,JSON.stringify(job.params),job.result ? JSON.stringify(job.result) : null,
         job.error ?? null,job.progress,job.retryCount,job.scheduled ?? false,job.createdAt,job.startedAt ?? null,job.completedAt ?? null,
         job.estimatedDurationMs,generations.length ? JSON.stringify(generations) : null]);
      if (job.type === JobType.INDEX_REPOSITORY) {
        await client.query(`INSERT INTO org_repos(org_id,repo_id,lightning_enabled,index_status,last_job_id)
          VALUES($1,$2,TRUE,'queued',$3) ON CONFLICT(org_id,repo_id) DO UPDATE SET lightning_enabled=TRUE,
          index_status='queued',last_job_id=EXCLUDED.last_job_id,error=NULL,embedding_status=NULL,embedding_error=NULL`,
          [generations[0].orgId,generations[0].repoId,job.id]);
      }
      await client.query('COMMIT');
      return rowToJob(stored.rows[0]);
    } catch(error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  public async recordJobSubmission(userId: string, jobType: JobType): Promise<void> {
    await this.incrementRateLimit(userId, jobType);
  }

  public async get(id: string): Promise<Job | undefined> {
    await this.ensureInit();
    const result = await this.pool!.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? rowToJob(row) : undefined;
  }

  public async listByStatus(statuses: JobStatus[]): Promise<Job[]> {
    await this.ensureInit();
    const result = await this.pool!.query(
      `SELECT * FROM jobs WHERE status = ANY($1::text[]) ORDER BY created_at ASC`,
      [statuses]
    );
    return result.rows.map(rowToJob);
  }

  public async claimNext(ownerId: string, leaseMs: number): Promise<Job | undefined> {
    await this.ensureInit();
    const client = await this.pool!.connect();
    try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [JOB_EFFECT_ADMISSION_LOCK]);
    const result = await client.query(
      `WITH next AS (
         SELECT id FROM jobs WHERE status = 'queued' AND available_at <= clock_timestamp()
           AND (type <> ALL($4::text[]) OR (graph_generations IS NOT NULL AND NOT EXISTS(
             SELECT 1 FROM jsonb_array_elements(graph_generations) token LEFT JOIN graph_publication_heads h
             ON h.org_id::text=token->>'orgId' AND h.repo_id=token->>'repoId'
             WHERE h.org_id IS NULL OR h.requested_generation::text<>token->>'generation')))
           AND (type <> ALL($4::text[]) OR NOT EXISTS (
             SELECT 1 FROM jobs blocked WHERE blocked.effect_quarantined
               OR (blocked.status = 'running' AND blocked.type = ANY($4::text[]))))
         ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at
         LIMIT 1 FOR UPDATE SKIP LOCKED
       ) UPDATE jobs SET status = 'running', owner_id = $1, attempt_id = $2,
         lease_expires_at = clock_timestamp() + ($3 * INTERVAL '1 millisecond'),
         started_at = clock_timestamp(), completed_at = NULL, progress = 5, error = NULL
       FROM next WHERE jobs.id = next.id RETURNING jobs.*`, [ownerId, randomUUID(), leaseMs, EFFECT_JOB_TYPES]);
    await client.query('COMMIT');
    return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  public async renew(id: string, lease: JobLease, leaseMs: number): Promise<boolean> {
    await this.ensureInit();
    const result = await this.pool!.query(
      `UPDATE jobs SET lease_expires_at = clock_timestamp() + ($4 * INTERVAL '1 millisecond')
       WHERE id = $1 AND owner_id = $2 AND attempt_id = $3 AND status = 'running'
         AND lease_expires_at > clock_timestamp() RETURNING id`, [id, lease.ownerId, lease.attemptId, leaseMs]);
    return result.rows.length === 1;
  }

  /** Result and status commit together; a stale attempt cannot overwrite either. */
  public async updateOwned(job: Job, lease: JobLease, record?: JobResultRecord): Promise<Job | undefined> {
    job=structuredClone(job); // Freeze caller identity/result before any checkout or lock wait.
    record=record && structuredClone(record);
    await this.ensureInit();
    const client=await this.pool!.connect();
    const identity=[job.id,lease.ownerId,lease.attemptId,job.type,JSON.stringify(job.params),job.userId ?? null,
      job.graphGenerations ? JSON.stringify(job.graphGenerations) : null];
    const checkHeads=async()=>{
      if(job.status!=='completed' || !EFFECT_JOB_TYPES.includes(job.type))return;
      if(!job.graphGenerations?.length)throw new Error('Terminal effect has no submitted generation');
      for(const token of [...job.graphGenerations].sort((a,b)=>a.orgId.localeCompare(b.orgId)||a.repoId.localeCompare(b.repoId))) {
        const head=(await client.query('SELECT * FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2 FOR UPDATE',[token.orgId,token.repoId])).rows[0];
        if(!head || String(head.requested_generation)!==token.generation)throw new Error('Terminal effect generation superseded');
        if(GRAPH_JOB_TYPES.includes(job.type) && (String(head.published_generation)!==token.generation || head.published_job_id!==job.id || head.tombstone)) {
          throw new Error('Terminal graph is not confirmed');
        }
      }
    };
    try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[job.id]);
    const admitted=await client.query(`SELECT id FROM jobs WHERE id=$1 AND owner_id=$2 AND attempt_id=$3
      AND status='running' AND type=$4 AND params=$5::jsonb AND user_id IS NOT DISTINCT FROM $6::varchar
      AND graph_generations IS NOT DISTINCT FROM $7::jsonb AND lease_expires_at>clock_timestamp()`,identity);
    if(!admitted.rows.length){await client.query('ROLLBACK');return undefined;}
    await checkHeads();
    const result = await client.query(
      `WITH updated AS (
         UPDATE jobs SET status = $4::varchar, progress = $5, result = $6, error = $7, effect_quarantined = effect_quarantined OR $12,
           completed_at = CASE WHEN $4::varchar = 'running' THEN NULL ELSE clock_timestamp() END
         WHERE id = $1 AND owner_id = $2 AND attempt_id = $3 AND status = 'running'
           AND lease_expires_at > clock_timestamp() AND type=$13 AND params=$14::jsonb
           AND user_id IS NOT DISTINCT FROM $15::varchar AND graph_generations IS NOT DISTINCT FROM $16::jsonb
           AND ($4::varchar<>'completed' OR type<>ALL($17::text[]) OR
             (graph_generations IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph_generations) token
               LEFT JOIN graph_publication_heads h ON h.org_id::text=token->>'orgId' AND h.repo_id=token->>'repoId'
               WHERE h.org_id IS NULL OR h.requested_generation::text<>token->>'generation'
                 OR h.published_generation::text<>token->>'generation' OR h.published_job_id IS DISTINCT FROM jobs.id OR h.tombstone))) RETURNING *
       ), stored AS (
         INSERT INTO job_results (job_id, result, result_size, stored_at, expires_at, access_count)
         SELECT id, $8::jsonb, $9, clock_timestamp(), clock_timestamp() + ($10 * INTERVAL '1 millisecond'), 0
         FROM updated WHERE $11::boolean
         ON CONFLICT (job_id) DO UPDATE SET result = EXCLUDED.result, result_size = EXCLUDED.result_size,
           stored_at = EXCLUDED.stored_at, expires_at = EXCLUDED.expires_at
         RETURNING job_id
       ) SELECT * FROM updated`,
      [job.id, lease.ownerId, lease.attemptId, job.status, job.progress,
        job.result === undefined ? null : JSON.stringify(job.result), job.error ?? null,
        JSON.stringify(record?.result ?? null), record?.resultSize ?? 0,
        record ? record.expiresAt.getTime() - record.storedAt.getTime() : 0, Boolean(record), Boolean(job.effectQuarantined),job.type,JSON.stringify(job.params),job.userId ?? null,
        job.graphGenerations ? JSON.stringify(job.graphGenerations) : null,GRAPH_JOB_TYPES]);
    if(!result.rows.length){await client.query('ROLLBACK');return undefined;}
    // Result INSERT/lock waits can consume the lease too. Recheck clock and the
    // frozen tuple in a new statement before committing either result or status.
    await checkHeads();
    const current=await client.query(`SELECT id FROM jobs WHERE id=$1 AND owner_id=$2 AND attempt_id=$3
      AND type=$4 AND params=$5::jsonb AND user_id IS NOT DISTINCT FROM $6::varchar
      AND graph_generations IS NOT DISTINCT FROM $7::jsonb AND lease_expires_at>clock_timestamp()`,identity);
    if(!current.rows.length)throw new Error('Terminal job lost lease before commit');
    await client.query('COMMIT');return rowToJob(result.rows[0]);
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
    finally{client.release();}
  }

  public async cancel(id: string, includeRunning: boolean): Promise<Job | undefined> {
    await this.ensureInit();
    const result = await this.pool!.query(
      `UPDATE jobs SET status = 'cancelled', completed_at = clock_timestamp(), error = 'Cancelled by user',
         effect_quarantined = status = 'running' AND type = ANY($3::text[])
       WHERE id = $1 AND (status = 'queued' OR ($2::boolean AND status = 'running')) RETURNING *`, [id, includeRunning, EFFECT_JOB_TYPES]);
    return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
  }

  public async requeue(id: string, lease: JobLease, delayMs: number, countRetry: boolean): Promise<Job | undefined> {
    await this.ensureInit();
    const result = await this.pool!.query(
      `UPDATE jobs SET status = 'queued', owner_id = NULL, attempt_id = NULL, lease_expires_at = NULL,
         started_at = NULL, completed_at = NULL, progress = 0, retry_count = retry_count + $5,
         available_at = clock_timestamp() + ($4 * INTERVAL '1 millisecond')
       WHERE id = $1 AND owner_id = $2 AND attempt_id = $3 AND status = 'running'
         AND lease_expires_at > clock_timestamp()
         AND (type <> ALL($6::text[]) OR ($5 = 0 AND progress = 5)) RETURNING *`,
      [id, lease.ownerId, lease.attemptId, delayMs, countRetry ? 1 : 0, EFFECT_JOB_TYPES]);
    return result.rows[0] ? rowToJob(result.rows[0]) : undefined;
  }

  public async reclaimExpired(maxRetries: number): Promise<number> {
    await this.ensureInit();
    return reclaimExpiredJobLeases(this.pool!, maxRetries);
  }

  public async delete(id: string): Promise<boolean> {
    await this.ensureInit();
    const result = await this.pool!.query(`DELETE FROM jobs WHERE id = $1 AND status <> 'running' AND NOT effect_quarantined RETURNING id`, [id]);
    return result.rows.length > 0;
  }

  public async findReusableCompletedJob(
    userId: string,
    jobType: JobType,
    params: JobParams,
    maxAgeMs: number
  ): Promise<Job | undefined> {
    await this.ensureInit();
    const repoId = params.repoId ? String(params.repoId).trim() : "";
    if (!repoId) {
      return undefined;
    }
    const file = params.file ? String(params.file).trim() : "";
    const since = new Date(Date.now() - maxAgeMs);
    const result = await this.pool!.query(
      `SELECT * FROM jobs
       WHERE type = $1
         AND user_id = $2
         AND status IN ('completed', 'partial')
         AND result IS NOT NULL
         AND completed_at >= $3
         AND params->>'orgId' IS NOT DISTINCT FROM $6::text
         AND (type <> 'build_dependency_graph' OR EXISTS (SELECT 1 FROM graph_publication_heads h
           WHERE h.org_id::text=params->>'orgId' AND h.repo_id=params->>'repoId'
             AND h.published_job_id=jobs.id AND h.requested_generation=h.published_generation))
         AND params->>'repoId' = $4
         AND COALESCE(params->>'file', '') = $5
       ORDER BY completed_at DESC
       LIMIT 1`,
      [jobType, userId, since, repoId, file, params.orgId ?? null]
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : undefined;
  }

  public async findLatestCompletedJob(
    userId: string,
    jobType: JobType,
    params: JobParams
  ): Promise<Job | undefined> {
    await this.ensureInit();
    const repoId = params.repoId ? String(params.repoId).trim() : "";
    if (!repoId) {
      return undefined;
    }
    const file = params.file ? String(params.file).trim() : "";
    const result = await this.pool!.query(
      `SELECT * FROM jobs
       WHERE type = $1
         AND user_id = $2
         AND status IN ('completed', 'partial')
         AND result IS NOT NULL
         AND params->>'orgId' IS NOT DISTINCT FROM $5::text
         AND (type <> 'build_dependency_graph' OR EXISTS (SELECT 1 FROM graph_publication_heads h
           WHERE h.org_id::text=params->>'orgId' AND h.repo_id=params->>'repoId'
             AND h.published_job_id=jobs.id AND h.requested_generation=h.published_generation))
         AND params->>'repoId' = $3
         AND COALESCE(params->>'file', '') = $4
       ORDER BY completed_at DESC
       LIMIT 1`,
      [jobType, userId, repoId, file, params.orgId ?? null]
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : undefined;
  }

  public async findActiveIndexJob(
    orgId: string,
    repoId: string
  ): Promise<{ jobId: string; status: "queued" | "running" } | undefined> {
    await this.ensureInit();
    const result = await this.pool!.query(
      `SELECT id, status FROM jobs
       WHERE type = $1
         AND status IN ('queued', 'running')
         AND params->>'orgId' = $2
         AND params->>'repoId' = $3
         AND EXISTS(SELECT 1 FROM graph_publication_heads h WHERE h.org_id::text=params->>'orgId'
           AND h.repo_id=params->>'repoId' AND h.requested_job_id=jobs.id)
       ORDER BY
         CASE status WHEN 'running' THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 1`,
      [JobType.INDEX_REPOSITORY, orgId, repoId]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    const status = String(row.status);
    if (status !== "queued" && status !== "running") {
      return undefined;
    }
    return { jobId: String(row.id), status };
  }

  public async countJobsForUser(userId: string, jobType: string, window: "hour" | "today"): Promise<number> {
    await this.ensureInit();
    const windowType = window === "hour" ? "hour" : "day";
    const result = await this.pool!.query(
      `SELECT job_count FROM job_rate_limits
       WHERE user_id = $1 AND job_type = $2 AND window_type = $3
       ORDER BY window_start DESC LIMIT 1`,
      [userId, jobType, windowType]
    );
    const count = result.rows[0]?.job_count;
    return typeof count === "number" ? count : Number(count ?? 0);
  }

  public async getResult(jobId: string): Promise<JobResultRecord | undefined> {
    await this.ensureInit();
    const result = await this.pool!.query(
      `SELECT * FROM job_results WHERE job_id = $1 ORDER BY stored_at DESC LIMIT 1`,
      [jobId]
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      jobId: String(row.job_id),
      result: parseJson(row.result),
      resultSize: Number(row.result_size ?? 0),
      storedAt: rowDate(row.stored_at),
      expiresAt: rowDate(row.expires_at),
      accessCount: Number(row.access_count ?? 0)
    };
  }

  public async purgeExpiredResults(): Promise<number> {
    await this.ensureInit();
    const result = await this.pool!.query(`DELETE FROM job_results WHERE expires_at < NOW()`);
    return result.rows.length;
  }

  public async close(): Promise<void> {
    if (this.pool?.end) {
      await this.pool.end();
    }
    this.pool = null;
  }

  private async ensureInit(): Promise<void> {
    if (this.pool) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.connect();
    }
    await this.initPromise;
  }

  private async connect(): Promise<void> {
    const pg = await import("pg");
    const Pool = pg.Pool ?? (pg as { default?: { Pool: new (config: PoolConfig) => PgPool } }).default?.Pool;
    if (!Pool) {
      throw new Error("pg module did not export Pool");
    }
    this.pool = new Pool(databasePoolOptions(this.connectionString)) as PgPool;
  }

  private async incrementRateLimit(userId: string | undefined, jobType: JobType): Promise<void> {
    if (!userId) {
      return;
    }
    const now = new Date();
    for (const windowType of ["hour", "day"] as const) {
      const windowStart =
        windowType === "hour"
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())
          : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      await this.pool!.query(
        `INSERT INTO job_rate_limits (user_id, job_type, window_type, window_start, job_count)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (user_id, job_type, window_type, window_start)
         DO UPDATE SET job_count = job_rate_limits.job_count + 1`,
        [userId, jobType, windowType, windowStart]
      );
    }
  }
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    type: String(row.type) as JobType,
    status: String(row.status) as Job["status"],
    priority: String(row.priority) as Job["priority"],
    params: parseJson(row.params) as Record<string, unknown>,
    userId: row.user_id ? String(row.user_id) : undefined,
    progress: Number(row.progress ?? 0),
    result: row.result ? parseJson(row.result) : undefined,
    error: row.error ? String(row.error) : undefined,
    createdAt: rowDate(row.created_at),
    startedAt: row.started_at ? rowDate(row.started_at) : undefined,
    completedAt: row.completed_at ? rowDate(row.completed_at) : undefined,
    estimatedDurationMs: Number(row.estimated_duration_ms ?? 120_000),
    retryCount: Number(row.retry_count ?? 0),
    scheduled: Boolean(row.scheduled),
    ownerId: row.owner_id ? String(row.owner_id) : undefined,
    attemptId: row.attempt_id ? String(row.attempt_id) : undefined,
    leaseExpiresAt: row.lease_expires_at ? rowDate(row.lease_expires_at) : undefined,
    availableAt: row.available_at ? rowDate(row.available_at) : undefined,
    graphGenerations: row.graph_generations ? parseJson(row.graph_generations) as Job['graphGenerations'] : undefined,
    effectQuarantined: Boolean(row.effect_quarantined)
  };
}

function rowDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

/** Database time, not process uptime or job start age, determines recovery. */
export async function reclaimExpiredJobLeases(pool: PgPool, maxRetries = 3): Promise<number> {
  const result = await pool.query(
    `UPDATE jobs SET
       status = CASE WHEN type = ANY($2::text[]) OR retry_count >= $1 THEN 'failed' ELSE 'queued' END,
       completed_at = CASE WHEN type = ANY($2::text[]) OR retry_count >= $1 THEN clock_timestamp() ELSE NULL END,
       error = CASE WHEN type = ANY($2::text[]) THEN 'Expired effect attempt quarantined; terminate worker and reconcile effects'
         WHEN retry_count >= $1 THEN 'Lease recovery retry limit exhausted' ELSE 'Expired worker lease reclaimed' END,
       effect_quarantined = type = ANY($2::text[]),
       retry_count = retry_count + 1,
       owner_id = CASE WHEN type = ANY($2::text[]) THEN owner_id ELSE NULL END,
       attempt_id = CASE WHEN type = ANY($2::text[]) THEN attempt_id ELSE NULL END, lease_expires_at = NULL,
       started_at = NULL, progress = 0, available_at = clock_timestamp()
     WHERE status = 'running' AND lease_expires_at <= clock_timestamp() RETURNING id`, [maxRetries, EFFECT_JOB_TYPES]);
  return result.rows.length;
}

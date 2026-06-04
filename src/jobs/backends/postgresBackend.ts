import type { Job, JobResultRecord, JobStatus } from "../types";
import { JobType } from "../types";
import type { PostgresCapableBackend } from "../resultStorage";
import type { QueueBackend } from "./types";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end?: () => Promise<void>;
  connect?: () => Promise<PgClient>;
};

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release?: () => void;
};

export class PostgresQueueBackend implements PostgresCapableBackend {
  public readonly name = "postgres";
  private pool: PgPool | null = null;
  private initPromise: Promise<void> | null = null;

  public constructor(private readonly connectionString: string) {}

  public async save(job: Job): Promise<void> {
    await this.ensureInit();
    await this.pool!.query(
      `INSERT INTO jobs (
        id, type, status, priority, user_id, params, result, error, progress,
        retry_count, scheduled, created_at, started_at, completed_at, estimated_duration_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        error = EXCLUDED.error,
        progress = EXCLUDED.progress,
        retry_count = EXCLUDED.retry_count,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at`,
      [
        job.id,
        job.type,
        job.status,
        job.priority,
        job.userId ?? null,
        JSON.stringify(job.params),
        job.result ? JSON.stringify(job.result) : null,
        job.error ?? null,
        job.progress,
        job.retryCount,
        job.scheduled ?? false,
        job.createdAt,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.estimatedDurationMs
      ]
    );
    await this.incrementRateLimit(job.userId, job.type);
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

  public async claimNext(): Promise<Job | undefined> {
    await this.ensureInit();
    const client = await (this.pool as PgPool & { connect?: () => Promise<PgClient> }).connect?.();
    if (!client) {
      return claimNextWithoutLock(this.pool!);
    }
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT * FROM jobs
         WHERE status = 'queued'
         ORDER BY
           CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const job = rowToJob(row);
      job.status = "running";
      job.startedAt = new Date();
      job.progress = 5;
      await client.query(
        `UPDATE jobs SET status = $2, started_at = $3, progress = $4 WHERE id = $1`,
        [job.id, job.status, job.startedAt, job.progress]
      );
      await client.query("COMMIT");
      return job;
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      return claimNextWithoutLock(this.pool!);
    } finally {
      client.release?.();
    }
  }

  public async update(job: Job): Promise<void> {
    await this.save(job);
  }

  public async delete(id: string): Promise<boolean> {
    await this.ensureInit();
    const result = await this.pool!.query(`DELETE FROM jobs WHERE id = $1`, [id]);
    return result.rows.length > 0;
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

  public async saveResult(record: JobResultRecord): Promise<void> {
    await this.ensureInit();
    await this.pool!.query(
      `INSERT INTO job_results (job_id, result, result_size, stored_at, expires_at, access_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_id) DO UPDATE SET
         result = EXCLUDED.result,
         result_size = EXCLUDED.result_size,
         stored_at = EXCLUDED.stored_at,
         expires_at = EXCLUDED.expires_at`,
      [
        record.jobId,
        JSON.stringify(record.result),
        record.resultSize,
        record.storedAt,
        record.expiresAt,
        record.accessCount
      ]
    );
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
      storedAt: new Date(String(row.stored_at)),
      expiresAt: new Date(String(row.expires_at)),
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
    const Pool = pg.Pool ?? (pg as { default?: { Pool: new (config: { connectionString: string }) => PgPool } }).default?.Pool;
    if (!Pool) {
      throw new Error("pg module did not export Pool");
    }
    this.pool = new Pool({ connectionString: this.connectionString }) as PgPool;
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
    createdAt: new Date(String(row.created_at)),
    startedAt: row.started_at ? new Date(String(row.started_at)) : undefined,
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : undefined,
    estimatedDurationMs: Number(row.estimated_duration_ms ?? 120_000),
    retryCount: Number(row.retry_count ?? 0),
    scheduled: Boolean(row.scheduled)
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

async function claimNextWithoutLock(pool: PgPool): Promise<Job | undefined> {
  const result = await pool.query(
    `SELECT * FROM jobs WHERE status = 'queued'
     ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       created_at ASC
     LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  const job = rowToJob(row);
  job.status = "running";
  job.startedAt = new Date();
  job.progress = 5;
  await pool.query(
    `UPDATE jobs SET status = $2, started_at = $3, progress = $4 WHERE id = $1 AND status = 'queued'`,
    [job.id, job.status, job.startedAt, job.progress]
  );
  return job;
}

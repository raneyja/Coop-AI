import type { JobQueueConfig } from "../config/jobQueueConfig";
import type { JobResultRecord } from "./types";
import type { QueueBackend } from "./backends/types";

const HOT_TTL_MS = 60 * 60 * 1000;

export class ResultStorage {
  private readonly hot = new Map<string, JobResultRecord>();

  public constructor(
    private readonly config: JobQueueConfig,
    private readonly backend?: QueueBackend
  ) {}

  /** Queue completion persists this together with its attempt CAS. */
  public prepare(jobId: string, result: unknown, scheduled = false): JobResultRecord {
    const serialized = JSON.stringify(result ?? null);
    const retentionDays = scheduled ? this.config.scheduledRetentionDays : this.config.resultRetentionDays;
    const now = new Date();
    const record: JobResultRecord = {
      jobId,
      result,
      resultSize: Buffer.byteLength(serialized, "utf8"),
      storedAt: now,
      expiresAt: new Date(now.getTime() + retentionDays * 86_400_000),
      accessCount: 0
    };
    return record;
  }

  public remember(record: JobResultRecord): void {
    this.hot.set(record.jobId, record);
  }

  public async get(jobId: string): Promise<JobResultRecord | undefined> {
    const hot = this.hot.get(jobId);
    if (hot && hot.expiresAt.getTime() > Date.now()) {
      hot.accessCount += 1;
      return hot;
    }
    if (this.hot.has(jobId)) {
      this.hot.delete(jobId);
    }
    if (this.backend && "getResult" in this.backend) {
      const warm = await (this.backend as PostgresCapableBackend).getResult(jobId);
      if (warm && warm.expiresAt.getTime() > Date.now()) {
        this.hot.set(jobId, warm);
        warm.accessCount += 1;
        return warm;
      }
    }
    return undefined;
  }

  public async purgeExpired(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [id, record] of this.hot) {
      if (record.expiresAt.getTime() <= now) {
        this.hot.delete(id);
        removed += 1;
      }
    }
    if (this.backend && "purgeExpiredResults" in this.backend) {
      removed += await (this.backend as PostgresCapableBackend).purgeExpiredResults();
    }
    return removed;
  }

  public isHot(jobId: string): boolean {
    const record = this.hot.get(jobId);
    if (!record) {
      return false;
    }
    return Date.now() - record.storedAt.getTime() < HOT_TTL_MS;
  }
}

export type PostgresCapableBackend = QueueBackend & {
  getResult(jobId: string): Promise<JobResultRecord | undefined>;
  purgeExpiredResults(): Promise<number>;
};

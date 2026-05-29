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

  public async store(jobId: string, result: unknown, scheduled = false): Promise<JobResultRecord> {
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
    this.hot.set(jobId, record);
    if (this.backend && "saveResult" in this.backend) {
      await (this.backend as PostgresCapableBackend).saveResult(record);
    }
    return record;
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
  saveResult(record: JobResultRecord): Promise<void>;
  getResult(jobId: string): Promise<JobResultRecord | undefined>;
  purgeExpiredResults(): Promise<number>;
};

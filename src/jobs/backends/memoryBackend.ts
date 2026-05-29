import type { Job, JobStatus } from "../types";
import type { QueueBackend } from "./types";

type RateLimitEntry = {
  hour: Map<string, number>;
  day: Map<string, number>;
  hourReset: number;
  dayReset: number;
};

export class MemoryQueueBackend implements QueueBackend {
  public readonly name = "memory";
  private readonly jobs = new Map<string, Job>();
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  public async save(job: Job): Promise<void> {
    this.jobs.set(job.id, cloneJob(job));
  }

  public async get(id: string): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  public async listByStatus(statuses: JobStatus[]): Promise<Job[]> {
    const set = new Set(statuses);
    return [...this.jobs.values()]
      .filter((job) => set.has(job.status))
      .map(cloneJob);
  }

  public async update(job: Job): Promise<void> {
    this.jobs.set(job.id, cloneJob(job));
  }

  public async delete(id: string): Promise<boolean> {
    return this.jobs.delete(id);
  }

  public async countJobsForUser(userId: string, jobType: string, window: "hour" | "today"): Promise<number> {
    const key = `${userId}:${jobType}`;
    const now = Date.now();
    let entry = this.rateLimits.get(key);
    if (!entry) {
      entry = createRateLimitEntry(now);
      this.rateLimits.set(key, entry);
    }
    resetRateLimitWindows(entry, now);
    if (window === "hour") {
      return entry.hour.get(userId) ?? 0;
    }
    return entry.day.get(userId) ?? 0;
  }

  public incrementRateLimit(userId: string, jobType: string): void {
    const key = `${userId}:${jobType}`;
    const now = Date.now();
    let entry = this.rateLimits.get(key);
    if (!entry) {
      entry = createRateLimitEntry(now);
      this.rateLimits.set(key, entry);
    }
    resetRateLimitWindows(entry, now);
    entry.hour.set(userId, (entry.hour.get(userId) ?? 0) + 1);
    entry.day.set(userId, (entry.day.get(userId) ?? 0) + 1);
  }

  public allJobs(): Job[] {
    return [...this.jobs.values()].map(cloneJob);
  }
}

function createRateLimitEntry(now: number): RateLimitEntry {
  return {
    hour: new Map(),
    day: new Map(),
    hourReset: now + 3_600_000,
    dayReset: startOfNextUtcDay(now)
  };
}

function resetRateLimitWindows(entry: RateLimitEntry, now: number): void {
  if (now >= entry.hourReset) {
    entry.hour.clear();
    entry.hourReset = now + 3_600_000;
  }
  if (now >= entry.dayReset) {
    entry.day.clear();
    entry.dayReset = startOfNextUtcDay(now);
  }
}

function startOfNextUtcDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function cloneJob(job: Job): Job {
  return {
    ...job,
    params: { ...job.params },
    createdAt: new Date(job.createdAt),
    startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
    completedAt: job.completedAt ? new Date(job.completedAt) : undefined
  };
}

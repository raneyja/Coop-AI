import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { JobQueueConfig } from "../config/jobQueueConfig";
import { MemoryQueueBackend } from "./backends/memoryBackend";
import type { QueueBackend } from "./backends/types";
import { createQueueBackend } from "./backends/createBackend";
import type { JobRateLimiter } from "./rateLimit";
import { JobRateLimiter as RateLimiter } from "./rateLimit";
import { ResultStorage } from "./resultStorage";
import { reuseTtlForJobType } from "./jobReuse";
import {
  DEFAULT_ESTIMATED_DURATION_MS,
  type CreateJobInput,
  type Job,
  type JobLease,
  type JobProgressEvent,
  type JobStatus,
  type JobSubmitResponse,
  JobType,
  EFFECT_JOB_TYPES,
  formatWaitTime,
  serializeJob
} from "./types";

export type JobQueueEvents = {
  "job:enqueued": (job: Job) => void;
  "job:update": (event: JobProgressEvent) => void;
  "job:completed": (job: Job) => void;
  "job:failed": (job: Job) => void;
};

export type JobQueueSnapshot = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
};

export class JobQueue extends EventEmitter {
  private readonly backend: QueueBackend;
  private readonly rateLimiter: JobRateLimiter;
  public readonly results: ResultStorage;
  private waitTimeMs = 0;

  public constructor(
    private readonly config: JobQueueConfig,
    backend?: QueueBackend
  ) {
    super();
    this.backend = backend ?? createQueueBackend(config);
    this.rateLimiter = new RateLimiter(this.backend);
    this.results = new ResultStorage(config, this.backend);
  }

  public getBackend(): QueueBackend {
    return this.backend;
  }

  public getRateLimiter(): JobRateLimiter {
    return this.rateLimiter;
  }

  public async createJob(input: CreateJobInput): Promise<JobSubmitResponse> {
    const userId = input.userId ?? "anonymous";
    const reuseTtlMs = reuseTtlForJobType(input.type);
    const cached = await this.findCachedJob(userId, input.type, input.params, reuseTtlMs);
    if (cached) {
      return this.cachedJobResponse(cached);
    }

    const check = input.bypassRateLimit
      ? ({ allowed: true } as const)
      : await this.rateLimiter.canSubmitJob(userId, input.type);
    if (!check.allowed) {
      const fallback = await this.findCachedJob(userId, input.type, input.params, reuseTtlMs, true);
      if (fallback) {
        return this.cachedJobResponse(fallback);
      }
      throw new JobRateLimitError(check.reason, check.retryAfterMs);
    }

    const estimatedDurationMs =
      input.estimatedDurationMs ?? DEFAULT_ESTIMATED_DURATION_MS[input.type] ?? 120_000;
    let job: Job = {
      id: randomUUID(),
      type: input.type,
      status: "queued",
      priority: input.priority ?? "normal",
      params: input.params,
      userId,
      progress: 0,
      createdAt: new Date(),
      estimatedDurationMs,
      retryCount: 0,
      scheduled: input.scheduled
    };

    const saved = await this.backend.save(job);
    if (saved && saved.id !== job.id) return {jobId:saved.id,status:saved.status,estimatedWaitTimeMs:0,estimatedWaitTime:formatWaitTime(0),deduplicated:true};
    job = saved ?? job;
    if (this.backend.recordJobSubmission) {
      await this.backend.recordJobSubmission(userId, input.type);
    } else {
      this.rateLimiter.recordSubmission(userId, input.type);
    }
    this.updateWaitEstimate();
    const estimatedWaitTimeMs = this.estimateWaitForJob(job);
    this.emit("job:enqueued", job);
    this.emitProgress(job, "Job queued");

    return {
      jobId: job.id,
      status: "queued",
      estimatedWaitTimeMs,
      estimatedWaitTime: formatWaitTime(estimatedWaitTimeMs)
    };
  }

  public async getJob(id: string): Promise<Job | undefined> {
    return this.backend.get(id);
  }

  public async cancelJob(id: string, options?: { includeRunning?: boolean }): Promise<Job | undefined> {
    const job = await this.backend.cancel(id, options?.includeRunning === true);
    if (job) this.emitProgress(job, 'Job cancelled');
    return job;
  }

  public async claimNext(ownerId: string, leaseMs: number): Promise<Job | undefined> {
    if (!ownerId || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('Invalid worker lease');
    const job = await this.backend.claimNext(ownerId, leaseMs);
    if (job) this.emitProgress(job, 'Job started');
    return job;
  }

  public async renew(job: Job, leaseMs: number): Promise<boolean> {
    return this.backend.renew(job.id, jobLease(job), leaseMs);
  }

  public async reclaimExpired(maxRetries: number): Promise<number> {
    return this.backend.reclaimExpired(maxRetries);
  }

  public async updateProgress(job: Job, progress: number, message?: string): Promise<boolean> {
    const updated = await this.backend.updateOwned({...job, status: 'running', progress: Math.max(0, Math.min(100, progress))}, jobLease(job));
    if (!updated) return false;
    this.emitProgress(updated, message);
    return true;
  }

  public async completeJob(job: Job, result: unknown, status: 'completed' | 'partial' = 'completed'): Promise<Job | undefined> {
    job=structuredClone(job);result=structuredClone(result);
    const record = this.results.prepare(job.id, result, job.scheduled);
    const updated = await this.backend.updateOwned({...job, status, progress: 100, result,
      effectQuarantined: status === 'partial' && EFFECT_JOB_TYPES.includes(job.type), completedAt: new Date()}, jobLease(job), record);
    if (!updated) return undefined;
    this.results.remember(record);
    this.emitProgress(updated, 'Job completed');
    this.emit('job:completed', updated);
    return updated;
  }

  public async failJob(job: Job, error: string, partialResult?: unknown): Promise<Job | undefined> {
    job=structuredClone(job);partialResult=partialResult === undefined ? undefined : structuredClone(partialResult);
    const record = partialResult === undefined ? undefined : this.results.prepare(job.id, partialResult, job.scheduled);
    const updated = await this.backend.updateOwned({...job, status: record ? 'partial' : 'failed', error, result: partialResult,
      effectQuarantined: EFFECT_JOB_TYPES.includes(job.type), completedAt: new Date()}, jobLease(job), record);
    if (!updated) return undefined;
    if (record) this.results.remember(record);
    this.emitProgress(updated, error);
    this.emit('job:failed', updated);
    return updated;
  }

  public async requeue(job: Job, delayMs = 0, countRetry = true): Promise<void> {
    const updated = await this.backend.requeue(job.id, jobLease(job), delayMs, countRetry);
    if (!updated) return;
    this.emit('job:enqueued', updated);
    this.emitProgress(updated, countRetry ? `Retry ${updated.retryCount}` : 'Worker shutdown; job queued');
  }

  public snapshot(): JobQueueSnapshot {
    const memory = this.backend as MemoryQueueBackend;
    if (typeof memory.allJobs === "function") {
      const jobs = memory.allJobs();
      return summarize(jobs);
    }
    return { queued: 0, running: 0, completed: 0, failed: 0 };
  }

  public async snapshotAsync(): Promise<JobQueueSnapshot> {
    const jobs = await this.listAllJobs();
    return summarize(jobs);
  }

  public async listAllJobs(): Promise<Job[]> {
    const memory = this.backend as MemoryQueueBackend;
    if (typeof memory.allJobs === "function") {
      return memory.allJobs();
    }
    const statuses: JobStatus[] = ["queued", "running", "completed", "failed", "cancelled", "partial"];
    const buckets = await Promise.all(statuses.map((status) => this.backend.listByStatus([status])));
    return buckets.flat();
  }

  public toPublicJob(job: Job): Record<string, unknown> {
    return serializeJob(job);
  }

  private emitProgress(job: Job, message?: string): void {
    const etaMs = job.status === "running" ? estimateRemainingMs(job) : undefined;
    const event: JobProgressEvent = {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      etaMs,
      message
    };
    this.emit("job:update", event);
  }

  private estimateWaitForJob(job: Job): number {
    const ahead = this.waitTimeMs;
    this.waitTimeMs += job.estimatedDurationMs;
    return ahead;
  }

  private updateWaitEstimate(): void {
    const memory = this.backend as MemoryQueueBackend;
    if (typeof memory.allJobs !== "function") {
      return;
    }
    const queued = memory.allJobs().filter((j) => j.status === "queued");
    this.waitTimeMs = queued.reduce((sum, j) => sum + j.estimatedDurationMs, 0);
  }

  private async findCachedJob(
    userId: string,
    jobType: JobType,
    params: CreateJobInput["params"],
    reuseTtlMs: number | undefined,
    includeOlder = false
  ): Promise<Job | undefined> {
    if (reuseTtlMs && this.backend.findReusableCompletedJob) {
      const recent = await this.backend.findReusableCompletedJob(userId, jobType, params, reuseTtlMs);
      if (recent) {
        return recent;
      }
    }
    if (includeOlder && this.backend.findLatestCompletedJob) {
      return this.backend.findLatestCompletedJob(userId, jobType, params);
    }
    return undefined;
  }

  private cachedJobResponse(cached: Job): JobSubmitResponse {
    return {
      jobId: cached.id,
      status: cached.status,
      estimatedWaitTimeMs: 0,
      estimatedWaitTime: formatWaitTime(0),
      cached: true,
      completedAt: cached.completedAt?.toISOString()
    };
  }
}

export class JobRateLimitError extends Error {
  public constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "JobRateLimitError";
  }
}

export function jobLease(job: Job): JobLease {
  if (!job.ownerId || !job.attemptId) throw new Error('Running job has no admitted attempt');
  return {ownerId: job.ownerId, attemptId: job.attemptId};
}

function summarize(jobs: Job[]): JobQueueSnapshot {
  return {
    queued: jobs.filter((j) => j.status === "queued").length,
    running: jobs.filter((j) => j.status === "running").length,
    completed: jobs.filter((j) => j.status === "completed" || j.status === "partial").length,
    failed: jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length
  };
}

function estimateRemainingMs(job: Job): number {
  if (!job.startedAt) {
    return job.estimatedDurationMs;
  }
  const elapsed = Date.now() - job.startedAt.getTime();
  const ratio = Math.max(job.progress, 1) / 100;
  const totalEstimate = elapsed / ratio;
  return Math.max(0, Math.round(totalEstimate - elapsed));
}

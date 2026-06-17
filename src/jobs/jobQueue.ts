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
  type JobPriority,
  type JobProgressEvent,
  type JobStatus,
  type JobSubmitResponse,
  JobType,
  PRIORITY_WEIGHT,
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
    if (reuseTtlMs && this.backend.findReusableCompletedJob) {
      const cached = await this.backend.findReusableCompletedJob(userId, input.type, input.params, reuseTtlMs);
      if (cached) {
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

    const check = input.bypassRateLimit
      ? ({ allowed: true } as const)
      : await this.rateLimiter.canSubmitJob(userId, input.type);
    if (!check.allowed) {
      if (reuseTtlMs && this.backend.findReusableCompletedJob) {
        const cached = await this.backend.findReusableCompletedJob(userId, input.type, input.params, reuseTtlMs);
        if (cached) {
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
      throw new JobRateLimitError(check.reason, check.retryAfterMs);
    }

    const estimatedDurationMs =
      input.estimatedDurationMs ?? DEFAULT_ESTIMATED_DURATION_MS[input.type] ?? 120_000;
    const job: Job = {
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

    await this.backend.save(job);
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

  public async cancelJob(id: string): Promise<Job | undefined> {
    const job = await this.backend.get(id);
    if (!job || job.status !== "queued") {
      return undefined;
    }
    job.status = "cancelled";
    job.completedAt = new Date();
    job.error = "Cancelled by user";
    await this.backend.update(job);
    this.emitProgress(job, "Job cancelled");
    return job;
  }

  public async claimNext(): Promise<Job | undefined> {
    const job = this.backend.claimNext
      ? await this.backend.claimNext()
      : await this.claimNextInMemory();
    if (job) {
      this.emitProgress(job, "Job started");
    }
    return job;
  }

  private async claimNextInMemory(): Promise<Job | undefined> {
    const queued = await this.backend.listByStatus(["queued"]);
    if (queued.length === 0) {
      return undefined;
    }
    queued.sort(compareJobs);
    const job = queued[0];
    job.status = "running";
    job.startedAt = new Date();
    job.progress = 5;
    await this.backend.update(job);
    return job;
  }

  public async updateProgress(jobId: string, progress: number, message?: string): Promise<void> {
    const job = await this.backend.get(jobId);
    if (!job || job.status !== "running") {
      return;
    }
    job.progress = Math.max(0, Math.min(100, progress));
    await this.backend.update(job);
    this.emitProgress(job, message);
  }

  public async completeJob(jobId: string, result: unknown, status: JobStatus = "completed"): Promise<Job | undefined> {
    const job = await this.backend.get(jobId);
    if (!job) {
      return undefined;
    }
    job.status = status;
    job.progress = 100;
    job.result = result;
    job.completedAt = new Date();
    await this.backend.update(job);
    await this.results.store(jobId, result, job.scheduled);
    this.emitProgress(job, "Job completed");
    this.emit("job:completed", job);
    return job;
  }

  public async failJob(jobId: string, error: string, partialResult?: unknown): Promise<Job | undefined> {
    const job = await this.backend.get(jobId);
    if (!job) {
      return undefined;
    }
    job.status = partialResult ? "partial" : "failed";
    job.error = error;
    job.result = partialResult;
    job.completedAt = new Date();
    await this.backend.update(job);
    if (partialResult !== undefined) {
      await this.results.store(jobId, partialResult, job.scheduled);
    }
    this.emitProgress(job, error);
    this.emit("job:failed", job);
    return job;
  }

  public async requeue(job: Job): Promise<void> {
    job.status = "queued";
    job.startedAt = undefined;
    job.progress = 0;
    job.retryCount += 1;
    await this.backend.update(job);
    this.emit("job:enqueued", job);
    this.emitProgress(job, `Retry ${job.retryCount}`);
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

function compareJobs(a: Job, b: Job): number {
  const priority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  if (priority !== 0) {
    return priority;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
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

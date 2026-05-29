import { EventEmitter } from "node:events";
import type { JobQueueConfig } from "../config/jobQueueConfig";
import {
  JobCancelledError,
  JobTimeoutError,
  backoffDelayMs,
  classifyError,
  normalizeJobError,
  shouldRetry,
  type RetryPolicy
} from "./errorHandling";
import { executeJob, type JobExecutionContext } from "./executors";
import type { JobMonitor } from "./monitoring";
import type { JobQueue } from "./jobQueue";
import type { Job } from "./types";

export type WorkerPoolConfig = {
  concurrency: number;
  maxJobDurationMs: number;
  retryPolicy: RetryPolicy;
};

export class WorkerPool extends EventEmitter {
  private running = 0;
  private activeJobs = new Map<string, AbortController>();
  private stopped = false;
  private pollTimer?: ReturnType<typeof setInterval>;

  public constructor(
    private readonly queue: JobQueue,
    private readonly poolConfig: WorkerPoolConfig,
    private readonly executionContext: JobExecutionContext,
    private readonly monitor?: JobMonitor
  ) {
    super();
  }

  public start(pollIntervalMs = 500): void {
    this.stopped = false;
    void this.drain();
    this.pollTimer = setInterval(() => {
      void this.drain();
    }, pollIntervalMs);
  }

  public stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const controller of this.activeJobs.values()) {
      controller.abort();
    }
    this.activeJobs.clear();
  }

  public async drain(): Promise<void> {
    if (this.stopped) {
      return;
    }
    while (this.running < this.poolConfig.concurrency) {
      const job = await this.queue.claimNext();
      if (!job) {
        break;
      }
      this.running += 1;
      this.emit("job:start", job);
      void this.runJob(job).finally(() => {
        this.running -= 1;
        void this.drain();
      });
    }
  }

  public isJobActive(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  public get activeCount(): number {
    return this.running;
  }

  private async runJob(job: Job): Promise<void> {
    const controller = new AbortController();
    this.activeJobs.set(job.id, controller);
    const startedAt = Date.now();

    try {
      const result = await Promise.race([
        this.executeWithProgress(job, controller.signal),
        timeout(this.poolConfig.maxJobDurationMs)
      ]);
      const durationMs = Date.now() - startedAt;
      const status =
        typeof result === "object" && result !== null && (result as { status?: string }).status === "partial"
          ? "partial"
          : "completed";
      const completed = await this.queue.completeJob(job.id, result, status);
      if (completed) {
        this.monitor?.recordCompletion(completed, durationMs);
        this.emit("job:done", completed);
      }
    } catch (error) {
      await this.handleFailure(job, error, startedAt);
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private async executeWithProgress(job: Job, signal: AbortSignal): Promise<unknown> {
    const report = async (progress: number, message?: string) => {
      if (signal.aborted) {
        throw new JobCancelledError();
      }
      await this.queue.updateProgress(job.id, progress, message);
    };
    await report(10, "Initializing");
    const result = await executeJob(job, this.executionContext, report, signal);
    await report(100, "Finalizing");
    return result;
  }

  private async handleFailure(job: Job, error: unknown, startedAt: number): Promise<void> {
    const message = normalizeJobError(error);
    const classification = classifyError(error);

    if (classification === "cancelled") {
      await this.queue.failJob(job.id, message);
      return;
    }

    const fresh = await this.queue.getJob(job.id);
    if (!fresh) {
      return;
    }

    if (shouldRetry(error, fresh.retryCount, this.poolConfig.retryPolicy)) {
      const delay = backoffDelayMs(fresh.retryCount, this.poolConfig.retryPolicy);
      setTimeout(() => {
        void this.queue.requeue(fresh);
      }, delay);
      return;
    }

    const failed = await this.queue.failJob(job.id, message);
    if (failed) {
      this.monitor?.recordFailure(failed);
      this.monitor?.recordCompletion(failed, Date.now() - startedAt);
      this.emit("job:done", failed);
    }
    if (error instanceof JobTimeoutError) {
      this.monitor?.recordWorkerCrash(error);
    }
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new JobTimeoutError(ms)), ms);
  });
}

export function workerPoolConfigFromJobConfig(config: JobQueueConfig): WorkerPoolConfig {
  return {
    concurrency: config.workerConcurrency,
    maxJobDurationMs: config.maxJobDurationMs,
    retryPolicy: {
      maxRetries: 3,
      backoffMs: 1000
    }
  };
}

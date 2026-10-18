import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { JobQueueConfig } from '../config/jobQueueConfig';
import { JobCancelledError, JobTimeoutError, backoffDelayMs, normalizeJobError, shouldRetry, type RetryPolicy } from './errorHandling';
import { executeJob, type JobExecutionContext } from './executors';
import type { JobMonitor } from './monitoring';
import type { JobQueue } from './jobQueue';
import { EFFECT_JOB_TYPES, GRAPH_JOB_TYPES, type Job } from './types';
import { captureException } from '../server/observability/errorReporter';

export type WorkerPoolConfig = {
  concurrency: number;
  maxJobDurationMs: number;
  retryPolicy: RetryPolicy;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  shutdownTimeoutMs?: number;
};

class LostJobLeaseError extends JobCancelledError {}
class WorkerShutdownError extends JobCancelledError {}

export class WorkerPool extends EventEmitter {
  private readonly ownerId = randomUUID();
  private readonly activeJobs = new Map<string, AbortController>();
  private readonly tasks = new Set<Promise<void>>();
  private stopped = true;
  private draining = false;
  private pollTimer?: ReturnType<typeof setInterval>;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;

  public constructor(
    private readonly queue: JobQueue,
    private readonly poolConfig: WorkerPoolConfig,
    private readonly executionContext: JobExecutionContext,
    private readonly monitor?: JobMonitor,
    private readonly executor: typeof executeJob = executeJob
  ) {
    super();
    executionContext.cache.bindJobQueue(queue);
    this.leaseMs = poolConfig.leaseDurationMs ?? 30_000;
    this.heartbeatMs = poolConfig.heartbeatIntervalMs ?? 10_000;
    if (!Number.isInteger(poolConfig.concurrency) || poolConfig.concurrency < 1
      || ![this.heartbeatMs,this.leaseMs,poolConfig.maxJobDurationMs,poolConfig.shutdownTimeoutMs ?? 10_000].every(value => Number.isFinite(value) && value > 0)
      || this.heartbeatMs <= 0 || this.leaseMs <= this.heartbeatMs * 2
      || poolConfig.maxJobDurationMs <= 0) throw new Error('Invalid job worker lease/duration configuration');
  }

  public start(pollIntervalMs = 500): void {
    if (this.pollTimer || this.tasks.size) return;
    this.stopped = false;
    void this.drain();
    this.pollTimer = setInterval(() => void this.drain(), pollIntervalMs);
  }

  /** A false result requires process termination before starting a replacement. */
  public async stop(timeoutMs = this.poolConfig.shutdownTimeoutMs ?? 10_000): Promise<boolean> {
    this.stopClaims();
    for (const controller of this.activeJobs.values()) controller.abort(new WorkerShutdownError());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.waitUntilIdle().then(() => true),
        new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private stopClaims(): void {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async waitUntilIdle(): Promise<void> {
    while (this.draining || this.tasks.size) {
      if (this.tasks.size) await Promise.all([...this.tasks]);
      else await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  public async drain(): Promise<void> {
    if (this.stopped || this.draining) return;
    this.draining = true;
    try {
      await this.queue.reclaimExpired(this.poolConfig.retryPolicy.maxRetries);
      while (!this.stopped && this.tasks.size < this.poolConfig.concurrency) {
        const job = await this.queue.claimNext(this.ownerId, this.leaseMs);
        if (!job) break;
        if (this.stopped) { await this.queue.requeue(job, 0, false); break; }
        this.emit('job:start', job);
        const task = this.runJob(job).catch(error => {
          this.stopClaims();
          this.emit('worker:failure', error);
        });
        this.tasks.add(task);
        void task.then(() => { this.tasks.delete(task); void this.drain(); });
      }
    } catch (error) {
      this.stopClaims();
      this.emit('worker:failure', error);
    } finally { this.draining = false; }
  }

  public isJobActive(jobId: string): boolean { return this.activeJobs.has(jobId); }
  public get activeCount(): number { return this.tasks.size; }
  public get acceptingWork(): boolean { return !this.stopped; }

  private async runJob(job: Job): Promise<void> {
    const controller = new AbortController();
    this.activeJobs.set(job.id, controller);
    const startedAt = Date.now();
    const deadline = setTimeout(() => controller.abort(new JobTimeoutError(this.poolConfig.maxJobDurationMs)), this.poolConfig.maxJobDurationMs);
    let renewing = false;
    let monitoringOwnership = true;
    const isLiveAttempt = () => monitoringOwnership && this.activeJobs.get(job.id) === controller;
    const heartbeat = setInterval(() => {
      if (renewing || !isLiveAttempt()) return;
      renewing = true;
      void this.queue.renew(job, this.leaseMs).then(async owned => {
        if (owned || !isLiveAttempt()) return;
        const fresh = await this.queue.getJob(job.id);
        if (!isLiveAttempt()) return;
        if (fresh?.status === 'cancelled' && fresh.attemptId === job.attemptId) {
          controller.abort(new JobCancelledError());
        } else { this.stopClaims(); controller.abort(new LostJobLeaseError()); }
      }).catch(() => {
        if (!isLiveAttempt()) return;
        this.stopClaims(); controller.abort(new LostJobLeaseError('Worker lease could not be renewed'));
      }).finally(() => { renewing = false; });
    }, this.heartbeatMs);
    try {
      const report = async (progress: number, message?: string) => {
        controller.signal.throwIfAborted();
        if (!await this.queue.updateProgress(job, progress, message)) throw new LostJobLeaseError();
      };
      await report(10, 'Initializing');
      // Retain the concurrency slot until the actual executor settles, even if
      // it ignores cancellation. A timeout cannot authorize a competing effect.
      const result = await this.executor(job, this.executionContext, report, controller.signal);
      controller.signal.throwIfAborted();
      if(GRAPH_JOB_TYPES.includes(job.type)) await this.executionContext.cache.assertJobPublished(job,controller.signal);
      await report(100, 'Finalizing');
      const status = typeof result === 'object' && result !== null && (result as {status?: string}).status === 'partial' ? 'partial' : 'completed';
      // The executor and final progress have settled; terminal CAS now owns
      // the outcome. An in-flight renew must not revoke the pool after that CAS.
      monitoringOwnership = false;
      clearInterval(heartbeat);
      const completed = await this.queue.completeJob(job, result, status);
      if (!completed) throw new Error('Terminal job admission failed');
      this.emit('job:done', completed);
    } catch (error) {
      monitoringOwnership = false;
      clearInterval(heartbeat);
      await this.handleFailure(job, error, startedAt);
    } finally {
      monitoringOwnership = false;
      clearTimeout(deadline); clearInterval(heartbeat);
      this.executionContext.cache.finishJobPublication(job);
      this.activeJobs.delete(job.id);
    }
  }

  private async handleFailure(job: Job, error: unknown, startedAt: number): Promise<void> {
    if (error instanceof LostJobLeaseError) return;
    if (error instanceof WorkerShutdownError && !EFFECT_JOB_TYPES.includes(job.type)) { await this.queue.requeue(job, 0, false); return; }
    if (!EFFECT_JOB_TYPES.includes(job.type) && shouldRetry(error, job.retryCount, this.poolConfig.retryPolicy)) {
      await this.queue.requeue(job, backoffDelayMs(job.retryCount, this.poolConfig.retryPolicy));
      return;
    }
    const failed = await this.queue.failJob(job, normalizeJobError(error));
    if (failed) {
      this.monitor?.recordCompletion(failed, Date.now() - startedAt);
      this.emit('job:done', failed);
      captureException(error, {jobId: failed.id, attemptId: failed.attemptId, jobType: failed.type,
        orgId: typeof failed.params.orgId === 'string' ? failed.params.orgId : undefined, route: 'job'});
    }
    if (error instanceof JobTimeoutError) this.monitor?.recordWorkerCrash(error);
  }
}

export function workerPoolConfigFromJobConfig(config: JobQueueConfig): WorkerPoolConfig {
  return {concurrency: config.workerConcurrency, maxJobDurationMs: config.maxJobDurationMs,
    leaseDurationMs: config.leaseDurationMs, heartbeatIntervalMs: config.heartbeatIntervalMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs, retryPolicy: {maxRetries: 3, backoffMs: 1000}};
}

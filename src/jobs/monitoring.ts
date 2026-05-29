import type { Job } from "./types";
import type { JobQueue } from "./jobQueue";

export type QueueStats = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  failedLast24h: number;
  avgDurationMs: number;
  successRate: number;
  alerts: string[];
};

export type JobMonitoringOptions = {
  queueDepthAlertThreshold: number;
  failureRateAlertThreshold: number;
};

export class JobMonitor {
  private readonly completedDurations: number[] = [];
  private readonly failures24h: { at: Date; jobId: string; error: string }[] = [];
  private workerCrashes = 0;

  public constructor(private readonly options: JobMonitoringOptions) {}

  public recordCompletion(job: Job, durationMs: number): void {
    this.completedDurations.push(durationMs);
    if (this.completedDurations.length > 500) {
      this.completedDurations.shift();
    }
  }

  public recordFailure(job: Job): void {
    this.failures24h.push({
      at: new Date(),
      jobId: job.id,
      error: job.error ?? "unknown"
    });
    this.pruneFailures();
  }

  public recordWorkerCrash(error: unknown): void {
    this.workerCrashes += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[jobs] worker crash #${this.workerCrashes}: ${message}`);
  }

  public getStats(queue: JobQueue): QueueStats {
    const snapshot = queue.snapshot();
    const failedLast24h = this.failuresInLast24h().length;
    const totalFinished = snapshot.completed + snapshot.failed + failedLast24h;
    const successRate =
      totalFinished === 0 ? 1 : (snapshot.completed + failedLast24h > 0 ? snapshot.completed / totalFinished : 1);

    const alerts: string[] = [];
    if (snapshot.queued > this.options.queueDepthAlertThreshold) {
      alerts.push(`Queue depth ${snapshot.queued} exceeds threshold ${this.options.queueDepthAlertThreshold}`);
    }
    const failureRate = totalFinished === 0 ? 0 : failedLast24h / Math.max(1, totalFinished);
    if (failureRate > this.options.failureRateAlertThreshold) {
      alerts.push(`Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold`);
    }
    if (this.workerCrashes > 0) {
      alerts.push(`Worker crashes detected: ${this.workerCrashes}`);
    }

    return {
      queued: snapshot.queued,
      running: snapshot.running,
      completed: snapshot.completed,
      failed: snapshot.failed,
      failedLast24h,
      avgDurationMs: average(this.completedDurations),
      successRate: Math.min(1, Math.max(0, successRate)),
      alerts
    };
  }

  public recentFailures(limit = 25): Array<{ at: string; jobId: string; error: string }> {
    this.pruneFailures();
    return this.failures24h.slice(-limit).map((entry) => ({
      at: entry.at.toISOString(),
      jobId: entry.jobId,
      error: entry.error
    }));
  }

  private failuresInLast24h(): typeof this.failures24h {
    this.pruneFailures();
    return this.failures24h;
  }

  private pruneFailures(): void {
    const cutoff = Date.now() - 86_400_000;
    this.failures24h.splice(
      0,
      this.failures24h.findIndex((entry) => entry.at.getTime() >= cutoff)
    );
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

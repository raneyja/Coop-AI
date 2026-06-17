import type { JobQueueConfig } from "../config/jobQueueConfig";
import { loadJobQueueConfig } from "../config/jobQueueConfig";
import type { GraphCache } from "../cache/graphCache";
import type { GraphConsistencyManager } from "../cache/graphConsistency";
import { JobQueue } from "./jobQueue";
import { JobMonitor } from "./monitoring";
import { JobScheduler } from "./scheduler";
import { WorkerPool, workerPoolConfigFromJobConfig } from "./workerPool";

export type JobRuntime = {
  config: JobQueueConfig;
  queue: JobQueue;
  monitor: JobMonitor;
  workers: WorkerPool;
  scheduler: JobScheduler;
  reclaimTimer?: ReturnType<typeof setInterval>;
};

import type { OrgStore } from "../server/orgStore";

export function createJobRuntime(options: {
  config?: JobQueueConfig;
  cache: GraphCache;
  consistency?: GraphConsistencyManager;
  orgStore?: OrgStore;
  allowPatFallback?: boolean;
}): JobRuntime {
  const config = options.config ?? loadJobQueueConfig();
  const queue = new JobQueue(config);
  const monitor = new JobMonitor({
    queueDepthAlertThreshold: config.queueDepthAlertThreshold,
    failureRateAlertThreshold: config.failureRateAlertThreshold
  });
  const workers = new WorkerPool(
    queue,
    workerPoolConfigFromJobConfig(config),
    {
      cache: options.cache,
      consistency: options.consistency,
      orgStore: options.orgStore,
      allowPatFallback: options.allowPatFallback
    },
    monitor
  );
  const scheduler = new JobScheduler(
    queue,
    config,
    {
      notify: async (payload) => {
        console.log(`[jobs] scheduled notification: ${payload.name} -> ${payload.jobId}`);
      }
    },
    options.orgStore
  );

  queue.on("job:completed", (job) => {
    if (job.startedAt && job.completedAt) {
      monitor.recordCompletion(job, job.completedAt.getTime() - job.startedAt.getTime());
    }
  });
  queue.on("job:failed", (job) => monitor.recordFailure(job));

  return { config, queue, monitor, workers, scheduler };
}

export async function startJobRuntime(
  runtime: JobRuntime,
  options?: {
    reclaimStaleJobs?: () => Promise<number>;
    periodicReclaim?: () => Promise<number>;
    reclaimIntervalMs?: number;
  }
): Promise<void> {
  if (options?.reclaimStaleJobs) {
    const reclaimed = await options.reclaimStaleJobs();
    if (reclaimed > 0) {
      console.log(`[jobs] reclaimed ${reclaimed} orphaned running job(s) on startup`);
    }
  }
  runtime.workers.start();
  void runtime.scheduler.start();

  if (options?.periodicReclaim && options.reclaimIntervalMs) {
    runtime.reclaimTimer = setInterval(() => {
      void options.periodicReclaim!().then((reclaimed) => {
        if (reclaimed > 0) {
          console.log(`[jobs] reclaimed ${reclaimed} stale running job(s)`);
        }
      });
    }, options.reclaimIntervalMs);
  }
}

export function stopJobRuntime(runtime: JobRuntime): void {
  if (runtime.reclaimTimer) {
    clearInterval(runtime.reclaimTimer);
    runtime.reclaimTimer = undefined;
  }
  runtime.workers.stop();
  runtime.scheduler.stop();
}

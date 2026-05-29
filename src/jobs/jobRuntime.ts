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
};

export function createJobRuntime(options: {
  config?: JobQueueConfig;
  cache: GraphCache;
  consistency?: GraphConsistencyManager;
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
    { cache: options.cache, consistency: options.consistency },
    monitor
  );
  const scheduler = new JobScheduler(queue, config, {
    notify: async (payload) => {
      console.log(`[jobs] scheduled notification: ${payload.name} -> ${payload.jobId}`);
    }
  });

  queue.on("job:completed", (job) => {
    if (job.startedAt && job.completedAt) {
      monitor.recordCompletion(job, job.completedAt.getTime() - job.startedAt.getTime());
    }
  });
  queue.on("job:failed", (job) => monitor.recordFailure(job));

  return { config, queue, monitor, workers, scheduler };
}

export function startJobRuntime(runtime: JobRuntime): void {
  runtime.workers.start();
  void runtime.scheduler.start();
}

export function stopJobRuntime(runtime: JobRuntime): void {
  runtime.workers.stop();
  runtime.scheduler.stop();
}

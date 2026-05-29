import type { JobQueueConfig } from "../config/jobQueueConfig";
import type { JobQueue } from "./jobQueue";
import { JobType } from "./types";

type CronTask = {
  stop: () => void;
};

export type ScheduledJobNotifier = {
  notify: (payload: { name: string; jobId: string; jobType: JobType }) => Promise<void>;
};

export class JobScheduler {
  private tasks: CronTask[] = [];
  private purgeTimer?: ReturnType<typeof setInterval>;

  public constructor(
    private readonly queue: JobQueue,
    private readonly config: JobQueueConfig,
    private readonly notifier?: ScheduledJobNotifier
  ) {}

  public async start(): Promise<void> {
    const cron = await import("node-cron");
    for (const schedule of this.config.schedules) {
      if (!cron.validate(schedule.trigger)) {
        console.warn(`[jobs] invalid cron expression: ${schedule.trigger} (${schedule.name})`);
        continue;
      }
      const task = cron.schedule(schedule.trigger, () => {
        void this.enqueueScheduled(schedule.name, schedule.jobType, schedule.priority, schedule.params);
      });
      this.tasks.push(task);
      console.log(`[jobs] scheduled "${schedule.name}" with cron ${schedule.trigger}`);
    }

    this.purgeTimer = setInterval(() => {
      void this.queue.results.purgeExpired();
    }, 60 * 60 * 1000);
  }

  public stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = undefined;
    }
  }

  private async enqueueScheduled(
    name: string,
    jobType: JobType,
    priority: "high" | "normal" | "low",
    params?: Record<string, unknown>
  ): Promise<void> {
    try {
      const response = await this.queue.createJob({
        type: jobType,
        priority,
        params: params ?? { scope: "scheduled" },
        userId: "system",
        scheduled: true
      });
      await this.notifier?.notify({ name, jobId: response.jobId, jobType });
      console.log(`[jobs] enqueued scheduled job ${name}: ${response.jobId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jobs] failed to enqueue scheduled job ${name}: ${message}`);
    }
  }
}

export function jobTypeFromString(value: string): JobType {
  const normalized = value as JobType;
  if (Object.values(JobType).includes(normalized)) {
    return normalized;
  }
  throw new Error(`Unknown job type: ${value}`);
}

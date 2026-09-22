import type { JobQueueConfig } from "../config/jobQueueConfig";
import type { JobQueue } from "./jobQueue";
import { JobType } from "./types";
import type { OrgStore } from "../server/orgStore";
import { queueOrgRepoIndex } from "../server/queueOrgRepoIndex";

/**
 * Max nightly Deep-Index jobs queued per org per scheduler run.
 * Repos past the cap wait until the next night so one org cannot fill the queue.
 */
export const MAX_NIGHTLY_INDEX_JOBS_PER_ORG = 25;

export type NightlyIndexTarget = { orgId: string; repoId: string };

/** Round-robin across orgs, at most `cap` repos from each org. */
export function planNightlyIndexBatch(
  targets: NightlyIndexTarget[],
  cap = MAX_NIGHTLY_INDEX_JOBS_PER_ORG
): NightlyIndexTarget[] {
  const queues = new Map<string, NightlyIndexTarget[]>();
  for (const target of targets) {
    const list = queues.get(target.orgId) ?? [];
    list.push(target);
    queues.set(target.orgId, list);
  }
  const orgIds = [...queues.keys()];
  const counts = new Map<string, number>();
  const selected: NightlyIndexTarget[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const orgId of orgIds) {
      const used = counts.get(orgId) ?? 0;
      if (used >= cap) {
        continue;
      }
      const next = queues.get(orgId)?.shift();
      if (!next) {
        continue;
      }
      selected.push(next);
      counts.set(orgId, used + 1);
      progressed = true;
    }
  }
  return selected;
}

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
    private readonly notifier?: ScheduledJobNotifier,
    private readonly orgStore?: OrgStore
  ) {}

  public async start(): Promise<void> {
    const cron = await import("node-cron");
    for (const schedule of this.config.schedules) {
      if (!cron.validate(schedule.trigger)) {
        console.warn(`[jobs] invalid cron expression: ${schedule.trigger} (${schedule.name})`);
        continue;
      }
      const task = cron.schedule(schedule.trigger, () => {
        void this.enqueueScheduled(
          schedule.name,
          schedule.jobType,
          schedule.priority,
          schedule.params
        );
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
      if (jobType === JobType.INDEX_REPOSITORY && params?.scope === "nightly-index-all") {
        await this.enqueueNightlyIndexJobs(name);
        return;
      }

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

  /** Nightly Deep-Index is always priority low, even if the schedule row says otherwise. */
  private async enqueueNightlyIndexJobs(name: string): Promise<void> {
    if (!this.orgStore) {
      console.warn(`[jobs] skipping ${name}: organization database not configured`);
      return;
    }

    const targets = await this.orgStore.listLightningEnabledReposForScheduledIndex();
    const summary = await enqueueNightlyIndexTargets({
      name,
      priority: "low",
      targets,
      orgStore: this.orgStore,
      queue: this.queue,
      notify: (payload) => this.notifier?.notify(payload) ?? Promise.resolve()
    });
    console.log(
      `[jobs] ${name}: nightly queued=${summary.queued} skipped=${summary.skipped} failed=${summary.failed}`
    );
  }
}

export async function enqueueNightlyIndexTargets(input: {
  name: string;
  priority: "high" | "normal" | "low";
  targets: NightlyIndexTarget[];
  orgStore: OrgStore;
  queue: JobQueue;
  notify?: (payload: { name: string; jobId: string; jobType: JobType }) => Promise<void>;
  cap?: number;
}): Promise<{ queued: number; skipped: number; failed: number }> {
  if (input.targets.length === 0) {
    console.log(`[jobs] ${input.name}: no lightning-enabled repos`);
    return { queued: 0, skipped: 0, failed: 0 };
  }

  const planned = planNightlyIndexBatch(input.targets, input.cap);
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const target of planned) {
    try {
      const result = await queueOrgRepoIndex(target.orgId, target.repoId, {
        orgStore: input.orgStore,
        jobQueue: input.queue,
        userId: "system",
        priority: input.priority
      });
      if (result.outcome === "queued" && result.jobId) {
        queued += 1;
        await input.notify?.({
          name: input.name,
          jobId: result.jobId,
          jobType: JobType.INDEX_REPOSITORY
        });
      } else if (result.outcome === "skipped") {
        skipped += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[jobs] failed to enqueue nightly index for ${target.orgId}/${target.repoId}: ${message}`
      );
    }
  }
  return { queued, skipped, failed };
}

export function jobTypeFromString(value: string): JobType {
  const normalized = value as JobType;
  if (Object.values(JobType).includes(normalized)) {
    return normalized;
  }
  throw new Error(`Unknown job type: ${value}`);
}

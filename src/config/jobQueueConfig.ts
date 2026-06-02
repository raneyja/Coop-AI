import { JobType, type JobPriority } from "../jobs/types";

export type JobQueueBackend = "memory" | "postgres" | "redis";

export type JobScheduleConfig = {
  name: string;
  trigger: string;
  jobType: JobType;
  priority: JobPriority;
  params?: Record<string, unknown>;
};

export type JobQueueConfig = {
  backend: JobQueueBackend;
  workerConcurrency: number;
  maxJobDurationMs: number;
  resultRetentionDays: number;
  scheduledRetentionDays: number;
  databaseUrl?: string;
  redisUrl?: string;
  apiToken?: string;
  queueDepthAlertThreshold: number;
  failureRateAlertThreshold: number;
  schedules: JobScheduleConfig[];
};

const DEFAULT_SCHEDULES: JobScheduleConfig[] = [
  {
    // TODO: filter by org plan before enqueuing — currently runs for all orgs regardless of plan (tracked for Session 8 collection model work).
    name: "Index All Repos Nightly",
    trigger: "0 2 * * *",
    jobType: JobType.INDEX_REPOSITORY,
    priority: "low"
  },
  {
    name: "Scan Knowledge Gaps Weekly",
    trigger: "0 3 * * 0",
    jobType: JobType.SCAN_KNOWLEDGE_GAPS,
    priority: "low"
  }
];

export function loadJobQueueConfig(env: NodeJS.ProcessEnv = process.env): JobQueueConfig {
  return {
    backend: readBackend(env.JOBS_BACKEND),
    workerConcurrency: readNumber(env.JOBS_WORKER_CONCURRENCY, 2),
    maxJobDurationMs: readNumber(env.JOBS_MAX_DURATION_MS, 300_000),
    resultRetentionDays: readNumber(env.JOBS_RESULT_RETENTION_DAYS, 7),
    scheduledRetentionDays: readNumber(env.JOBS_SCHEDULED_RETENTION_DAYS, 30),
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    apiToken: env.COOP_JOBS_API_TOKEN ?? env.COOP_API_TOKEN,
    queueDepthAlertThreshold: readNumber(env.JOBS_QUEUE_ALERT_THRESHOLD, 50),
    failureRateAlertThreshold: readNumber(env.JOBS_FAILURE_RATE_THRESHOLD, 0.05),
    schedules: DEFAULT_SCHEDULES
  };
}

function readBackend(value: string | undefined): JobQueueBackend {
  if (value === "postgres" || value === "redis") {
    return value;
  }
  return "memory";
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

import { JobType } from "./types";
import type { QueueBackend } from "./backends/types";
import type { MemoryQueueBackend } from "./backends/memoryBackend";

export type RateLimitWindow = {
  perDay: number;
  perHour: number;
};

export const RATE_LIMITS: Partial<Record<JobType, RateLimitWindow>> = {
  [JobType.SCAN_KNOWLEDGE_GAPS]: { perDay: 5, perHour: 1 },
  [JobType.BUILD_DEPENDENCY_GRAPH]: { perDay: 10, perHour: 3 },
  [JobType.INDEX_REPOSITORY]: { perDay: 3, perHour: 1 },
  [JobType.ANALYZE_OWNERSHIP]: { perDay: 20, perHour: 5 },
  [JobType.GENERATE_REPO_SUMMARY]: { perDay: 20, perHour: 5 }
};

export type RateLimitCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterMs: number };

export class JobRateLimiter {
  public constructor(private readonly backend: QueueBackend) {}

  public async canSubmitJob(userId: string, jobType: JobType): Promise<RateLimitCheckResult> {
    const limits = RATE_LIMITS[jobType];
    if (!limits || !userId) {
      return { allowed: true };
    }

    const jobsToday = await this.backend.countJobsForUser(userId, jobType, "today");
    const jobsThisHour = await this.backend.countJobsForUser(userId, jobType, "hour");

    if (jobsToday >= limits.perDay) {
      return {
        allowed: false,
        reason: `Daily limit reached (${limits.perDay} ${jobType} jobs per day)`,
        retryAfterMs: msUntilUtcDayEnd()
      };
    }
    if (jobsThisHour >= limits.perHour) {
      return {
        allowed: false,
        reason: `Hourly limit reached (${limits.perHour} ${jobType} jobs per hour)`,
        retryAfterMs: 3_600_000
      };
    }
    return { allowed: true };
  }

  public recordSubmission(userId: string | undefined, jobType: JobType): void {
    if (!userId) {
      return;
    }
    const memory = this.backend as MemoryQueueBackend;
    if (typeof memory.incrementRateLimit === "function") {
      memory.incrementRateLimit(userId, jobType);
    }
  }
}

function msUntilUtcDayEnd(): number {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return end.getTime() - now.getTime();
}

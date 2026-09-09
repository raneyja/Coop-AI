import type { Job, JobParams, JobType } from "./types";
import { JobType as JobTypeEnum } from "./types";
import { knowledgeGapScanGapsWithoutInfra } from "../context/knowledgeGapScanCoverage";

/** Reuse a completed scan when the user re-runs the same action within this window. */
export const KNOWLEDGE_GAPS_REUSE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const JOB_REUSE_TTL_MS: Partial<Record<JobType, number>> = {
  [JobTypeEnum.SCAN_KNOWLEDGE_GAPS]: KNOWLEDGE_GAPS_REUSE_TTL_MS,
  [JobTypeEnum.BUILD_DEPENDENCY_GRAPH]: KNOWLEDGE_GAPS_REUSE_TTL_MS
};

export function reuseTtlForJobType(jobType: JobType): number | undefined {
  return JOB_REUSE_TTL_MS[jobType];
}

export function jobParamsMatch(stored: JobParams, requested: JobParams): boolean {
  const storedRepoId = normalizeJobParam(stored.repoId);
  const requestedRepoId = normalizeJobParam(requested.repoId);
  if (!storedRepoId || !requestedRepoId || storedRepoId !== requestedRepoId) {
    return false;
  }
  return normalizeJobParam(stored.file) === normalizeJobParam(requested.file);
}

export function isReusableJob(job: Job, maxAgeMs: number, requestedParams: JobParams): boolean {
  if (job.status !== "completed" && job.status !== "partial") {
    return false;
  }
  if (!job.completedAt || job.result === undefined) {
    return false;
  }
  if (Date.now() - job.completedAt.getTime() > maxAgeMs) {
    return false;
  }
  if (!jobParamsMatch(job.params, requestedParams)) {
    return false;
  }
  if (job.type === JobTypeEnum.SCAN_KNOWLEDGE_GAPS && !knowledgeGapJobResultIsReusable(job.result)) {
    return false;
  }
  return true;
}

/** Do not reuse a scan whose only "gaps" are Coop missing a dependency graph. */
export function knowledgeGapJobResultIsReusable(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return false;
  }
  const record = result as { gaps?: unknown[]; scanCoverage?: unknown; foundGaps?: number };
  const gaps = Array.isArray(record.gaps) ? record.gaps : [];
  if (gaps.length > 0) {
    return knowledgeGapScanGapsWithoutInfra(gaps).length > 0;
  }
  if (record.scanCoverage === "scan_incomplete") {
    return false;
  }
  return true;
}

export function pickNewestReusableJob(
  jobs: Job[],
  maxAgeMs: number,
  requestedParams: JobParams
): Job | undefined {
  return jobs
    .filter((job) => isReusableJob(job, maxAgeMs, requestedParams))
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];
}

export function pickNewestMatchingCompletedJob(
  jobs: Job[],
  requestedParams: JobParams
): Job | undefined {
  return pickNewestReusableJob(jobs, Number.MAX_SAFE_INTEGER, requestedParams);
}

function normalizeJobParam(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

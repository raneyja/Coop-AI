export enum JobType {
  SCAN_KNOWLEDGE_GAPS = "scan_knowledge_gaps",
  BUILD_DEPENDENCY_GRAPH = "build_dependency_graph",
  INDEX_REPOSITORY = "index_repository",
  ANALYZE_OWNERSHIP = "analyze_ownership",
  GENERATE_REPO_SUMMARY = "generate_repo_summary"
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "partial";
export type JobPriority = "high" | "normal" | "low";

export type JobParams = Record<string, unknown>;

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: JobPriority;
  params: JobParams;
  userId?: string;
  progress: number;
  result?: unknown;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedDurationMs: number;
  retryCount: number;
  scheduled?: boolean;
}

export interface JobResultRecord {
  jobId: string;
  result: unknown;
  resultSize: number;
  storedAt: Date;
  expiresAt: Date;
  accessCount: number;
}

export interface JobProgressEvent {
  jobId: string;
  status: JobStatus;
  progress: number;
  etaMs?: number;
  message?: string;
}

export interface CreateJobInput {
  type: JobType;
  priority?: JobPriority;
  params: JobParams;
  userId?: string;
  estimatedDurationMs?: number;
  scheduled?: boolean;
}

export interface JobSubmitResponse {
  jobId: string;
  status: JobStatus;
  estimatedWaitTimeMs: number;
  estimatedWaitTime: string;
}

export const PRIORITY_WEIGHT: Record<JobPriority, number> = {
  high: 0,
  normal: 1,
  low: 2
};

export const DEFAULT_ESTIMATED_DURATION_MS: Record<JobType, number> = {
  [JobType.SCAN_KNOWLEDGE_GAPS]: 180_000,
  [JobType.BUILD_DEPENDENCY_GRAPH]: 120_000,
  [JobType.INDEX_REPOSITORY]: 300_000,
  [JobType.ANALYZE_OWNERSHIP]: 90_000,
  [JobType.GENERATE_REPO_SUMMARY]: 60_000
};

export function formatWaitTime(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  }
  const minutes = Math.round(ms / 60_000);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function serializeJob(job: Job): Record<string, unknown> {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    priority: job.priority,
    params: job.params,
    userId: job.userId,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    estimatedDurationMs: job.estimatedDurationMs,
    retryCount: job.retryCount,
    scheduled: job.scheduled
  };
}

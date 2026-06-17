import type { Job, JobParams, JobStatus, JobType } from "../types";

export interface QueueBackend {
  readonly name: string;
  save(job: Job): Promise<void>;
  get(id: string): Promise<Job | undefined>;
  listByStatus(statuses: JobStatus[]): Promise<Job[]>;
  update(job: Job): Promise<void>;
  delete(id: string): Promise<boolean>;
  countJobsForUser(userId: string, jobType: string, window: "hour" | "today"): Promise<number>;
  recordJobSubmission?(userId: string, jobType: JobType): Promise<void>;
  findReusableCompletedJob?(
    userId: string,
    jobType: JobType,
    params: JobParams,
    maxAgeMs: number
  ): Promise<Job | undefined>;
  findActiveIndexJob?(
    orgId: string,
    repoId: string
  ): Promise<{ jobId: string; status: "queued" | "running" } | undefined>;
  claimNext?(): Promise<Job | undefined>;
}

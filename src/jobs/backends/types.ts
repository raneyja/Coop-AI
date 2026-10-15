import type { Job, JobLease, JobParams, JobResultRecord, JobStatus, JobType } from "../types";

export interface QueueBackend {
  readonly name: string;
  save(job: Job): Promise<Job | void>;
  /** Process-local synchronous ownership linearization; absent on durable backends. */
  publishMemoryGraph?(job: Job, repoId: string, publish?: () => void): string;
  getMemoryGraphHead?(orgId:string,repoId:string): {generation:string;requestedGeneration:string;revision:string;origin:string};
  mutateMemoryGraph?(orgId: string, repoId: string, baseRevision: string, publish: () => void): string;
  get(id: string): Promise<Job | undefined>;
  listByStatus(statuses: JobStatus[]): Promise<Job[]>;
  updateOwned(job: Job, lease: JobLease, result?: JobResultRecord): Promise<Job | undefined>;
  cancel(id: string, includeRunning: boolean): Promise<Job | undefined>;
  renew(id: string, lease: JobLease, leaseMs: number): Promise<boolean>;
  requeue(id: string, lease: JobLease, delayMs: number, countRetry: boolean): Promise<Job | undefined>;
  reclaimExpired(maxRetries: number): Promise<number>;
  delete(id: string): Promise<boolean>;
  countJobsForUser(userId: string, jobType: string, window: "hour" | "today"): Promise<number>;
  recordJobSubmission?(userId: string, jobType: JobType): Promise<void>;
  findReusableCompletedJob?(
    userId: string,
    jobType: JobType,
    params: JobParams,
    maxAgeMs: number
  ): Promise<Job | undefined>;
  findLatestCompletedJob?(
    userId: string,
    jobType: JobType,
    params: JobParams
  ): Promise<Job | undefined>;
  findActiveIndexJob?(
    orgId: string,
    repoId: string
  ): Promise<{ jobId: string; status: "queued" | "running" } | undefined>;
  claimNext(ownerId: string, leaseMs: number): Promise<Job | undefined>;
}

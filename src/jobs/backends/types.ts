import type { Job, JobStatus } from "../types";

export interface QueueBackend {
  readonly name: string;
  save(job: Job): Promise<void>;
  get(id: string): Promise<Job | undefined>;
  listByStatus(statuses: JobStatus[]): Promise<Job[]>;
  update(job: Job): Promise<void>;
  delete(id: string): Promise<boolean>;
  countJobsForUser(userId: string, jobType: string, window: "hour" | "today"): Promise<number>;
}

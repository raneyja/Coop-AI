import { randomUUID } from "node:crypto";
import { EFFECT_JOB_TYPES, GRAPH_JOB_TYPES, JobType as Types } from '../types';
import type { Job, JobLease, JobParams, JobResultRecord, JobStatus, JobType } from "../types";
import { pickNewestMatchingCompletedJob, pickNewestReusableJob } from "../jobReuse";
import { effectJobsConflict } from '../effectJobConcurrency';
import type { QueueBackend } from "./types";

type RateLimitEntry = {
  hour: Map<string, number>;
  day: Map<string, number>;
  hourReset: number;
  dayReset: number;
};

export class MemoryQueueBackend implements QueueBackend {
  public readonly name = "memory";
  private readonly jobs = new Map<string, Job>();
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  private readonly graphHeads = new Map<string, {requested: bigint; published: bigint; revision: bigint; jobId?: string}>();

  public async save(job: Job): Promise<Job> {
    const previous = this.jobs.get(job.id);
    if(previous) return cloneJob(previous);
    const stored = cloneJob(job);
    if (EFFECT_JOB_TYPES.includes(job.type)) {
      const orgId = String(job.params.orgId ?? '').trim(), repoId = String(job.params.repoId ?? '').trim();
      const repos = repoId ? [repoId] : job.type === Types.BUILD_STRUCTURE_MANIFEST && Array.isArray(job.params.repoIds)
        ? job.params.repoIds.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
      if (!orgId || !repos.length) throw new Error('Memory effect submission requires an explicit organization/repository scope');
      const active = job.type === Types.INDEX_REPOSITORY && [...this.jobs.values()].find(item => item.type===job.type &&
        item.params.orgId===orgId && item.params.repoId===repoId && this.head(orgId,repoId).jobId===item.id && (item.status==='queued'||item.status==='running'));
      if(active) return cloneJob(active);
      stored.graphGenerations = [...new Set(repos)].sort().map(repoId => {
        const head=this.head(orgId,repoId);
        if(GRAPH_JOB_TYPES.includes(job.type)) {
          head.requested++;head.jobId=job.id;
          for(const previous of this.jobs.values()) {
            if(previous.status==='queued' && previous.graphGenerations?.some(item=>item.orgId===orgId&&item.repoId===repoId&&item.generation!==String(head.requested))) {
              Object.assign(previous,{status:'cancelled',completedAt:new Date(),error:'Queued graph generation superseded'});
            }
          }
        }
        return {orgId,repoId,generation:String(head.requested)};
      });
    }
    this.jobs.set(job.id,stored);
    return cloneJob(stored);
  }

  private head(orgId: string,repoId: string) {
    const key=orgId+'\0'+repoId;
    let head=this.graphHeads.get(key);
    if(!head) {head={requested:0n,published:0n,revision:0n};this.graphHeads.set(key,head);}
    return head;
  }

  public publishMemoryGraph(job: Job,repoId: string,publish?: () => void): string {
    const current=this.owned(job.id,{ownerId:job.ownerId ?? '',attemptId:job.attemptId ?? ''});
    const token=current?.graphGenerations?.find(item=>item.repoId===repoId && item.orgId===String(job.params.orgId));
    if(!current || [...this.jobs.values()].some(item=>item.effectQuarantined) || current.userId!==job.userId || current.type!==job.type || JSON.stringify(current.params)!==JSON.stringify(job.params)
      || JSON.stringify(current.graphGenerations)!==JSON.stringify(job.graphGenerations) || !token) throw new Error('Memory graph attempt not owned');
    const head=this.head(token.orgId,repoId);
    if(String(head.requested)!==token.generation || head.jobId!==job.id) throw new Error('Memory graph generation superseded');
    if(publish) { publish(); head.published=head.requested;head.revision++; } // Synchronous ownership/install.
    return String(head.revision);
  }

  public getMemoryGraphHead(orgId:string,repoId:string) {
    const head=this.head(orgId,repoId);
    return {generation:String(head.published),requestedGeneration:String(head.requested),revision:String(head.revision),origin:'memory-process-local'};
  }

  public mutateMemoryGraph(orgId: string,repoId: string,baseRevision: string,publish: () => void): string {
    const head=this.head(orgId,repoId);
    if(String(head.revision)!==baseRevision || head.requested!==head.published
      || [...this.jobs.values()].some(job=>job.effectQuarantined || job.status==='running' && EFFECT_JOB_TYPES.includes(job.type))) {
      throw new Error('Memory standalone graph publication conflicted');
    }
    publish();head.requested++;head.published=head.requested;head.revision++;head.jobId=undefined;
    return String(head.revision);
  }

  public async get(id: string): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  public async listByStatus(statuses: JobStatus[]): Promise<Job[]> {
    const set = new Set(statuses);
    return [...this.jobs.values()]
      .filter((job) => set.has(job.status))
      .map(cloneJob);
  }

  public async claimNext(ownerId: string, leaseMs: number): Promise<Job | undefined> {
    const now = Date.now();
    const rank = { high: 0, normal: 1, low: 2 };
    const job = [...this.jobs.values()].filter(item => item.status === 'queued' && (!item.availableAt || item.availableAt.getTime() <= now))
      .filter(item => !EFFECT_JOB_TYPES.includes(item.type) || !!item.graphGenerations?.length && item.graphGenerations.every(token=>String(this.head(token.orgId,token.repoId).requested)===token.generation))
      .filter(item => !EFFECT_JOB_TYPES.includes(item.type) || ![...this.jobs.values()].some(blocked => blocked.effectQuarantined
        || blocked.status === 'running' && EFFECT_JOB_TYPES.includes(blocked.type) && effectJobsConflict(item,blocked)))
      .sort((a, b) => rank[a.priority] - rank[b.priority] || a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!job) return undefined;
    Object.assign(job, {status: 'running', ownerId, attemptId: randomUUID(), leaseExpiresAt: new Date(now + leaseMs), startedAt: new Date(now), completedAt: undefined, progress: 5, error: undefined});
    return cloneJob(job);
  }

  private owned(id: string, lease: JobLease): Job | undefined {
    const job = this.jobs.get(id);
    return job?.status === 'running' && job.ownerId === lease.ownerId && job.attemptId === lease.attemptId
      && Number(job.leaseExpiresAt?.getTime()) > Date.now() ? job : undefined;
  }

  public async renew(id: string, lease: JobLease, leaseMs: number): Promise<boolean> {
    const job = this.owned(id, lease);
    if (!job) return false;
    job.leaseExpiresAt = new Date(Date.now() + leaseMs);
    return true;
  }

  public async updateOwned(job: Job, lease: JobLease, _record?: JobResultRecord): Promise<Job | undefined> {
    const current = this.owned(job.id, lease);
    if (!current || current.type!==job.type || current.userId!==job.userId || JSON.stringify(current.params)!==JSON.stringify(job.params)
      || JSON.stringify(current.graphGenerations)!==JSON.stringify(job.graphGenerations)) return undefined;
    if (job.status==='completed' && EFFECT_JOB_TYPES.includes(job.type)
      && [...this.jobs.values()].some(item=>item.effectQuarantined)) return undefined;
    if(GRAPH_JOB_TYPES.includes(current.type) && job.status==='completed' && current.graphGenerations?.some(token=>{
      const head=this.head(token.orgId,token.repoId);return String(head.requested)!==token.generation || String(head.published)!==token.generation || head.jobId!==job.id;
    })) return undefined;
    Object.assign(current, {status: job.status, progress: job.progress, result: job.result, error: job.error,
      effectQuarantined: Boolean(current.effectQuarantined || job.effectQuarantined),
      completedAt: job.status === 'running' ? undefined : new Date()});
    return cloneJob(current);
  }

  public async cancel(id: string, includeRunning: boolean): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job || !(job.status === 'queued' || includeRunning && job.status === 'running')) return undefined;
    Object.assign(job, {effectQuarantined: job.status === 'running' && EFFECT_JOB_TYPES.includes(job.type), status: 'cancelled', completedAt: new Date(), error: 'Cancelled by user'});
    return cloneJob(job);
  }

  public async requeue(id: string, lease: JobLease, delayMs: number, countRetry: boolean): Promise<Job | undefined> {
    const job = this.owned(id, lease);
    if (!job) return undefined;
    if (EFFECT_JOB_TYPES.includes(job.type) && (countRetry || job.progress !== 5)) return undefined;
    Object.assign(job, {status: 'queued', ownerId: undefined, attemptId: undefined, leaseExpiresAt: undefined,
      startedAt: undefined, completedAt: undefined, progress: 0, retryCount: job.retryCount + (countRetry ? 1 : 0), availableAt: new Date(Date.now() + delayMs)});
    return cloneJob(job);
  }

  public async reclaimExpired(maxRetries: number): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== 'running' || Number(job.leaseExpiresAt?.getTime()) > Date.now()) continue;
      const effect = EFFECT_JOB_TYPES.includes(job.type);
      const exhausted = effect || job.retryCount >= maxRetries;
      Object.assign(job, {status: exhausted ? 'failed' : 'queued', leaseExpiresAt: undefined,
        startedAt: undefined, completedAt: exhausted ? new Date() : undefined, retryCount: job.retryCount + 1,
        effectQuarantined: effect, ownerId: effect ? job.ownerId : undefined, attemptId: effect ? job.attemptId : undefined,
        progress: 0, availableAt: new Date(), error: effect ? 'Expired effect attempt quarantined; terminate worker and reconcile effects' : exhausted ? 'Lease recovery retry limit exhausted' : 'Expired worker lease reclaimed'});
      count++;
    }
    return count;
  }

  public async delete(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (job?.status === 'running' || job?.effectQuarantined) return false;
    return this.jobs.delete(id);
  }

  public async findReusableCompletedJob(
    userId: string,
    jobType: JobType,
    params: JobParams,
    maxAgeMs: number
  ): Promise<Job | undefined> {
    return pickNewestReusableJob(
      this.allJobs().filter((job) => job.userId === userId && job.type === jobType &&
        (job.type!==Types.BUILD_DEPENDENCY_GRAPH || !!job.graphGenerations?.every(token=>{const head=this.head(token.orgId,token.repoId);return head.jobId===job.id && String(head.published)===token.generation && head.requested===head.published;}))),
      maxAgeMs,
      params
    );
  }

  public async findLatestCompletedJob(
    userId: string,
    jobType: JobType,
    params: JobParams
  ): Promise<Job | undefined> {
    return pickNewestMatchingCompletedJob(
      this.allJobs().filter((job) => job.userId === userId && job.type === jobType &&
        (job.type!==Types.BUILD_DEPENDENCY_GRAPH || !!job.graphGenerations?.every(token=>{const head=this.head(token.orgId,token.repoId);return head.jobId===job.id && String(head.published)===token.generation && head.requested===head.published;}))),
      params
    );
  }

  public async findActiveIndexJob(orgId:string,repoId:string):Promise<{jobId:string;status:'queued'|'running'}|undefined> {
    const id=this.head(orgId,repoId).jobId,job=id && this.jobs.get(id);
    return job && job.type===Types.INDEX_REPOSITORY && (job.status==='queued'||job.status==='running') ? {jobId:job.id,status:job.status} : undefined;
  }

  public async countJobsForUser(userId: string, jobType: string, window: "hour" | "today"): Promise<number> {
    const key = `${userId}:${jobType}`;
    const now = Date.now();
    let entry = this.rateLimits.get(key);
    if (!entry) {
      entry = createRateLimitEntry(now);
      this.rateLimits.set(key, entry);
    }
    resetRateLimitWindows(entry, now);
    if (window === "hour") {
      return entry.hour.get(userId) ?? 0;
    }
    return entry.day.get(userId) ?? 0;
  }

  public async recordJobSubmission(userId: string, jobType: JobType): Promise<void> {
    this.incrementRateLimit(userId, jobType);
  }

  public incrementRateLimit(userId: string, jobType: string): void {
    const key = `${userId}:${jobType}`;
    const now = Date.now();
    let entry = this.rateLimits.get(key);
    if (!entry) {
      entry = createRateLimitEntry(now);
      this.rateLimits.set(key, entry);
    }
    resetRateLimitWindows(entry, now);
    entry.hour.set(userId, (entry.hour.get(userId) ?? 0) + 1);
    entry.day.set(userId, (entry.day.get(userId) ?? 0) + 1);
  }

  public allJobs(): Job[] {
    return [...this.jobs.values()].map(cloneJob);
  }
}

function createRateLimitEntry(now: number): RateLimitEntry {
  return {
    hour: new Map(),
    day: new Map(),
    hourReset: now + 3_600_000,
    dayReset: startOfNextUtcDay(now)
  };
}

function resetRateLimitWindows(entry: RateLimitEntry, now: number): void {
  if (now >= entry.hourReset) {
    entry.hour.clear();
    entry.hourReset = now + 3_600_000;
  }
  if (now >= entry.dayReset) {
    entry.day.clear();
    entry.dayReset = startOfNextUtcDay(now);
  }
}

function startOfNextUtcDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function cloneJob(job: Job): Job {
  return {
    ...job,
    params: structuredClone(job.params),
    graphGenerations: job.graphGenerations?.map(item=>({...item})),
    createdAt: new Date(job.createdAt),
    startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
    completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
    leaseExpiresAt: job.leaseExpiresAt ? new Date(job.leaseExpiresAt) : undefined,
    availableAt: job.availableAt ? new Date(job.availableAt) : undefined
  };
}

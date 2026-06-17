import type { JobQueue } from "../jobs/jobQueue";
import { JobType } from "../jobs/types";
import type { OrgStore } from "./orgStore";

export type QueueOrgRepoIndexResult =
  | { outcome: "queued"; jobId: string }
  | { outcome: "skipped"; reason: "already_active" | "skip_policy"; jobId?: string }
  | { outcome: "failed"; message: string };

export async function findActiveIndexJob(
  jobQueue: JobQueue,
  orgId: string,
  repoId: string
): Promise<{ jobId: string; status: "queued" | "running" } | undefined> {
  const backend =
    typeof jobQueue.getBackend === "function" ? jobQueue.getBackend() : undefined;
  if (backend?.findActiveIndexJob) {
    return backend.findActiveIndexJob(orgId, repoId);
  }

  if (typeof jobQueue.listAllJobs === "function") {
    const jobs = await jobQueue.listAllJobs();
    const match = jobs.find(
      (job) =>
        job.type === JobType.INDEX_REPOSITORY &&
        String(job.params.orgId ?? "") === orgId &&
        String(job.params.repoId ?? "") === repoId &&
        (job.status === "queued" || job.status === "running")
    );
    if (!match || (match.status !== "queued" && match.status !== "running")) {
      return undefined;
    }
    return { jobId: match.id, status: match.status };
  }

  return undefined;
}

/**
 * Queue a single org repo for indexing. Skips duplicate queued/running jobs and
 * clears stale embedding status until the worker records a fresh outcome.
 */
export async function queueOrgRepoIndex(
  orgId: string,
  repoId: string,
  deps: {
    orgStore: OrgStore;
    jobQueue: JobQueue;
    userId?: string;
    bypassRateLimit?: boolean;
  }
): Promise<QueueOrgRepoIndexResult> {
  const existing = await deps.orgStore.getOrgRepo(orgId, repoId);

  const active = await findActiveIndexJob(deps.jobQueue, orgId, repoId);
  if (active) {
    if (existing?.lastJobId !== active.jobId) {
      await deps.orgStore.upsertOrgRepo(orgId, repoId, {
        lightningEnabled: true,
        indexStatus: active.status === "running" ? "indexing" : "queued",
        lastJobId: active.jobId,
        error: undefined,
        embeddingStatus: undefined,
        embeddingError: undefined
      });
    }
    return { outcome: "skipped", reason: "already_active", jobId: active.jobId };
  }

  if (existing?.lastJobId) {
    const lastJob = await deps.jobQueue.getJob(existing.lastJobId);
    if (lastJob && (lastJob.status === "queued" || lastJob.status === "running")) {
      return { outcome: "skipped", reason: "already_active", jobId: lastJob.id };
    }
  }

  let submit: Awaited<ReturnType<JobQueue["createJob"]>>;
  try {
    submit = await deps.jobQueue.createJob({
      type: JobType.INDEX_REPOSITORY,
      priority: "high",
      bypassRateLimit: deps.bypassRateLimit ?? true,
      userId: deps.userId ?? `org:${orgId}`,
      params: { repoId, orgId }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: "failed", message };
  }

  await deps.orgStore.upsertOrgRepo(orgId, repoId, {
    lightningEnabled: true,
    indexStatus: "queued",
    lastJobId: submit.jobId,
    error: undefined,
    embeddingStatus: undefined,
    embeddingError: undefined
  });

  return { outcome: "queued", jobId: submit.jobId };
}

export type ReindexEmbeddingFailuresResult = {
  discovered: number;
  queued: number;
  skipped: number;
};

/** Queue fresh index jobs for repos that reached ready but embeddings failed. */
export async function reindexEmbeddingFailures(
  orgId: string,
  deps: { orgStore: OrgStore; jobQueue: JobQueue }
): Promise<ReindexEmbeddingFailuresResult> {
  const repos = await deps.orgStore.listOrgRepos(orgId);
  const targets = repos.filter(
    (repo) =>
      repo.lightningEnabled &&
      repo.indexStatus === "ready" &&
      repo.embeddingStatus === "failed"
  );

  let queued = 0;
  let skipped = 0;
  for (const repo of targets) {
    const result = await queueOrgRepoIndex(orgId, repo.repoId, {
      orgStore: deps.orgStore,
      jobQueue: deps.jobQueue,
      userId: `org:${orgId}`,
      bypassRateLimit: true
    });
    if (result.outcome === "queued") {
      queued += 1;
    } else {
      skipped += 1;
    }
  }

  if (queued > 0) {
    console.log(
      `[indexing] org=${orgId} reindex-embedding-failures discovered=${targets.length} queued=${queued} skipped=${skipped}`
    );
  }

  return { discovered: targets.length, queued, skipped };
}

export async function resumeEmbeddingFailuresForAllOrgs(deps: {
  pool: import("pg").Pool;
  orgStore: OrgStore;
  jobQueue: JobQueue;
}): Promise<ReindexEmbeddingFailuresResult> {
  const result = await deps.pool.query<{ org_id: string }>(
    `SELECT DISTINCT org_id
     FROM org_repos
     WHERE lightning_enabled
       AND index_status = 'ready'
       AND embedding_status = 'failed'`
  );

  let discovered = 0;
  let queued = 0;
  let skipped = 0;
  for (const row of result.rows) {
    const orgId = String(row.org_id);
    const batch = await reindexEmbeddingFailures(orgId, {
      orgStore: deps.orgStore,
      jobQueue: deps.jobQueue
    });
    discovered += batch.discovered;
    queued += batch.queued;
    skipped += batch.skipped;
  }
  return { discovered, queued, skipped };
}

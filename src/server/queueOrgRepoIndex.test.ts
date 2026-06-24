import assert from "node:assert/strict";
import type { Pool } from "pg";
import { loadJobQueueConfig } from "../config/jobQueueConfig";
import { MemoryQueueBackend } from "../jobs/backends/memoryBackend";
import { JobQueue } from "../jobs/jobQueue";
import { JobType } from "../jobs/types";
import type { OrgRepoRecord } from "./orgStore";
import { OrgStore } from "./orgStore";
import { findActiveIndexJob, queueOrgRepoIndex } from "./queueOrgRepoIndex";

function createOrgStoreStub(records: Map<string, OrgRepoRecord>): OrgStore {
  const pool = {
    query: async () => ({ rows: [] })
  } as unknown as Pool;
  const store = new OrgStore(pool);
  store.getOrgRepo = async (orgId, repoId) => records.get(`${orgId}:${repoId}`);
  store.upsertOrgRepo = async (orgId, repoId, patch) => {
    const key = `${orgId}:${repoId}`;
    const existing = records.get(key);
    const next: OrgRepoRecord = {
      orgId,
      repoId,
      lightningEnabled: patch.lightningEnabled ?? existing?.lightningEnabled ?? false,
      indexStatus: patch.indexStatus ?? existing?.indexStatus ?? "idle",
      embeddingStatus:
        "embeddingStatus" in patch ? patch.embeddingStatus : existing?.embeddingStatus,
      embeddingError: "embeddingError" in patch ? patch.embeddingError : existing?.embeddingError,
      lastJobId: patch.lastJobId ?? existing?.lastJobId,
      lastIndexedAt: patch.lastIndexedAt ?? existing?.lastIndexedAt,
      error: "error" in patch ? patch.error : existing?.error,
      updatedAt: new Date()
    };
    records.set(key, next);
    return next;
  };
  return store;
}

async function testSkipsDuplicateActiveJob() {
  const orgId = "org-1";
  const repoId = "github:acme/demo";
  const records = new Map<string, OrgRepoRecord>([
    [
      `${orgId}:${repoId}`,
      {
        orgId,
        repoId,
        lightningEnabled: true,
        indexStatus: "queued",
        embeddingStatus: "complete",
        lastJobId: "job-1",
        updatedAt: new Date()
      }
    ]
  ]);
  const orgStore = createOrgStoreStub(records);
  const queue = new JobQueue(
    { ...loadJobQueueConfig(), backend: "memory" },
    new MemoryQueueBackend()
  );

  await queue.createJob({
    type: JobType.INDEX_REPOSITORY,
    userId: `org:${orgId}`,
    params: { orgId, repoId }
  });
  const jobs = await queue.listAllJobs();
  const active = jobs[0];
  assert.ok(active);

  const found = await findActiveIndexJob(queue, orgId, repoId);
  assert.equal(found?.jobId, active.id);

  const first = await queueOrgRepoIndex(orgId, repoId, { orgStore, jobQueue: queue });
  assert.equal(first.outcome, "skipped");
  assert.equal(first.reason, "already_active");

  const second = await queueOrgRepoIndex(orgId, repoId, { orgStore, jobQueue: queue });
  assert.equal(second.outcome, "skipped");
  assert.equal((await queue.listAllJobs()).filter((job) => job.status === "queued").length, 1);

  const record = records.get(`${orgId}:${repoId}`);
  assert.equal(record?.embeddingStatus, undefined);
}

async function testQueuesFreshJobAndClearsEmbeddings() {
  const orgId = "org-2";
  const repoId = "github:acme/fresh";
  const records = new Map<string, OrgRepoRecord>([
    [
      `${orgId}:${repoId}`,
      {
        orgId,
        repoId,
        lightningEnabled: true,
        indexStatus: "ready",
        embeddingStatus: "complete",
        lastJobId: "old-job",
        updatedAt: new Date()
      }
    ]
  ]);
  const orgStore = createOrgStoreStub(records);
  const queue = new JobQueue(
    { ...loadJobQueueConfig(), backend: "memory" },
    new MemoryQueueBackend()
  );

  const result = await queueOrgRepoIndex(orgId, repoId, { orgStore, jobQueue: queue });
  assert.equal(result.outcome, "queued");
  const record = records.get(`${orgId}:${repoId}`);
  assert.equal(record?.indexStatus, "queued");
  assert.equal(record?.embeddingStatus, undefined);
  assert.equal(record?.lastJobId, result.jobId);
}

async function run() {
  await testSkipsDuplicateActiveJob();
  await testQueuesFreshJobAndClearsEmbeddings();
  console.log("queueOrgRepoIndex: 2/2 tests passed");
}

void run();

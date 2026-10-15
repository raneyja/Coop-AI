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
  store.upsertOrgRepo = async () => {
    assert.fail("request-side enqueue cannot publish repository status; owned claim/effect owner does that");
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
  assert.equal(record?.embeddingStatus, "complete");
  assert.equal(record?.lightningEnabled, true);
  assert.equal(record?.lastJobId, "job-1");
}

async function testSupersedesDisabledRepoWithoutRequestPublication() {
  const orgId = "org-3";
  const repoId = "github:raneyja/Coop-AI";
  const queue = new JobQueue(
    { ...loadJobQueueConfig(), backend: "memory" },
    new MemoryQueueBackend()
  );
  const created = await queue.createJob({
    type: JobType.INDEX_REPOSITORY,
    userId: `org:${orgId}`,
    params: { orgId, repoId }
  });
  const records = new Map<string, OrgRepoRecord>([
    [
      `${orgId}:${repoId}`,
      {
        orgId,
        repoId,
        // Turned off while the index job is still queued/running.
        lightningEnabled: false,
        indexStatus: "disabled",
        lastJobId: created.jobId,
        updatedAt: new Date()
      }
    ]
  ]);
  const orgStore = createOrgStoreStub(records);

  // Disabled + active job must supersede (not reattach) so Deep-Index starts clean.
  const result = await queueOrgRepoIndex(orgId, repoId, { orgStore, jobQueue: queue });
  assert.equal(result.outcome, "queued");
  assert.notEqual(result.jobId, created.jobId);

  const cancelled = await queue.getJob(created.jobId);
  assert.equal(cancelled?.status, "cancelled");

  const record = records.get(`${orgId}:${repoId}`);
  assert.equal(record?.lightningEnabled, false);
  assert.equal(record?.indexStatus, "disabled");
  assert.equal(record?.lastJobId, created.jobId);
}

async function testForceSupersedesStuckEmbeddingJob() {
  const orgId = "org-4";
  const repoId = "github:raneyja/Coop-AI";
  const backend = new MemoryQueueBackend();
  const queue = new JobQueue({ ...loadJobQueueConfig(), backend: "memory" }, backend);
  const created = await queue.createJob({
    type: JobType.INDEX_REPOSITORY,
    userId: `org:${orgId}`,
    params: { orgId, repoId }
  });
  const stuck = await queue.claimNext('test-index-worker', 30_000);
  assert.ok(stuck);
  assert.equal(stuck.id, created.jobId);
  await queue.updateProgress(stuck, 79);

  const records = new Map<string, OrgRepoRecord>([
    [
      `${orgId}:${repoId}`,
      {
        orgId,
        repoId,
        lightningEnabled: true,
        indexStatus: "indexing",
        lastJobId: created.jobId,
        updatedAt: new Date()
      }
    ]
  ]);
  const orgStore = createOrgStoreStub(records);

  const result = await queueOrgRepoIndex(orgId, repoId, {
    orgStore,
    jobQueue: queue,
    force: true
  });
  assert.equal(result.outcome, "queued");
  assert.notEqual(result.jobId, created.jobId);
  assert.equal((await queue.getJob(created.jobId))?.status, "cancelled");
  assert.equal(records.get(`${orgId}:${repoId}`)?.lastJobId, created.jobId);
  assert.equal(records.get(`${orgId}:${repoId}`)?.indexStatus, "indexing");
}

async function testQueuesFreshJobWithoutRequestPublication() {
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
  assert.equal(record?.indexStatus, "ready");
  assert.equal(record?.embeddingStatus, "complete");
  assert.equal(record?.lastJobId, "old-job");
  const queued = await queue.getJob(result.jobId!);
  assert.equal(queued?.status, "queued");
  assert.equal(queued?.params.orgId, orgId);
  assert.equal(queued?.params.repoId, repoId);
}

async function run() {
  await testSkipsDuplicateActiveJob();
  await testQueuesFreshJobWithoutRequestPublication();
  await testSupersedesDisabledRepoWithoutRequestPublication();
  await testForceSupersedesStuckEmbeddingJob();
  console.log("queueOrgRepoIndex: 4/4 tests passed");
}

void run();

import assert from "node:assert/strict";
import { JobType, type Job } from "./types";
import { enqueueNightlyIndexTargets, planNightlyIndexBatch } from "./scheduler";

const orgA = Array.from({ length: 4 }, (_item, index) => ({
  orgId: "org-a",
  repoId: `github:acme/a${index}`
}));
const orgB = Array.from({ length: 4 }, (_item, index) => ({
  orgId: "org-b",
  repoId: `gitlab:acme/b${index}`
}));
const planned = planNightlyIndexBatch([...orgA, ...orgB], 2);
const countA = planned.filter((row) => row.orgId === "org-a").length;
const countB = planned.filter((row) => row.orgId === "org-b").length;
assert.equal(countA, 2);
assert.equal(countB, 2);
assert.equal(planned.length, 4);
assert.notEqual(planned[0]?.orgId, planned[1]?.orgId);

void (async () => {
const created: Array<{ orgId: string; repoId: string; priority: string }> = [];
const activeKey = "org-a:github:acme/a0";

function job(id: string): Job {
  return {
    id,
    type: JobType.INDEX_REPOSITORY,
    status: "running",
    priority: "low",
    params: {},
    progress: 10,
    createdAt: new Date(),
    retryCount: 0,
    scheduled: true,
    estimatedDurationMs: 60_000
  };
}

const orgStore = {
  getOrgRepo: async (orgId: string, repoId: string) => ({
    orgId,
    repoId,
    lightningEnabled: true,
    indexStatus: "ready" as const,
    updatedAt: new Date()
  }),
  upsertOrgRepo: async (orgId: string, repoId: string) => ({
    orgId,
    repoId,
    lightningEnabled: true,
    indexStatus: "queued" as const,
    updatedAt: new Date()
  })
};

const queue = {
  getBackend: () => ({
    findActiveIndexJob: async (orgId: string, repoId: string) =>
      `${orgId}:${repoId}` === activeKey
        ? { jobId: "active-job", status: "running" as const }
        : undefined
  }),
  getJob: async (id: string) => (id === "active-job" ? job(id) : undefined),
  createJob: async (input: { priority: string; params: { orgId: string; repoId: string } }) => {
    created.push({
      orgId: String(input.params.orgId),
      repoId: String(input.params.repoId),
      priority: input.priority
    });
    return { jobId: `job-${created.length}`, estimatedWaitTime: 0 };
  },
  cancelJob: async () => ({})
};

const summary = await enqueueNightlyIndexTargets({
  name: "nightly",
  priority: "low",
  targets: [...orgA, ...orgB],
  cap: 3,
  orgStore: orgStore as never,
  queue: queue as never
});

assert.equal(summary.skipped, 1);
assert.equal(created.some((row) => row.repoId === "github:acme/a0"), false);
assert.equal(created.every((row) => row.priority === "low"), true);
const queuedA = created.filter((row) => row.orgId === "org-a").length;
const queuedB = created.filter((row) => row.orgId === "org-b").length;
assert.ok(queuedA > 0 && queuedA <= 3);
assert.ok(queuedB > 0 && queuedB <= 3);
assert.ok(queuedA + queuedB < orgA.length + orgB.length);

console.log("nightlyIndex: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

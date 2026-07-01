import assert from "node:assert/strict";
import {
  FREE_MAX_INDEXED_REPOS,
  autoIndexOnCatalogSync,
  getIndexedRepoQuota,
  indexedRepoLimitForPlan,
  reconcileIndexedRepoQuota
} from "./indexedRepoQuota";
import type { OrgStore } from "./orgStore";

async function testProOrgCatalogUncapped() {
  const orgStore = {
    listOrgRepos: async () => [
      { repoId: "github:a/b", lightningEnabled: true },
      { repoId: "github:a/c", lightningEnabled: true },
      { repoId: "github:a/d", lightningEnabled: false }
    ],
    getOrganizationBilling: async () => ({ seatCount: 5 })
  } as unknown as OrgStore;

  const quota = await getIndexedRepoQuota(orgStore, "org-1", "pro");
  assert.equal(quota.indexedRepoCount, 2);
  assert.equal(quota.indexedRepoLimit, null);
  assert.equal(quota.canEnableMoreRepos, true);
}

async function testFreeOrgCatalogCapped() {
  const orgStore = {
    listOrgRepos: async () => [
      { repoId: "github:a/b", lightningEnabled: true },
      { repoId: "github:a/c", lightningEnabled: true },
      { repoId: "github:a/d", lightningEnabled: true }
    ]
  } as unknown as OrgStore;

  assert.equal(indexedRepoLimitForPlan("free"), FREE_MAX_INDEXED_REPOS);
  const quota = await getIndexedRepoQuota(orgStore, "org-free", "free");
  assert.equal(quota.indexedRepoCount, 3);
  assert.equal(quota.indexedRepoLimit, 3);
  assert.equal(quota.canEnableMoreRepos, false);
  assert.equal(autoIndexOnCatalogSync("free"), false);
  assert.equal(autoIndexOnCatalogSync("pro"), true);
}

async function testReconcileFreeOrgTrimsExcess() {
  const upserts: Array<{ repoId: string; patch: { lightningEnabled: boolean } }> = [];
  const orgStore = {
    listOrgRepos: async () => [
      { repoId: "github:a/old", lightningEnabled: true, lastIndexedAt: "2026-01-01T00:00:00.000Z" },
      { repoId: "github:a/new1", lightningEnabled: true, lastIndexedAt: "2026-06-01T00:00:00.000Z" },
      { repoId: "github:a/new2", lightningEnabled: true, lastIndexedAt: "2026-06-02T00:00:00.000Z" },
      { repoId: "github:a/new3", lightningEnabled: true, lastIndexedAt: "2026-06-03T00:00:00.000Z" }
    ],
    upsertOrgRepo: async (_orgId: string, repoId: string, patch: { lightningEnabled: boolean }) => {
      upserts.push({ repoId, patch });
      return { repoId, ...patch };
    }
  } as unknown as OrgStore;

  const result = await reconcileIndexedRepoQuota(orgStore, "org-free", "free");
  assert.equal(result.trimmed, 1);
  assert.deepEqual(result.disabledRepoIds, ["github:a/old"]);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.repoId, "github:a/old");
  assert.equal(upserts[0]?.patch.lightningEnabled, false);
}

async function run() {
  await testProOrgCatalogUncapped();
  await testFreeOrgCatalogCapped();
  await testReconcileFreeOrgTrimsExcess();
  console.log("indexedRepoQuota.test.ts: ok");
}

void run();

import assert from "node:assert/strict";
import {
  FREE_MAX_INDEXED_REPOS,
  autoIndexOnCatalogSync,
  getIndexedRepoQuota,
  indexedRepoLimitForPlan
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

async function run() {
  await testProOrgCatalogUncapped();
  await testFreeOrgCatalogCapped();
  console.log("indexedRepoQuota.test.ts: ok");
}

void run();

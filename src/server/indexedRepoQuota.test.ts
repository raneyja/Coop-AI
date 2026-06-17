import assert from "node:assert/strict";
import { getIndexedRepoQuota } from "./indexedRepoQuota";
import type { OrgStore } from "./orgStore";

async function testOrgCatalogQuotaIsUncapped() {
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

async function run() {
  await testOrgCatalogQuotaIsUncapped();
  console.log("indexedRepoQuota: 1/1 tests passed");
}

void run();

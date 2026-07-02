import assert from "node:assert/strict";
import {
  catalogRepoIsAccessible,
  indexedOrgRepoIds,
  isIndexedForAccess,
  resolveAccessibleRepoIds
} from "./resolveAccessibleRepos";
import type { OrgRepoRecord, OrgStore } from "./orgStore";

function repo(repoId: string, enabled: boolean, status: OrgRepoRecord["indexStatus"] = "ready"): OrgRepoRecord {
  return {
    orgId: "org-1",
    repoId,
    lightningEnabled: enabled,
    indexStatus: status,
    updatedAt: new Date()
  };
}

async function testAllIndexedMode() {
  const orgStore = {
    getOrganization: async () => ({
      id: "org-1",
      name: "Acme",
      plan: "pro" as const,
      repoAccessMode: "all_indexed" as const,
      createdAt: new Date()
    }),
    listOrgRepos: async () => [
      repo("github:acme/api", true),
      repo("github:acme/web", true),
      repo("github:acme/old", false, "idle")
    ]
  } as unknown as OrgStore;

  const resolution = await resolveAccessibleRepoIds("org-1", "user-1", "pro", { orgStore });
  assert.deepEqual(resolution.repoIds, ["github:acme/api", "github:acme/web"]);
  assert.equal(resolution.repoAccessMode, "all_indexed");
  assert.equal(
    catalogRepoIsAccessible("github:acme/api", indexedOrgRepoIds(await orgStore.listOrgRepos("org-1")), resolution),
    true
  );
}

async function testPerUserMode() {
  const orgStore = {
    getOrganization: async () => ({
      id: "org-1",
      name: "Acme",
      plan: "enterprise" as const,
      repoAccessMode: "per_user" as const,
      createdAt: new Date()
    }),
    listOrgRepos: async () => [repo("github:acme/api", true), repo("github:acme/web", true)]
  } as unknown as OrgStore;

  const grantStore = {
    listUserRepoGrantIds: async () => ["github:acme/web"]
  };

  const resolution = await resolveAccessibleRepoIds("org-1", "user-1", "enterprise", {
    orgStore,
    grantStore: grantStore as never
  });
  assert.deepEqual(resolution.repoIds, ["github:acme/web"]);
  assert.equal(resolution.repoAccessMode, "per_user");
}

async function testIndexedHelper() {
  assert.equal(isIndexedForAccess(repo("github:a/b", true, "ready")), true);
  assert.equal(isIndexedForAccess(repo("github:a/b", true, "indexing")), true);
  assert.equal(isIndexedForAccess(repo("github:a/b", false, "idle")), false);
  assert.equal(isIndexedForAccess(repo("github:a/b", true, "disabled")), false);
}

async function run() {
  await testAllIndexedMode();
  await testPerUserMode();
  await testIndexedHelper();
  console.log("resolveAccessibleRepos.test.ts: ok");
}

void run();

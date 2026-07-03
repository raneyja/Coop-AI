import assert from "node:assert/strict";
import type { OrgStore } from "./orgStore";
import { CatalogSyncError, runCatalogSyncForProvider } from "./catalogSyncService";

async function testRequiresConnectedCodeHost() {
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Test", plan: "pro", createdAt: new Date() }),
    getCodeHostInstallation: async () => undefined
  } as unknown as OrgStore;

  await assert.rejects(
    () =>
      runCatalogSyncForProvider("org-1", "github", {
        orgStore,
        jobQueue: { createJob: async () => ({ jobId: "j1", estimatedWaitTime: 0 }) } as never
      }),
    (error: unknown) => {
      assert.ok(error instanceof CatalogSyncError);
      assert.equal(error.code, "code_host_not_connected");
      return true;
    }
  );
}

async function testGitLabAllowedOnPro() {
  const orgStore = {
    getOrganization: async () => ({ id: "org-1", name: "Test", plan: "pro", createdAt: new Date() }),
    getCodeHostInstallation: async () => ({
      installationId: 1,
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date()
    }),
    getInstallationToken: async () => undefined
  } as unknown as OrgStore;

  await assert.rejects(
    () =>
      runCatalogSyncForProvider("org-1", "gitlab", {
        orgStore,
        jobQueue: { createJob: async () => ({ jobId: "j1", estimatedWaitTime: 0 }) } as never
      }),
    (error: unknown) => {
      assert.ok(error instanceof CatalogSyncError);
      assert.equal(error.code, "code_host_token_unavailable");
      return true;
    }
  );
}

async function run() {
  await testRequiresConnectedCodeHost();
  await testGitLabAllowedOnPro();
  console.log("catalogSyncService: 2/2 tests passed");
}

void run();

import assert from "node:assert/strict";
import { EstateSyncService } from "./estateSyncService";
import type { GitHubAppService } from "./githubAppService";
import type { OrgRepoRecord, OrgStore } from "./orgStore";

void (async () => {
  const jobs: Array<{ repoId: string; orgId: string }> = [];
  const repos = new Map<string, OrgRepoRecord>();

  const orgStore = {
    getOrganization: async (orgId: string) =>
      orgId === "org-ent"
        ? { id: orgId, name: "Estate", plan: "enterprise" as const, createdAt: new Date() }
        : { id: orgId, name: "Pro", plan: "pro" as const, createdAt: new Date() },
    getOrgRepo: async (_orgId: string, repoId: string) => repos.get(repoId),
    upsertOrgRepo: async (orgId: string, repoId: string, patch: Partial<OrgRepoRecord>) => {
      const existing = repos.get(repoId);
      const next: OrgRepoRecord = {
        orgId,
        repoId,
        lightningEnabled: patch.lightningEnabled ?? existing?.lightningEnabled ?? false,
        indexStatus: patch.indexStatus ?? existing?.indexStatus ?? "idle",
        lastJobId: patch.lastJobId ?? existing?.lastJobId,
        error: patch.error ?? existing?.error,
        updatedAt: new Date()
      };
      repos.set(repoId, next);
      return next;
    }
  } as unknown as OrgStore;

  const githubApp = {
    listInstallationRepositories: async () => ["github:acme/api", "github:acme/web"]
  } as unknown as GitHubAppService;

  const jobQueue = {
    createJob: async (input: { params: { repoId: string; orgId: string } }) => {
      jobs.push(input.params);
      return { jobId: `job-${jobs.length}`, estimatedWaitTime: 0 };
    }
  };

  const service = new EstateSyncService(orgStore, githubApp, jobQueue as never);

  const proResult = await service.syncInstallation("org-pro", 42);
  assert.equal(proResult.discovered, 2);
  assert.equal(proResult.queued, 2);

  const entResult = await service.syncInstallation("org-ent", 99);
  assert.equal(entResult.discovered, 2);
  assert.equal(entResult.queued + entResult.skipped, 2);
  assert.ok(jobs.length >= 2);

  console.log("estateSyncService: 1/1 tests passed");
})();

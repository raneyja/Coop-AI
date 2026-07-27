import test from "node:test";
import assert from "node:assert/strict";
import { resolveRepoBranchForTarget } from "./resolveRepoBranch";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";

void (async () => {
  await test("resolveRepoBranchForTarget prefers indexed branch over code-host default", async () => {
    const router = {
      getRepository: async () => ({ defaultBranch: "main" }),
      getRepositoryTree: async (_path: string, coords: { branch?: string }) => ({
        branch: coords.branch ?? "preview",
        entries: []
      })
    } as unknown as CodeHostRouter;

    const branch = await resolveRepoBranchForTarget(
      {
        repoId: "github:CoopAI-Corp/plane",
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "main",
        provider: "github"
      },
      {
        codeHostRouter: router,
        resolveIndexedBranch: async () => "preview",
        resolveWorkspaceBranch: async () => "main"
      }
    );

    assert.equal(branch, "preview");
  });

  await test("resolveRepoBranchForTarget uses workspace branch when index is unavailable", async () => {
    const router = {
      getRepositoryTree: async (_path: string, coords: { branch?: string }) => ({
        branch: coords.branch,
        entries: []
      })
    } as unknown as CodeHostRouter;

    const branch = await resolveRepoBranchForTarget(
      {
        repoId: "github:acme/app",
        owner: "acme",
        repo: "app",
        provider: "github"
      },
      {
        codeHostRouter: router,
        resolveIndexedBranch: async () => undefined,
        resolveWorkspaceBranch: async () => "develop"
      }
    );

    assert.equal(branch, "develop");
  });
})();

import assert from "node:assert/strict";
import {
  dedupeWorkspaceRepos,
  isWorkspaceRepoIndexReady,
  workspaceRepoLabel
} from "./workspaceRepoStatus";
import type { WorkspaceRepo } from "./coopApi";

function repo(partial: Partial<WorkspaceRepo> & Pick<WorkspaceRepo, "repoId">): WorkspaceRepo {
  return {
    owner: "acme",
    name: "app",
    ...partial
  };
}

assert.equal(isWorkspaceRepoIndexReady({ indexStatus: "ready" }), true);
assert.equal(isWorkspaceRepoIndexReady({ indexStatus: "indexing" }), false);
assert.equal(isWorkspaceRepoIndexReady({ indexStatus: undefined }), false);

assert.equal(
  dedupeWorkspaceRepos([
    repo({ repoId: "github:acme/app", indexStatus: "ready" }),
    repo({ repoId: "github:acme/app", indexStatus: "idle" }),
    repo({ repoId: "github:acme/other", indexStatus: "ready" })
  ]).length,
  2
);

assert.equal(workspaceRepoLabel({ owner: "raneyja", name: "Coop-AI" }), "raneyja/Coop-AI");

console.log("workspaceRepoStatus.test.ts: ok");

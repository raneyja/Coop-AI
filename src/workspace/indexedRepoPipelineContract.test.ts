import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/**
 * Guardrail: Deep-Index writer and branch readers stay on the same repo_stats record.
 * Consumer wiring (chat/summary enrichment) is covered in a follow-up PR.
 */
void (async () => {
  await test("INDEX_REPOSITORY persists branch on repo_stats", () => {
    const source = read("jobs/executors.ts");
    assert.match(source, /branch:\s*clone\.branch/);
    assert.match(source, /new RepoStatsStore\(pool\)\.upsertStats/);
  });

  await test("inventory client preserves indexed branch from API", () => {
    const client = read("chat/SecureApiClient.ts");
    assert.match(client, /branch:\s*result\.branch/);
  });

  await test("index-stats inventory is not filtered by stale UI branch", () => {
    const source = read("workspace/repoInventorySources.ts");
    assert.match(source, /fetchRepoInventoryViaCloud\(deps\.apiBaseUrl, candidate\)/);
    assert.doesNotMatch(source, /fetchRepoInventoryViaCloud\([^)]*,\s*branch\)/);
  });

  await test("branch resolution prefers indexed branch over workspace and UI", () => {
    const source = read("context/resolveRepoBranch.ts");
    const indexedPos = source.indexOf("resolveIndexedBranch");
    const workspacePos = source.indexOf("resolveWorkspaceBranch");
    const targetPos = source.indexOf("target.branch");
    assert.ok(indexedPos >= 0 && workspacePos > indexedPos && targetPos > workspacePos);
  });

  await test("resolveActiveRepoTarget is the shared consumer entry point", () => {
    const source = read("workspace/repoTargetResolver.ts");
    assert.match(source, /export async function resolveActiveRepoTarget/);
    assert.match(source, /fetchIndexedBranch/);
    assert.match(source, /resolveRepoBranchForTarget/);
  });
})();

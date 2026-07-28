import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/**
 * Guardrail: index (writer) and chat/summary (readers) must stay on the same
 * repo record. Fails CI when a parallel path bypasses the shared resolver or
 * reintroduces branch guessing.
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

  await test("indexed-repo consumers use resolveActiveRepoTarget", () => {
    for (const file of [
      "context/indexedRepoContextEnrichment.ts",
      "context/buildRepoSummaryContext.ts"
    ]) {
      assert.match(
        read(file),
        /resolveActiveRepoTarget/,
        `${file} must use the shared repo target resolver`
      );
    }
  });

  await test("understand-repo uses buildRepoSummaryEvidence as the single evidence path", () => {
    const session = read("chat/CoopChatSession.ts");
    assert.match(session, /fetchUnderstandRepoEvidence/);
    assert.match(session, /buildRepoSummaryEvidence\(/);
    assert.match(session, /COOP_EXTENSION_BUILD_ID/);
    assert.match(session, /isUnderstandRepo[\s\S]{0,400}?fetchUnderstandRepoEvidence/);
  });

  await test("repo summary builders do not hardcode main as branch fallback", () => {
    const source = read("context/buildRepoSummaryContext.ts");
    assert.doesNotMatch(source, /\?\?\s*"main"/);
  });

  await test("repoSummaryFromBundle treats inventory and tree as evidence", () => {
    const source = read("context/contextBundleEvidence.ts");
    assert.match(source, /data\.repoInventory/);
    assert.match(source, /hasTreeLayout/);
  });
})();

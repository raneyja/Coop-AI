import assert from "node:assert/strict";
import {
  isRepoInventoryQuery,
  isRepoStructureQuery,
  isUsableManifestInventory,
  mergeRepoInventoryContext,
  needsRepoTreeOverview,
  resolveInventoryRepoIds,
  type RepoInventoryStats
} from "./repoInventoryEnrichment";
import type { ContextFetchResult } from "./requestBatcher";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("isRepoInventoryQuery matches how-many-files questions", () => {
  assert.equal(isRepoInventoryQuery("how many files are inside of this repo?"), true);
  assert.equal(isRepoInventoryQuery("What's the file count?"), true);
  assert.equal(isRepoInventoryQuery("total number of files in the repository"), true);
  assert.equal(isRepoInventoryQuery("how big is this repo"), true);
  assert.equal(isRepoInventoryQuery("list all files in the codebase"), true);
});

test("isRepoInventoryQuery rejects implementation / which-files questions", () => {
  assert.equal(isRepoInventoryQuery("how does authentication work in this repo?"), false);
  assert.equal(isRepoInventoryQuery("which files import AuthService?"), false);
  assert.equal(isRepoInventoryQuery("how many files import lodash?"), false);
  assert.equal(isRepoInventoryQuery("show me the files that handle billing"), false);
});

test("isRepoStructureQuery covers monorepo / top-level structure questions", () => {
  assert.equal(isRepoStructureQuery("is this a monorepo?"), true);
  assert.equal(isRepoStructureQuery("what's the structure of this repo?"), true);
  assert.equal(isRepoStructureQuery("list the top-level directories"), true);
  assert.equal(isRepoStructureQuery("how many files are inside of this repo?"), true);
  assert.equal(isRepoStructureQuery("how does auth work?"), false);
});

test("needsRepoTreeOverview skips pure file-count questions", () => {
  assert.equal(needsRepoTreeOverview("how many files are inside of this repo?"), false);
  assert.equal(needsRepoTreeOverview("What's the file count?"), false);
  assert.equal(needsRepoTreeOverview("is this a monorepo?"), true);
  assert.equal(needsRepoTreeOverview("list the top-level directories"), true);
});

test("resolveInventoryRepoIds prefers provider-prefixed ids from bare owner/repo", () => {
  const resolved = resolveInventoryRepoIds("acme/coop-ai", { provider: "github" });
  assert.equal(resolved.preferred, "github:acme/coop-ai");
  assert.ok(resolved.candidates.includes("github:acme/coop-ai"));
  assert.ok(resolved.candidates.includes("acme/coop-ai"));
  assert.equal(resolved.coords?.owner, "acme");
  assert.equal(resolved.coords?.repo, "coop-ai");
});

test("isUsableManifestInventory rejects never-crawled empty manifests", () => {
  assert.equal(isUsableManifestInventory({ fileCount: 0, files: [] }), undefined);
  assert.deepEqual(isUsableManifestInventory({ fileCount: 0, lastCrawledAt: "2026-07-01T00:00:00.000Z" }), {
    fileCount: 0,
    lastCrawledAt: "2026-07-01T00:00:00.000Z"
  });
  assert.deepEqual(isUsableManifestInventory({ fileCount: 12 }), { fileCount: 12, lastCrawledAt: undefined });
});

test("mergeRepoInventoryContext attaches inventory and tree overview", () => {
  const base: ContextFetchResult = {
    requestId: "req",
    type: "chat_context",
    data: { context: { repo: "coop-ai" } },
    fetchedAt: new Date()
  };
  const inventory: RepoInventoryStats = { source: "manifest", fileCount: 1842, lastCrawledAt: "2026-07-01T00:00:00.000Z" };
  const merged = mergeRepoInventoryContext(base, inventory, {
    topLevelDirs: ["src", "docs"],
    topLevelFiles: ["package.json"]
  });
  const data = merged.data as {
    repoInventory?: RepoInventoryStats;
    treeOverview?: { topLevelDirs: string[] };
    context?: { repo?: string };
  };
  assert.equal(data.repoInventory?.fileCount, 1842);
  assert.deepEqual(data.treeOverview?.topLevelDirs, ["src", "docs"]);
  assert.equal(data.context?.repo, "coop-ai");
});

console.log(`\nrepoInventoryEnrichment: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

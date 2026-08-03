import assert from "node:assert/strict";
import { mergeRepoInventoryContext } from "./IndexedRepoWorkspace";
import type { ContextFetchResult } from "../context/requestBatcher";
import {
  collectPackageManifestCandidatePaths,
  filterManifestPathsToActiveRepoEvidence,
  isForeignStructureEvidencePath,
  isPackageParentDir,
  selectChildPackageManifestPaths,
  selectRootManifestPaths
} from "./repoPackageBoundaryEvidence";
import { isRepoPackageBoundaryQuery, needsPackageManifests, repoFactNeeds } from "./repoFactIntent";
import { shouldRunRepoSemanticRetrieval } from "../context/repoSemanticRetrieval";

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

test("plane package-boundary ask is structure intent and skips semantic retrieval", () => {
  const q = "Where are the Next.js / API package boundaries?";
  assert.equal(isRepoPackageBoundaryQuery(q), true);
  assert.equal(needsPackageManifests(q), true);
  assert.equal(repoFactNeeds(q).treeOverview, true);
  assert.equal(repoFactNeeds(q).packageManifests, true);
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: q,
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("selectRootManifestPaths prefers workspace manifests from tree", () => {
  const paths = selectRootManifestPaths({
    topLevelDirs: ["apps", "packages", "src"],
    topLevelFiles: ["package.json", "pnpm-workspace.yaml", "README.md", "turbo.json"]
  });
  assert.deepEqual(paths, ["package.json", "pnpm-workspace.yaml", "turbo.json"]);
});

test("selectChildPackageManifestPaths builds apps/web and apps/api paths", () => {
  const paths = selectChildPackageManifestPaths("apps", [
    { name: "web", type: "dir" },
    { name: "api", type: "dir" },
    { name: "README.md", type: "file" }
  ]);
  assert.deepEqual(paths, ["apps/web/package.json", "apps/api/package.json"]);
  assert.equal(isPackageParentDir("apps"), true);
  assert.equal(isPackageParentDir("src"), false);
});

test("collectPackageManifestCandidatePaths for plane-like tree prefers in-repo manifests", () => {
  const tree = {
    topLevelDirs: ["apps", "packages", "deployments"],
    topLevelFiles: ["package.json", "pnpm-workspace.yaml", "README.md"]
  };
  const listings = new Map([
    [
      "apps",
      [
        { name: "web", type: "dir" as const },
        { name: "api", type: "dir" as const },
        { name: "space", type: "dir" as const }
      ]
    ],
    [
      "packages",
      [
        { name: "ui", type: "dir" as const },
        { name: "constants", type: "dir" as const }
      ]
    ]
  ]);
  const paths = collectPackageManifestCandidatePaths(tree, listings);
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("pnpm-workspace.yaml"));
  assert.ok(paths.includes("apps/web/package.json"));
  assert.ok(paths.includes("apps/api/package.json"));
  assert.equal(paths.some((p) => p.includes("src/chat")), false);
});

test("filterManifestPathsToActiveRepoEvidence drops Coop-AI and wrong-repo bodies", () => {
  const planeId = "github:CoopAI-Corp/plane";
  const filtered = filterManifestPathsToActiveRepoEvidence(
    ["package.json", "apps/web/package.json", "apps/api/package.json"],
    planeId,
    [
      {
        path: "package.json",
        repoId: planeId,
        content: '{"name":"plane"}'
      },
      {
        path: "apps/web/package.json",
        repoId: planeId,
        content: '{"name":"web","dependencies":{"next":"14"}}'
      },
      {
        path: "apps/api/package.json",
        repoId: planeId,
        content: '{"name":"api"}'
      },
      {
        path: "src/chat/types.ts",
        repoId: "github:raneyja/Coop-AI",
        content: "export type RepoContext = {}"
      },
      {
        path: "package.json",
        repoId: "github:raneyja/Coop-AI",
        content: '{"name":"coop-ai"}'
      }
    ]
  );
  assert.equal(filtered.length, 3);
  assert.deepEqual(
    filtered.map((f) => f.path).sort(),
    ["apps/api/package.json", "apps/web/package.json", "package.json"]
  );
  assert.equal(
    filtered.every((f) => f.repoId === planeId),
    true
  );
  assert.equal(
    filtered.some((f) => f.path.includes("src/chat") || f.content.includes("coop-ai")),
    false
  );
});

test("isForeignStructureEvidencePath flags Coop chat bleed paths", () => {
  assert.equal(isForeignStructureEvidencePath("src/chat/types.ts"), true);
  assert.equal(isForeignStructureEvidencePath("apps/web/package.json"), false);
});

test("mergeRepoInventoryContext attaches plane tree + manifests, not inventory estimates", () => {
  const base: ContextFetchResult = {
    requestId: "req",
    type: "chat_context",
    data: { context: { owner: "CoopAI-Corp", repo: "plane" } },
    fetchedAt: new Date()
  };
  const merged = mergeRepoInventoryContext(
    base,
    undefined,
    { topLevelDirs: ["apps", "packages"], topLevelFiles: ["package.json"] },
    {
      entryFiles: [
        {
          path: "apps/web/package.json",
          content: '{"name":"web"}',
          repoId: "github:CoopAI-Corp/plane"
        },
        {
          path: "apps/api/package.json",
          content: '{"name":"api"}',
          repoId: "github:CoopAI-Corp/plane"
        }
      ]
    }
  );
  const data = merged.data as {
    treeOverview?: { topLevelDirs: string[] };
    entryFiles?: Array<{ path: string; repoId?: string }>;
    repoInventory?: unknown;
  };
  assert.deepEqual(data.treeOverview?.topLevelDirs, ["apps", "packages"]);
  assert.equal(data.entryFiles?.length, 2);
  assert.equal(data.entryFiles?.every((f) => f.path.startsWith("apps/")), true);
  assert.equal(data.entryFiles?.some((f) => f.path.includes("src/chat")), false);
  assert.equal(data.repoInventory, undefined);
});

test("mergeRepoInventoryContext records unavailable note without inventing layout", () => {
  const base: ContextFetchResult = {
    requestId: "req",
    type: "chat_context",
    data: {},
    fetchedAt: new Date()
  };
  const merged = mergeRepoInventoryContext(base, undefined, undefined, {
    packageBoundaryNote:
      "Repository tree overview is unavailable for the active Use-repo. Say package layout / boundaries are unavailable."
  });
  const data = merged.data as { packageBoundaryNote?: string; entryFiles?: unknown[]; treeOverview?: unknown };
  assert.ok(data.packageBoundaryNote?.includes("unavailable"));
  assert.equal(data.entryFiles, undefined);
  assert.equal(data.treeOverview, undefined);
});

console.log(`\nrepoPackageBoundaryEvidence: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { mergeRepoInventoryContext } from "./IndexedRepoWorkspace";
import type { ContextFetchResult } from "../context/requestBatcher";
import {
  answerInventsVaguePackageStructure,
  answerIsRootTreeWithoutChildPackages,
  answerLacksConcretePackageNames,
  buildTopLevelPackageStructure,
  collectPackageManifestCandidatePaths,
  commonChildPackageNames,
  enrichPackageStructureResponse,
  extractWorkspaceGlobs,
  filterManifestPathsToActiveRepoEvidence,
  isForeignStructureEvidencePath,
  isPackageParentDir,
  mergePackagesFromLoadedManifests,
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

test("documenso top-level package structure ask is package-boundary intent", () => {
  const q = "What's in the top-level package structure?";
  assert.equal(isRepoPackageBoundaryQuery(q), true);
  assert.equal(needsPackageManifests(q), true);
  assert.equal(repoFactNeeds(q).treeOverview, true);
  assert.equal(repoFactNeeds(q).packageManifests, true);
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

test("buildTopLevelPackageStructure lists concrete documenso-shaped names from tree", () => {
  const tree = {
    topLevelDirs: ["apps", "packages"],
    topLevelFiles: ["package.json", "pnpm-workspace.yaml", "README.md"]
  };
  const listings = new Map([
    [
      "apps",
      [
        { name: "remix", type: "dir" as const },
        { name: "documentation", type: "dir" as const },
        { name: "README.md", type: "file" as const }
      ]
    ],
    [
      "packages",
      [
        { name: "signing", type: "dir" as const },
        { name: "prisma", type: "dir" as const },
        { name: "ui", type: "dir" as const },
        { name: "tsconfig.json", type: "file" as const }
      ]
    ]
  ]);
  const structure = buildTopLevelPackageStructure(tree, listings, {
    workspaceGlobs: ["apps/*", "packages/*"]
  });
  assert.deepEqual(structure.parents, ["apps", "packages"]);
  assert.ok(structure.packages.includes("apps/remix"));
  assert.ok(structure.packages.includes("packages/signing"));
  assert.ok(structure.packages.includes("packages/prisma"));
  assert.ok(structure.packages.includes("packages/ui"));
  assert.equal(structure.packages.includes("apps/*"), false);
  assert.equal(structure.packages.includes("packages/*"), false);
  assert.deepEqual(structure.workspaceGlobs, ["apps/*", "packages/*"]);
  // Files under parents are not packages
  assert.equal(structure.packages.some((p) => p.endsWith("README.md")), false);
  assert.equal(structure.packages.some((p) => p.endsWith("tsconfig.json")), false);
});

test("buildTopLevelPackageStructure does not invent names when listings missing", () => {
  const tree = {
    topLevelDirs: ["apps", "packages"],
    topLevelFiles: ["package.json"]
  };
  const structure = buildTopLevelPackageStructure(tree, new Map(), {
    workspaceGlobs: ["apps/*", "packages/*"]
  });
  assert.deepEqual(structure.packages, []);
  assert.deepEqual(structure.parents, ["apps", "packages"]);
  assert.deepEqual(structure.workspaceGlobs, ["apps/*", "packages/*"]);
});

test("extractWorkspaceGlobs reads npm and pnpm-style workspaces", () => {
  assert.deepEqual(extractWorkspaceGlobs('{"workspaces":["apps/*","packages/*"]}'), [
    "apps/*",
    "packages/*"
  ]);
  assert.deepEqual(
    extractWorkspaceGlobs('{"workspaces":{"packages":["apps/*","packages/*"]}}'),
    ["apps/*", "packages/*"]
  );
  assert.equal(extractWorkspaceGlobs("{not json"), undefined);
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
      ],
      packageStructure: {
        packages: ["apps/web", "apps/api", "packages/ui"],
        parents: ["apps", "packages"],
        workspaceGlobs: ["apps/*", "packages/*"]
      }
    }
  );
  const data = merged.data as {
    treeOverview?: { topLevelDirs: string[] };
    entryFiles?: Array<{ path: string; repoId?: string }>;
    repoInventory?: unknown;
    packageStructure?: { packages: string[]; workspaceGlobs?: string[] };
  };
  assert.deepEqual(data.treeOverview?.topLevelDirs, ["apps", "packages"]);
  assert.equal(data.entryFiles?.length, 2);
  assert.equal(data.entryFiles?.every((f) => f.path.startsWith("apps/")), true);
  assert.equal(data.entryFiles?.some((f) => f.path.includes("src/chat")), false);
  assert.equal(data.repoInventory, undefined);
  assert.ok(data.packageStructure?.packages.includes("apps/web"));
  assert.ok(data.packageStructure?.packages.includes("packages/ui"));
  assert.deepEqual(data.packageStructure?.workspaceGlobs, ["apps/*", "packages/*"]);
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
  const data = merged.data as {
    packageBoundaryNote?: string;
    entryFiles?: unknown[];
    treeOverview?: unknown;
    packageStructure?: unknown;
  };
  assert.ok(data.packageBoundaryNote?.includes("unavailable"));
  assert.equal(data.entryFiles, undefined);
  assert.equal(data.treeOverview, undefined);
  assert.equal(data.packageStructure, undefined);
});

test("mergePackagesFromLoadedManifests fills packages when listings were empty", () => {
  const merged = mergePackagesFromLoadedManifests(
    { packages: [], parents: ["apps", "packages"], workspaceGlobs: ["apps/*", "packages/*"] },
    [
      { path: "apps/web/package.json" },
      { path: "apps/api/package.json" },
      { path: "packages/ui/package.json" },
      { path: "package.json" }
    ]
  );
  assert.deepEqual(merged.packages, ["apps/api", "apps/web", "packages/ui"]);
});

test("enrichPackageStructureResponse injects concrete names over glob-only answers", () => {
  const vague =
    "Look at workspaces apps/* and packages/*. If you have access, look for next.config.js.";
  assert.equal(
    answerLacksConcretePackageNames(vague, ["apps/web", "apps/api", "packages/ui"]),
    true
  );
  const enriched = enrichPackageStructureResponse(vague, ["apps/web", "apps/api", "packages/ui"], {
    workspaceGlobs: ["apps/*", "packages/*"]
  });
  assert.ok(enriched.includes("apps/web"));
  assert.ok(enriched.includes("apps/api"));
  assert.ok(enriched.includes("packages/ui"));
});

test("empty listings still probe common child package.json paths", () => {
  const tree = {
    topLevelDirs: ["apps", "packages"],
    topLevelFiles: ["package.json"],
    truncated: false
  };
  const paths = collectPackageManifestCandidatePaths(tree, new Map());
  assert.ok(paths.includes("apps/remix/package.json") || paths.includes("apps/web/package.json"));
  assert.ok(
    paths.includes("packages/signing/package.json") || paths.includes("packages/ui/package.json")
  );
  assert.ok(commonChildPackageNames("apps").includes("web"));
});

test("enrichPackageStructureResponse blocks vague invention when packages unresolved", () => {
  const vague = "Look for folders under apps/ and packages/* for Next.js apps.";
  assert.equal(answerInventsVaguePackageStructure(vague), true);
  const enriched = enrichPackageStructureResponse(vague, [], { parents: ["apps", "packages"] });
  assert.ok(/unavailable/i.test(enriched));
  assert.ok(enriched.includes("apps"));
  assert.ok(!/^Look for folders/i.test(enriched.trim()));
});

test("enrichPackageStructureResponse flags root-tree dump without child packages", () => {
  const rootOnly = `**Summary**
Top-level directories: apps, packages, scripts.
Files: package.json, turbo.json.`;
  assert.equal(answerIsRootTreeWithoutChildPackages(rootOnly, ["apps", "packages"]), true);
  const enriched = enrichPackageStructureResponse(rootOnly, [], { parents: ["apps", "packages"] });
  assert.ok(/unavailable|could not be listed/i.test(enriched));
});

test("empty listing probes prefer remix/signing ahead of filler names", () => {
  assert.equal(commonChildPackageNames("apps")[0], "remix");
  assert.equal(commonChildPackageNames("packages")[0], "signing");
  const tree = {
    topLevelDirs: ["apps", "packages"],
    topLevelFiles: ["package.json"],
    truncated: false
  };
  const paths = collectPackageManifestCandidatePaths(tree, new Map());
  assert.ok(paths.includes("apps/remix/package.json"));
  assert.ok(paths.includes("packages/signing/package.json"));
});

console.log(`\nrepoPackageBoundaryEvidence: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import * as path from "node:path";
import {
  classifyDependentSurface,
  codePathsFromDependentDetails,
  extractBlastSearchSymbols,
  extractExportNamesFromSource,
  buildImportSearchPatterns,
  buildLocalCallerNeedles,
  groupDependentsByTopLevelFolder,
  hitLooksLikeReferenceToTarget,
  isDocsReferencePath,
  isGenericBlastImpactAsk,
  isVerifiedCallerSearchSource,
  mergeDurableDependentsIntoContextData,
  mergeSearchDependentsFallbackIntoDependenciesData,
  rankCodeDependentsByRisk,
  resolveTrustedRemoteDependents,
  scoreDependentRisk,
  searchDependentsFallback,
  searchDependentsInLocalRoots,
  sortDependentsProductionFirst,
  splitBlastRadiusDependents,
  type BlastRadiusDependentDetail
} from "./blastRadiusDependentsFallback";
import type { IndexBackend } from "../indexing/indexBackend";
import type { LocalDependentsResult, LocalSearchResult } from "../indexing/types";

let passed = 0;
let failed = 0;
const asyncTests: Array<Promise<void>> = [];

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

function testAsync(name: string, fn: () => Promise<void>): void {
  asyncTests.push(
    (async () => {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    })()
  );
}

test("isDocsReferencePath detects markdown, docs trees, and d.ts", () => {
  assert.equal(isDocsReferencePath("README.md"), true);
  assert.equal(isDocsReferencePath("docs/Guides/Testing.md"), true);
  assert.equal(isDocsReferencePath("fastify.d.ts"), true);
  assert.equal(isDocsReferencePath("test/logger/logging.test.js"), false);
  assert.equal(isDocsReferencePath("examples/https.js"), false);
});

test("splitBlastRadiusDependents separates code from docs references", () => {
  const split = splitBlastRadiusDependents([
    { path: "examples/https.js", depth: 1, source: "heuristic" },
    { path: "README.md", depth: 1, source: "zoekt" },
    { path: "docs/Guides/Testing.md", depth: 1, source: "zoekt" }
  ]);
  assert.equal(split.codeDependentDetails.length, 1);
  assert.equal(split.docsReferences.length, 2);
  const paths = codePathsFromDependentDetails(split.codeDependentDetails);
  assert.deepEqual(paths.directDependents, ["examples/https.js"]);
});

test("groupDependentsByTopLevelFolder buckets by top-level folder", () => {
  const groups = groupDependentsByTopLevelFolder([
    { path: "test/a.test.js", depth: 1, source: "zoekt" },
    { path: "test/b.test.js", depth: 1, source: "zoekt" },
    { path: "examples/https.js", depth: 1, source: "heuristic" }
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.label === "test/")?.entries.length, 2);
});

test("rankCodeDependentsByRisk prioritizes production and integration over tests", () => {
  const ranked = rankCodeDependentsByRisk([
    { path: "README.md", depth: 1, source: "zoekt" },
    { path: "test/logger/logging.test.js", depth: 1, source: "heuristic" },
    { path: "integration/server.js", depth: 1, source: "heuristic" },
    { path: "examples/https.js", depth: 1, source: "heuristic" },
    { path: "src/services/logger.ts", depth: 1, source: "scip" }
  ]);
  assert.equal(ranked.length, 4);
  assert.equal(ranked[0]?.path, "src/services/logger.ts");
  assert.ok(ranked[0]?.riskReason.toLowerCase().includes("production"));
  assert.equal(ranked[1]?.path, "integration/server.js");
  assert.ok(ranked.some((entry) => entry.path === "examples/https.js"));
  assert.ok(!ranked.some((entry) => entry.path === "README.md"));
  const testEntry = ranked.find((entry) => entry.path === "test/logger/logging.test.js");
  assert.ok(testEntry);
  assert.ok(/test surface/i.test(testEntry.riskReason));
  assert.ok((ranked[0]?.riskScore ?? 0) > (testEntry.riskScore ?? 0));
});

test("rankCodeDependentsByRisk prefers prod module over story and e2e", () => {
  const mixed: BlastRadiusDependentDetail[] = [
    {
      path: "apps/web/components/StateGroup.stories.tsx",
      depth: 1,
      source: "heuristic"
    },
    {
      path: "e2e/specs/state-group.spec.ts",
      depth: 1,
      source: "zoekt"
    },
    {
      path: "apps/web/components/StateGroupSelect.tsx",
      depth: 1,
      source: "scip"
    },
    {
      path: "packages/ui/src/state-group/index.ts",
      depth: 1,
      source: "scip"
    }
  ];
  const ranked = rankCodeDependentsByRisk(mixed, 5);
  assert.ok(ranked.length >= 3);
  assert.equal(ranked[0]?.path, "apps/web/components/StateGroupSelect.tsx");
  assert.ok(/production/i.test(ranked[0]?.riskReason ?? ""));
  const story = ranked.find((entry) => entry.path.includes(".stories."));
  const e2e = ranked.find((entry) => entry.path.includes("e2e/"));
  assert.ok(story);
  assert.ok(e2e);
  assert.ok(/test surface/i.test(story.riskReason));
  assert.ok(/test surface/i.test(e2e.riskReason));
  assert.ok((ranked[0]?.riskScore ?? 0) > (story.riskScore ?? 0));
  assert.ok((ranked[0]?.riskScore ?? 0) > (e2e.riskScore ?? 0));
  // Stories/e2e must not occupy the top slot when production edges exist.
  assert.ok(!ranked[0]?.path.includes(".stories."));
  assert.ok(!ranked[0]?.path.includes("e2e/"));
});

test("smoke-shaped StateGroup blast is not story-dominated when prod edges exist", () => {
  const fixture: BlastRadiusDependentDetail[] = [
    { path: "apps/web/components/inbox/StateGroup.stories.tsx", depth: 1, source: "heuristic" },
    { path: "apps/web/components/issues/StateGroupBadge.tsx", depth: 1, source: "scip" },
    { path: "packages/constants/src/state-group.ts", depth: 1, source: "scip" },
    { path: "apps/web/ce/components/StateGroup.stories.tsx", depth: 1, source: "heuristic" }
  ];
  const ranked = rankCodeDependentsByRisk(fixture, 3);
  const topPaths = ranked.map((entry) => entry.path);
  assert.ok(topPaths.includes("apps/web/components/issues/StateGroupBadge.tsx"));
  assert.ok(topPaths.includes("packages/constants/src/state-group.ts"));
  assert.equal(
    ranked.filter((entry) => entry.path.includes(".stories.")).length <= 1,
    true,
    "at most one story in top-3 when prod callers exist"
  );
  assert.ok(!ranked[0]?.path.includes(".stories."));
});

test("smoke-shaped DocumentStatus blast surfaces non-test refs when present", () => {
  const fixture: BlastRadiusDependentDetail[] = [
    { path: "packages/lib/server/document-status.ts", depth: 1, source: "scip" },
    { path: "apps/web/app/(dashboard)/documents/[id]/page.tsx", depth: 1, source: "scip" },
    { path: "packages/ui/src/document-status.tsx", depth: 1, source: "scip" },
    { path: "e2e/document-status.spec.ts", depth: 1, source: "zoekt" },
    { path: "packages/lib/server/document-status.test.ts", depth: 1, source: "heuristic" }
  ];
  const ranked = rankCodeDependentsByRisk(fixture, 5);
  const production = ranked.filter((entry) => classifyDependentSurface(entry.path) === "production");
  assert.ok(production.length >= 2, "expected production callers in top risk");
  assert.equal(ranked[0]?.path.includes("e2e/"), false);
  assert.equal(ranked[0]?.path.includes(".test."), false);
  assert.ok(
    ranked.some((entry) => entry.path === "apps/web/app/(dashboard)/documents/[id]/page.tsx")
  );
  assert.ok(ranked.some((entry) => entry.path === "packages/ui/src/document-status.tsx"));
});

test("sortDependentsProductionFirst orders mixed dependents for list display", () => {
  const sorted = sortDependentsProductionFirst([
    { path: "e2e/foo.spec.ts", depth: 1, source: "zoekt" },
    { path: "src/foo/Bar.tsx", depth: 1, source: "scip" },
    { path: "src/foo/Bar.stories.tsx", depth: 1, source: "heuristic" }
  ]);
  assert.equal(sorted[0]?.path, "src/foo/Bar.tsx");
  assert.ok(sorted[1]?.path.includes(".stories.") || sorted[1]?.path.includes("e2e/"));
});

test("scoreDependentRisk labels stories and e2e as test surfaces", () => {
  assert.ok(/test surface/i.test(scoreDependentRisk("Foo.stories.tsx", 1).reason));
  assert.ok(/test surface/i.test(scoreDependentRisk("e2e/flows/login.spec.ts", 1).reason));
  assert.ok(/production/i.test(scoreDependentRisk("lib/core/login.ts", 1).reason));
});

test("extractBlastSearchSymbols prefers StateGroup from smoke ask", () => {
  const symbols = extractBlastSearchSymbols(
    "What breaks if we change or rename the StateGroup values (e.g. started / completed)?",
    "apps/api/plane/db/models/state.py"
  );
  assert.ok(symbols.includes("StateGroup"));
});

test("isGenericBlastImpactAsk ignores default chip copy", () => {
  assert.equal(isGenericBlastImpactAsk("Estimate the impact of changing this code."), true);
  assert.equal(isGenericBlastImpactAsk("What breaks if we rename StateGroup?"), false);
});

test("extractBlastSearchSymbols skips default blast ask (no Estimate noise)", () => {
  assert.deepEqual(
    extractBlastSearchSymbols("Estimate the impact of changing this code.", "src/config/responseDeadline.ts"),
    []
  );
});

test("isVerifiedCallerSearchSource rejects embedding and fallback", () => {
  assert.equal(isVerifiedCallerSearchSource("zoekt"), true);
  assert.equal(isVerifiedCallerSearchSource("scip"), true);
  assert.equal(isVerifiedCallerSearchSource("embedding"), false);
  assert.equal(isVerifiedCallerSearchSource("fallback"), false);
});

test("hitLooksLikeReferenceToTarget requires stem when content is a code line", () => {
  assert.equal(
    hitLooksLikeReferenceToTarget(
      { fileName: "src/chat/CoopChatSession.ts", content: `import { x } from "../config/responseDeadline";` },
      "src/config/responseDeadline.ts"
    ),
    true
  );
  assert.equal(
    hitLooksLikeReferenceToTarget(
      {
        fileName: "admin/src/components/IndexingQueueList.tsx",
        content: "export function IndexingQueueList() { return null; }"
      },
      "src/config/responseDeadline.ts"
    ),
    false
  );
});

test("buildImportSearchPatterns includes path suffixes for relative imports", () => {
  const patterns = buildImportSearchPatterns("src/config/responseDeadline.ts");
  assert.ok(patterns.includes("config/responseDeadline"));
  assert.ok(patterns.includes("src/config/responseDeadline"));
  assert.ok(patterns.indexOf("config/responseDeadline") < 10);
});

test("extractExportNamesFromSource includes Python class names", () => {
  const names = extractExportNamesFromSource(`
class StateGroup(models.TextChoices):
    BACKLOG = "backlog", "Backlog"
`);
  assert.ok(names.includes("StateGroup"));
});

test("extractExportNamesFromSource prefers distinctive exports", () => {
  const names = extractExportNamesFromSource(`
export const MAX_USER_FACING_RESPONSE_MS = 15_000;
export function remainingContextGatherBudgetMs() {}
export const RESERVED_SYNTHESIS_MS = 6_000;
`);
  assert.ok(names.includes("MAX_USER_FACING_RESPONSE_MS"));
  assert.ok(names.includes("remainingContextGatherBudgetMs"));
});

test("buildLocalCallerNeedles includes path suffixes and exports", () => {
  const needles = buildLocalCallerNeedles("src/config/responseDeadline.ts", [
    "MAX_USER_FACING_RESPONSE_MS"
  ]);
  assert.ok(needles.includes("config/responseDeadline"));
  assert.ok(needles.includes("MAX_USER_FACING_RESPONSE_MS"));
});

test("searchDependentsInLocalRoots finds real responseDeadline importers", () => {
  const roots = [path.resolve(__dirname, "../..")];
  const result = searchDependentsInLocalRoots(roots, "src/config/responseDeadline.ts", {
    symbols: ["MAX_USER_FACING_RESPONSE_MS", "remainingContextGatherBudgetMs"],
    maxHits: 20
  });
  assert.ok(result.dependents.length > 0, "expected local callers");
  const paths = result.dependents.map((entry) => entry.path);
  assert.ok(
    paths.some((p) => p.includes("CoopChatSession") || p.includes("JobApiClient")),
    `expected real importer, got ${paths.slice(0, 8).join(", ")}`
  );
  assert.equal(result.source, "workspace");
  assert.ok(!paths.includes("admin/src/components/IndexingQueueList.tsx"));
});

testAsync("searchDependentsFallback ignores localRoots by default (Zero-Clone)", async () => {
  const roots = [path.resolve(__dirname, "../..")];
  const stubBackend = {
    isEnabledForRepo: async () => false,
    search: async () => ({ hits: [], source: "remote" as const })
  };
  const result = await searchDependentsFallback(
    stubBackend as never,
    "github:raneyja/Coop-AI",
    "src/config/responseDeadline.ts",
    {
      localRoots: roots,
      symbols: ["MAX_USER_FACING_RESPONSE_MS"]
    }
  );
  assert.equal(result.dependents.length, 0);
  assert.notEqual(result.source, "workspace");
});

test("buildImportSearchPatterns includes symbol and alias forms", () => {
  const patterns = buildImportSearchPatterns("apps/api/plane/db/models/state.py", ["StateGroup"]);
  assert.ok(patterns.some((p) => p.includes("StateGroup")));
  assert.ok(patterns.some((p) => p.includes("@/")));
  assert.ok(patterns.some((p) => p.includes("from state import")));
});

test("mergeSearchDependentsFallbackIntoDependenciesData fills callers when job sample empty", () => {
  const merged = mergeSearchDependentsFallbackIntoDependenciesData(
    {
      file: "apps/api/plane/db/models/state.py",
      jobScan: { source: "dependency-graph-job", edgeCount: 0, dependentsSample: [] }
    },
    {
      dependents: [
        { path: "apps/api/plane/api/views/issue.py", depth: 1, source: "zoekt" },
        { path: "apps/web/core/components/issues/issue-detail.tsx", depth: 1, source: "zoekt" }
      ],
      source: "zoekt",
      warnings: []
    }
  );
  assert.deepEqual(merged.directDependents, [
    "apps/api/plane/api/views/issue.py",
    "apps/web/core/components/issues/issue-detail.tsx"
  ]);
  assert.ok((merged.warnings as string[]).some((w) => /import\/symbol search/i.test(w)));
  assert.equal((merged.graphMeta as { source: string }).source, "zoekt");
});

test("mergeSearchDependentsFallbackIntoDependenciesData replaces junk job callers with search hits", () => {
  const merged = mergeSearchDependentsFallbackIntoDependenciesData(
    {
      file: "src/config/responseDeadline.ts",
      directDependents: [
        "admin/src/lib/activeGrantRepoIds.ts",
        "src/api/dataSanitization.ts"
      ],
      jobScan: { source: "dependency-graph-job", dependentsSample: [] }
    },
    {
      dependents: [
        { path: "src/chat/CoopChatSession.ts", depth: 1, source: "zoekt" },
        { path: "src/jobs/JobApiClient.ts", depth: 1, source: "zoekt" }
      ],
      source: "zoekt",
      warnings: []
    }
  );
  assert.deepEqual(merged.directDependents, [
    "src/chat/CoopChatSession.ts",
    "src/jobs/JobApiClient.ts"
  ]);
  assert.ok(!(merged.directDependents as string[]).includes("admin/src/lib/activeGrantRepoIds.ts"));
});

test("mergeSearchDependentsFallbackIntoDependenciesData clears junk when search empty", () => {
  const merged = mergeSearchDependentsFallbackIntoDependenciesData(
    {
      file: "src/config/responseDeadline.ts",
      directDependents: ["admin/src/lib/activeGrantRepoIds.ts"]
    },
    { dependents: [], source: "remote", warnings: [] }
  );
  assert.deepEqual(merged.directDependents, []);
  assert.ok((merged.warnings as string[]).some((w) => /Impact unverified/i.test(w)));
});

test("mergeSearchDependentsFallbackIntoDependenciesData can keep filtered job edges when search empty", () => {
  const merged = mergeSearchDependentsFallbackIntoDependenciesData(
    {
      file: "fastify.js",
      directDependents: ["test/app.test.js"]
    },
    { dependents: [], source: "remote", warnings: [] },
    { keepFilteredJobDependentsIfSearchEmpty: true }
  );
  assert.deepEqual(merged.directDependents, ["test/app.test.js"]);
});

test("mergeDurableDependentsIntoContextData sets directDependents + import-parse source", () => {
  const merged = mergeDurableDependentsIntoContextData(
    { file: "src/config/responseDeadline.ts" },
    {
      dependents: [
        { path: "src/chat/CoopChatSession.ts", depth: 1, source: "import-parse" },
        { path: "src/engines/blastRadiusAnalysis.ts", depth: 1, source: "import-parse" }
      ],
      source: "import-parse",
      warnings: ["Dependents from durable import-parse graph — 2 direct caller(s)."]
    }
  );
  assert.deepEqual(merged.directDependents, [
    "src/chat/CoopChatSession.ts",
    "src/engines/blastRadiusAnalysis.ts"
  ]);
  assert.equal((merged.graphMeta as { source: string }).source, "import-parse");
});

asyncTests.push(
  (async () => {
    const name = "resolveTrustedRemoteDependents uses durable import-parse without localRoots";
    try {
      let searchCalled = false;
      const backend = {
        kind: "cloud" as const,
        isEnabledForRepo: async () => true,
        dependents: async (): Promise<LocalDependentsResult> => ({
          file: "src/config/responseDeadline.ts",
          dependents: [
            "src/chat/CoopChatSession.ts",
            "src/engines/blastRadiusAnalysis.ts",
            "src/jobs/JobApiClient.ts"
          ],
          source: "import-parse"
        }),
        search: async (): Promise<LocalSearchResult> => {
          searchCalled = true;
          return { source: "zoekt", hits: [], symbols: [], stale: false };
        }
      } as unknown as IndexBackend;

      const resolved = await resolveTrustedRemoteDependents(
        backend,
        "github:raneyja/Coop-AI",
        "src/config/responseDeadline.ts",
        { enrichWithSearch: false }
      );
      assert.equal(resolved.source, "import-parse");
      assert.equal(resolved.dependents.length, 3);
      assert.equal(searchCalled, false);
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  })()
);

void Promise.all(asyncTests).then(() => {
  const total = passed + failed;
  console.log(`\nblastRadiusDependentsFallback: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
});

import assert from "node:assert/strict";
import {
  classifyDependentSurface,
  codePathsFromDependentDetails,
  extractBlastSearchSymbols,
  buildImportSearchPatterns,
  groupDependentsByTopLevelFolder,
  isDocsReferencePath,
  rankCodeDependentsByRisk,
  scoreDependentRisk,
  sortDependentsProductionFirst,
  splitBlastRadiusDependents,
  type BlastRadiusDependentDetail
} from "./blastRadiusDependentsFallback";

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

test("buildImportSearchPatterns includes symbol and alias forms", () => {
  const patterns = buildImportSearchPatterns("apps/api/plane/db/models/state.py", ["StateGroup"]);
  assert.ok(patterns.some((p) => p.includes("StateGroup")));
  assert.ok(patterns.some((p) => p.includes("@/")));
  assert.ok(patterns.some((p) => p.includes("from state import")));
});

const total = passed + failed;
console.log(`\nblastRadiusDependentsFallback: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import {
  codePathsFromDependentDetails,
  groupDependentsByTopLevelFolder,
  isDocsReferencePath,
  rankCodeDependentsByRisk,
  splitBlastRadiusDependents
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

test("rankCodeDependentsByRisk prioritizes integration and examples over docs", () => {
  const ranked = rankCodeDependentsByRisk([
    { path: "README.md", depth: 1, source: "zoekt" },
    { path: "test/logger/logging.test.js", depth: 1, source: "heuristic" },
    { path: "integration/server.js", depth: 1, source: "heuristic" },
    { path: "examples/https.js", depth: 1, source: "heuristic" }
  ]);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0]?.path, "integration/server.js");
  assert.ok(ranked.some((entry) => entry.path === "examples/https.js"));
  assert.ok(!ranked.some((entry) => entry.path === "README.md"));
});

const total = passed + failed;
console.log(`\nblastRadiusDependentsFallback: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import {
  hasRepoFactNeed,
  isRepoFileCountQuery,
  isRepoInventoryQuery,
  isRepoLineCountQuery,
  isRepoPackageBoundaryQuery,
  isRepoStructureQuery,
  needsPackageManifests,
  needsRepoTreeOverview,
  repoFactNeeds
} from "./repoFactIntent";

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

test("isRepoFileCountQuery matches how-many-files questions", () => {
  assert.equal(isRepoFileCountQuery("how many files are inside of this repo?"), true);
  assert.equal(isRepoFileCountQuery("What's the file count?"), true);
  assert.equal(isRepoFileCountQuery("total number of files in the repository"), true);
  assert.equal(isRepoFileCountQuery("how big is this repo"), true);
  assert.equal(isRepoFileCountQuery("list all files in the codebase"), true);
});

test("isRepoFileCountQuery rejects implementation / which-files questions", () => {
  assert.equal(isRepoFileCountQuery("how does authentication work in this repo?"), false);
  assert.equal(isRepoFileCountQuery("which files import AuthService?"), false);
  assert.equal(isRepoFileCountQuery("how many files import lodash?"), false);
  assert.equal(isRepoFileCountQuery("show me the files that handle billing"), false);
});

test("isRepoLineCountQuery covers every LOC phrasing that used to be invented", () => {
  assert.equal(isRepoLineCountQuery("how many lines of code are in this repo in total?"), true);
  assert.equal(isRepoLineCountQuery("HOW MANY LINES OF CODE"), true);
  assert.equal(isRepoLineCountQuery("how many lines in this repo?"), true);
  assert.equal(isRepoLineCountQuery("what's the LOC?"), true);
  assert.equal(isRepoLineCountQuery("total lines"), true);
  assert.equal(isRepoLineCountQuery("line count"), true);
});

test("isRepoLineCountQuery leaves scoped line questions to search", () => {
  assert.equal(isRepoLineCountQuery("how many lines in this function?"), false);
  assert.equal(isRepoLineCountQuery("how many lines of this file are tests?"), false);
  assert.equal(isRepoLineCountQuery("how does auth work?"), false);
});

test("differently worded LOC questions produce the same needs", () => {
  const a = repoFactNeeds("how many lines of code are in this repo in total?");
  const b = repoFactNeeds("HOW MANY LINES OF CODE");
  assert.deepEqual(a, b);
  assert.equal(a.lineCount, true);
  // Line answers carry the file total from the same lookup.
  assert.equal(a.fileCount, true);
  assert.equal(a.packageManifests, false);
});

test("LOC questions are inventory + structure questions, so they never route to a sample", () => {
  assert.equal(isRepoInventoryQuery("how many lines of code are in this repo?"), true);
  assert.equal(isRepoStructureQuery("how many lines of code are in this repo?"), true);
  assert.equal(hasRepoFactNeed(repoFactNeeds("how many lines of code?")), true);
  assert.equal(hasRepoFactNeed(repoFactNeeds("how does billing work?")), false);
});

test("isRepoStructureQuery covers monorepo / top-level structure questions", () => {
  assert.equal(isRepoStructureQuery("is this a monorepo?"), true);
  assert.equal(isRepoStructureQuery("what's the structure of this repo?"), true);
  assert.equal(isRepoStructureQuery("list the top-level directories"), true);
  assert.equal(isRepoStructureQuery("how does auth work?"), false);
});

test("isRepoPackageBoundaryQuery covers Next.js / API package boundary smoke ask", () => {
  assert.equal(
    isRepoPackageBoundaryQuery("Where are the Next.js / API package boundaries?"),
    true
  );
  assert.equal(isRepoStructureQuery("Where are the Next.js / API package boundaries?"), true);
  assert.equal(needsRepoTreeOverview("Where are the Next.js / API package boundaries?"), true);
  assert.equal(needsPackageManifests("Where are the Next.js / API package boundaries?"), true);
  assert.equal(repoFactNeeds("Where are the Next.js / API package boundaries?").packageManifests, true);
  assert.equal(isRepoPackageBoundaryQuery("what's the monorepo layout?"), true);
  assert.equal(isRepoPackageBoundaryQuery("how does auth middleware work?"), false);
});

test("needsRepoTreeOverview skips pure count questions", () => {
  assert.equal(needsRepoTreeOverview("how many files are inside of this repo?"), false);
  assert.equal(needsRepoTreeOverview("how many lines of code?"), false);
  assert.equal(needsRepoTreeOverview("is this a monorepo?"), true);
  assert.equal(repoFactNeeds("is this a monorepo?").treeOverview, true);
  assert.equal(repoFactNeeds("is this a monorepo?").packageManifests, true);
});

console.log(`\nrepoFactIntent: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

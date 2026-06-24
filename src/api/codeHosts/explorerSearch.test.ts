import assert from "node:assert/strict";
import { buildExplorerFileSearchQuery, formatGithubRepoSearchClause } from "./explorerSearch";

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

test("buildExplorerFileSearchQuery uses path for slash-separated paths", () => {
  assert.equal(
    buildExplorerFileSearchQuery("src/server/githubAppApi.ts", "github"),
    "path:src/server/githubAppApi.ts"
  );
});

test("buildExplorerFileSearchQuery uses filename for file extensions", () => {
  assert.equal(buildExplorerFileSearchQuery("githubAppApi.ts", "github"), "filename:githubAppApi.ts");
});

test("buildExplorerFileSearchQuery uses path for bare stems", () => {
  assert.equal(buildExplorerFileSearchQuery("githubAppApi", "github"), "path:githubAppApi");
});

test("formatGithubRepoSearchClause quotes hyphenated repos", () => {
  assert.equal(formatGithubRepoSearchClause("raneyja", "Coop-AI"), 'repo:"raneyja/Coop-AI"');
});

test("formatGithubRepoSearchClause leaves simple repos unquoted", () => {
  assert.equal(formatGithubRepoSearchClause("octocat", "hello"), "repo:octocat/hello");
});

console.log(`\nexplorerSearch: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { rankExplorerFilePaths } from "./explorerFileTreeSearch";

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

const paths = [
  "src/server/githubAppApi.ts",
  "src/server/githubAppService.ts",
  "src/server/githubOAuthService.ts",
  "src/extension.ts",
  "README.md"
];

test("rankExplorerFilePaths prefers exact filename matches", () => {
  const hits = rankExplorerFilePaths(paths, "githubAppApi.ts", 5);
  assert.equal(hits[0], "src/server/githubAppApi.ts");
});

test("rankExplorerFilePaths matches path fragments", () => {
  const hits = rankExplorerFilePaths(paths, "src/server/githubAppApi", 5);
  assert.ok(hits.includes("src/server/githubAppApi.ts"));
});

test("rankExplorerFilePaths matches stems", () => {
  const hits = rankExplorerFilePaths(paths, "githubAppApi", 5);
  assert.equal(hits[0], "src/server/githubAppApi.ts");
});

console.log(`\nexplorerFileTreeSearch: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exit(1);
}

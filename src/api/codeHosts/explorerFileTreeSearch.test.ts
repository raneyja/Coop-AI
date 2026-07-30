import assert from "node:assert/strict";
import {
  rankExplorerFilePaths,
  sortExplorerSearchHitsByQuery
} from "./explorerFileTreeSearch";

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

const planeWorkspacePaths = [
  "apps/api/plane/api/serializers/workspace.py",
  "apps/api/plane/app/permissions/workspace.py",
  "apps/api/plane/app/serializers/workspace.py",
  "apps/api/plane/app/urls/workspace.py",
  "apps/api/plane/db/models/workspace.py",
  "apps/api/plane/license/api/serializers/workspace.py"
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

test("rankExplorerFilePaths prefers exact full path over same basename", () => {
  const query = "apps/api/plane/app/permissions/workspace.py";
  const hits = rankExplorerFilePaths(planeWorkspacePaths, query, 10);
  assert.equal(hits[0], query);
});

test("rankExplorerFilePaths demotes basename collisions when query has path separators", () => {
  const query = "apps/api/plane/app/permissions/workspace.py";
  const hits = rankExplorerFilePaths(planeWorkspacePaths, query, 10);
  assert.equal(hits[0], query);
  const collision = "apps/api/plane/api/serializers/workspace.py";
  assert.ok(hits.indexOf(collision) > 0);
});

test("sortExplorerSearchHitsByQuery puts exact path first", () => {
  const hits = sortExplorerSearchHitsByQuery(
    planeWorkspacePaths.map((path) => ({
      path,
      name: "workspace.py"
    })),
    "apps/api/plane/app/permissions/workspace.py"
  );
  assert.equal(hits[0]?.path, "apps/api/plane/app/permissions/workspace.py");
});

console.log(`\nexplorerFileTreeSearch: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exit(1);
}

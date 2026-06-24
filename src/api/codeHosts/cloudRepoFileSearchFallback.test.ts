import assert from "node:assert/strict";
import { isRemoteFileSearchFallbackCandidate, searchFilesViaCloudTree } from "./cloudRepoFileSearchFallback";

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

test("isRemoteFileSearchFallbackCandidate matches axios 403 errors", () => {
  assert.equal(isRemoteFileSearchFallbackCandidate(new Error("Request failed with status code 403")), true);
});

test("searchFilesViaCloudTree finds files by filename", async () => {
  const hits = await searchFilesViaCloudTree(
    async (path) => {
      if (path === "src/server") {
        return {
          entries: [
            { path: "src/server/githubAppApi.ts", name: "githubAppApi.ts", type: "file" },
            { path: "src/server/githubAppService.ts", name: "githubAppService.ts", type: "file" }
          ]
        };
      }
      if (path === "src") {
        return {
          entries: [{ path: "src/server", name: "server", type: "dir" }]
        };
      }
      return { entries: [{ path: "src", name: "src", type: "dir" }] };
    },
    "githubAppApi.ts",
    5
  );
  assert.equal(hits[0]?.path, "src/server/githubAppApi.ts");
});

console.log(`\ncloudRepoFileSearchFallback: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { countFilesViaDirectoryWalk } from "./countFilesViaDirectoryWalk";
import type { RemoteTree } from "../api/codeHosts/types";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function main(): Promise<void> {
  await test("countFilesViaDirectoryWalk counts nested files", async () => {
    const trees: Record<string, RemoteTree> = {
      "": {
        path: "/",
        branch: "main",
        entries: [
          { path: "src", name: "src", type: "dir" },
          { path: "README.md", name: "README.md", type: "file" }
        ]
      },
      src: {
        path: "src",
        branch: "main",
        entries: [
          { path: "src/a.ts", name: "a.ts", type: "file" },
          { path: "src/lib", name: "lib", type: "dir" }
        ]
      },
      "src/lib": {
        path: "src/lib",
        branch: "main",
        entries: [{ path: "src/lib/b.ts", name: "b.ts", type: "file" }]
      }
    };

    const result = await countFilesViaDirectoryWalk(async (dir) => trees[dir]!);
    assert.equal(result.fileCount, 3);
    assert.equal(result.truncated, false);
  });

  await test("countFilesViaDirectoryWalk marks truncated when maxDirs hit", async () => {
    const trees: Record<string, RemoteTree> = {
      "": {
        path: "/",
        branch: "main",
        entries: [
          { path: "a", name: "a", type: "dir" },
          { path: "b", name: "b", type: "dir" },
          { path: "root.txt", name: "root.txt", type: "file" }
        ]
      },
      a: {
        path: "a",
        branch: "main",
        entries: [{ path: "a/x.ts", name: "x.ts", type: "file" }]
      },
      b: {
        path: "b",
        branch: "main",
        entries: [{ path: "b/y.ts", name: "y.ts", type: "file" }]
      }
    };

    const result = await countFilesViaDirectoryWalk(async (dir) => trees[dir]!, {
      maxDirs: 1,
      concurrency: 1
    });
    assert.equal(result.truncated, true);
    assert.ok(result.fileCount >= 1);
  });

  console.log(`\ncountFilesViaDirectoryWalk: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

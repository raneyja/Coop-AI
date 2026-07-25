import assert from "node:assert/strict";
import { collectRepoStats, countLines, MAX_LINE_COUNT_FILE_BYTES } from "./collectRepoStats";

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

test("countLines handles trailing newlines and empty files", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\n"), 1);
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\nb\n"), 2);
});

test("collectRepoStats totals files, lines, and bytes from the clone", () => {
  const contents: Record<string, string> = {
    "/tmp/repo/src/a.ts": "one\ntwo\nthree\n",
    "/tmp/repo/src/b.ts": "only\n",
    "/tmp/repo/README.md": "# title"
  };
  const stats = collectRepoStats(
    "/tmp/repo",
    [
      { path: "src/a.ts", size: 14 },
      { path: "src/b.ts", size: 5 },
      { path: "README.md", size: 7 }
    ],
    (absolutePath) => contents[absolutePath.replace(/\\/g, "/")] ?? ""
  );

  assert.equal(stats.fileCount, 3);
  assert.equal(stats.lineCount, 3 + 1 + 1);
  assert.equal(stats.byteCount, 26);
  assert.deepEqual(stats.languages, ["ts", "md"]);
  assert.equal(stats.skippedFiles, 0);
});

test("oversized files count toward size but not lines", () => {
  const stats = collectRepoStats(
    "/tmp/repo",
    [
      { path: "src/small.ts", size: 4 },
      { path: "dist/bundle.js", size: MAX_LINE_COUNT_FILE_BYTES + 1 }
    ],
    () => "a\nb\n"
  );

  assert.equal(stats.fileCount, 2);
  assert.equal(stats.lineCount, 2);
  assert.equal(stats.skippedFiles, 1);
});

test("unreadable files are skipped instead of failing the index job", () => {
  const stats = collectRepoStats(
    "/tmp/repo",
    [
      { path: "src/ok.ts", size: 4 },
      { path: "src/broken.ts", size: 4 }
    ],
    (absolutePath) => {
      if (absolutePath.includes("broken")) {
        throw new Error("EACCES");
      }
      return "a\nb\n";
    }
  );

  assert.equal(stats.lineCount, 2);
  assert.equal(stats.skippedFiles, 1);
});

console.log(`\ncollectRepoStats: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

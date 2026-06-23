import assert from "node:assert/strict";
import type { ChatFileMention } from "../../chat/types";
import { appendFileMention } from "./fileMentionUtils";

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

const base: ChatFileMention = { repoId: "github:acme/api", path: "src/index.ts", source: "indexed" };

test("appendFileMention adds a new mention", () => {
  const next = appendFileMention([], base);
  assert.equal(next.length, 1);
  assert.equal(next[0]?.path, "src/index.ts");
});

test("appendFileMention deduplicates repoId + path", () => {
  const next = appendFileMention([base], base);
  assert.equal(next.length, 1);
});

test("appendFileMention keeps the most recent mentions within limit", () => {
  const mentions: ChatFileMention[] = [
    { repoId: "github:a/one", path: "a.ts", source: "indexed" },
    { repoId: "github:a/one", path: "b.ts", source: "indexed" },
    { repoId: "github:a/one", path: "c.ts", source: "indexed" }
  ];
  const next = appendFileMention(mentions, { repoId: "github:a/one", path: "d.ts", source: "indexed" }, 3);
  assert.deepEqual(
    next.map((entry) => entry.path),
    ["b.ts", "c.ts", "d.ts"]
  );
});

console.log(`\nfileMentionUtils: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

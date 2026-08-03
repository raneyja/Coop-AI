import assert from "node:assert/strict";
import { isEditHistoryContent, looksLikePatchStreamingContent } from "./patchStreamDisplay";

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

test("looksLikePatchStreamingContent detects SEARCH markers", () => {
  assert.equal(looksLikePatchStreamingContent("<<<<<<< SEARCH\nfoo"), true);
});

test("looksLikePatchStreamingContent detects File header mid-stream", () => {
  assert.equal(
    looksLikePatchStreamingContent("File: `packages/lib/foo.ts`\n\n```"),
    true
  );
});

test("looksLikePatchStreamingContent ignores normal chat", () => {
  assert.equal(looksLikePatchStreamingContent("Here is how auth works in this file."), false);
});

test("isEditHistoryContent matches /edit bubbles", () => {
  assert.equal(isEditHistoryContent("/edit rewrite this\nfile: a.ts · selection: L1–2"), true);
  assert.equal(isEditHistoryContent("explain this function"), false);
});

console.log(`\npatchStreamDisplay: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

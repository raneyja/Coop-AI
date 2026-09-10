import assert from "node:assert/strict";
import { isFileHistoryQuery } from "./fileHistoryIntent";

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

test("who created / when", () => {
  assert.equal(isFileHistoryQuery("who created it / when?"), true);
  assert.equal(isFileHistoryQuery("Who created this file?"), true);
  assert.equal(isFileHistoryQuery("When was this file created?"), true);
  assert.equal(isFileHistoryQuery("first commit for this file"), true);
  assert.equal(isFileHistoryQuery("git history of this file"), true);
});

test("tl;dr plus who created", () => {
  assert.equal(
    isFileHistoryQuery(
      "Give me a tl;dr of this file? What does it do, what other files rely on it, and who created it / when?"
    ),
    true
  );
});

test("rejects ownership and callers", () => {
  assert.equal(isFileHistoryQuery("Who owns this file?"), false);
  assert.equal(isFileHistoryQuery("Who calls this?"), false);
  assert.equal(isFileHistoryQuery("What does this file do?"), false);
  assert.equal(isFileHistoryQuery(""), false);
});

console.log(`\nfileHistoryIntent: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { nextAutocompleteDraft, reconcileAutocompletePref } from "./autocompleteDraft";

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

test("nextAutocompleteDraft keeps in-progress edits", () => {
  assert.equal(nextAutocompleteDraft(true, true, false), "keep");
});

test("nextAutocompleteDraft keeps the saved value while prefs are stale", () => {
  assert.equal(nextAutocompleteDraft(true, false, false), false);
  assert.equal(nextAutocompleteDraft(false, false, true), true);
});

test("nextAutocompleteDraft follows prefs once they catch up", () => {
  assert.equal(nextAutocompleteDraft(false, false, false), false);
  assert.equal(nextAutocompleteDraft(true, false, null), true);
});

test("reconcileAutocompletePref ignores stale incoming values while a save is pending", () => {
  assert.deepEqual(reconcileAutocompletePref(true, false), { enabled: false, pending: false });
  assert.deepEqual(reconcileAutocompletePref(false, false), { enabled: false, pending: null });
  assert.deepEqual(reconcileAutocompletePref(true, null), { enabled: true, pending: null });
});

console.log(`\nautocompleteDraft: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

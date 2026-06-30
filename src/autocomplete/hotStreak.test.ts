import assert from "node:assert/strict";
import { HotStreak } from "./hotStreak";

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

test("activate increments streak and enables hot debounce", () => {
  const streak = new HotStreak();
  assert.equal(streak.isActive(), false);
  streak.activate();
  assert.equal(streak.getStreakCount(), 1);
  assert.equal(streak.isActive(), true);
  assert.ok(streak.debounceMs(300) <= 50);
});

test("keystrokes consume hot streak window", () => {
  const streak = new HotStreak();
  streak.activate();
  streak.noteKeystroke();
  streak.noteKeystroke();
  streak.noteKeystroke();
  assert.equal(streak.isActive(), false);
});

test("debounce returns base when inactive", () => {
  const streak = new HotStreak();
  assert.equal(streak.debounceMs(300), 300);
});

console.log(`\nhotStreak: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

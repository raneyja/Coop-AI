import assert from "node:assert/strict";
import { SmartThrottle } from "./smartThrottle";

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

test("slow typing keeps base debounce", () => {
  const throttle = new SmartThrottle();
  assert.equal(throttle.nextDelay(300, 0), 300);
});

test("fast typing reduces debounce", () => {
  const throttle = new SmartThrottle();
  const now = Date.now();
  for (let i = 0; i < 10; i += 1) {
    throttle.noteKeystroke();
    // Simulate rapid keystrokes by backdating timestamps
    const timestamps = (throttle as unknown as { keystrokeTimestamps: number[] }).keystrokeTimestamps;
    timestamps[timestamps.length - 1] = now + i * 30;
  }
  const delay = throttle.nextDelay(300, 0);
  assert.ok(delay < 300);
  assert.ok(delay >= 50);
});

test("high p95 latency increases debounce", () => {
  const throttle = new SmartThrottle();
  const delay = throttle.nextDelay(300, 600);
  assert.ok(delay > 300);
});

console.log(`\nsmartThrottle: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

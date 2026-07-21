import assert from "node:assert/strict";
import { createProseFrameCoalescer } from "./proseFrameCoalescer";

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

test("first non-empty content paints immediately", () => {
  const paints: string[] = [];
  const scheduled: Array<() => void> = [];
  const coalescer = createProseFrameCoalescer(
    (value) => paints.push(value),
    (cb) => {
      scheduled.push(cb);
      return scheduled.length;
    },
    () => undefined
  );

  coalescer.push("Hel");
  assert.deepEqual(paints, ["Hel"]);
  assert.equal(scheduled.length, 0);
});

test("follow-up updates coalesce to one frame paint of the latest value", () => {
  const paints: string[] = [];
  const scheduled: Array<() => void> = [];
  const coalescer = createProseFrameCoalescer(
    (value) => paints.push(value),
    (cb) => {
      scheduled.push(cb);
      return scheduled.length;
    },
    () => undefined
  );

  coalescer.push("Hel");
  coalescer.push("Hello");
  coalescer.push("Hello ");
  coalescer.push("Hello world");
  assert.deepEqual(paints, ["Hel"]);
  assert.equal(scheduled.length, 1);

  scheduled[0]!();
  assert.deepEqual(paints, ["Hel", "Hello world"]);
});

test("empty content clears immediately and cancels a pending frame", () => {
  const paints: string[] = [];
  let cancelled = 0;
  const scheduled: Array<() => void> = [];
  const coalescer = createProseFrameCoalescer(
    (value) => paints.push(value),
    (cb) => {
      scheduled.push(cb);
      return 1;
    },
    () => {
      cancelled += 1;
    }
  );

  coalescer.push("Hel");
  coalescer.push("Hello");
  assert.equal(scheduled.length, 1);

  coalescer.push("");
  assert.equal(cancelled, 1);
  assert.deepEqual(paints, ["Hel", ""]);
});

test("dispose cancels a pending frame", () => {
  let cancelled = 0;
  const coalescer = createProseFrameCoalescer(
    () => undefined,
    (cb) => {
      queueMicrotask(cb);
      return 99;
    },
    (id) => {
      assert.equal(id, 99);
      cancelled += 1;
    }
  );

  coalescer.push("a");
  coalescer.push("ab");
  coalescer.dispose();
  assert.equal(cancelled, 1);
});

const total = passed + failed;
console.log(`\nproseFrameCoalescer: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { createStreamDeltaBatcher } from "./streamDeltaBatcher";

let passed = 0;

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("first chunk publishes immediately so TTFB stays low", () => {
  const published: string[] = [];
  const batcher = createStreamDeltaBatcher({
    publish: (chunk) => published.push(chunk),
    intervalMs: 50
  });
  batcher.push("Hello");
  assert.deepEqual(published, ["Hello"]);
  batcher.dispose();
});

void (async () => {
  const published: string[] = [];
  const batcher = createStreamDeltaBatcher({
    publish: (chunk) => published.push(chunk),
    intervalMs: 20
  });
  batcher.push("A");
  batcher.push("B");
  batcher.push("C");
  assert.deepEqual(published, ["A"]);
  await wait(35);
  assert.deepEqual(published, ["A", "BC"]);
  batcher.dispose();
  passed += 1;
  console.log("ok - follow-up chunks coalesce until flush");

  const flushed: string[] = [];
  const flushBatcher = createStreamDeltaBatcher({
    publish: (chunk) => flushed.push(chunk),
    intervalMs: 5_000
  });
  flushBatcher.push("one");
  flushBatcher.push("two");
  assert.deepEqual(flushed, ["one"]);
  flushBatcher.flush();
  assert.deepEqual(flushed, ["one", "two"]);
  flushBatcher.dispose();
  passed += 1;
  console.log("ok - flush publishes leftover buffer without waiting");

  const ended: string[] = [];
  const endBatcher = createStreamDeltaBatcher({
    publish: (chunk) => ended.push(chunk),
    intervalMs: 5_000
  });
  endBatcher.push("Hello");
  endBatcher.push(".");
  assert.deepEqual(ended, ["Hello"]);
  endBatcher.end();
  assert.deepEqual(ended, ["Hello", "."]);
  endBatcher.flush();
  endBatcher.push("late");
  assert.deepEqual(ended, ["Hello", "."]);
  passed += 1;
  console.log("ok - end flushes leftover then ignores later push/flush");

  console.log(`\nstreamDeltaBatcher: ${passed} passed`);
})();

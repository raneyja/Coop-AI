import assert from "node:assert/strict";
import {
  createChatOutputGate,
  MIN_CHAT_RESPONSE_VISIBLE_MS,
  remainingMinResponseDelayMs
} from "./chatResponseTiming";

let passed = 0;

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("production default has no artificial delay", () => {
  assert.equal(MIN_CHAT_RESPONSE_VISIBLE_MS, 0);
  assert.equal(remainingMinResponseDelayMs(1000, 1000), 0);
  assert.equal(remainingMinResponseDelayMs(1000, 1500), 0);
});

test("remainingMinResponseDelayMs still supports an explicit minimum window", () => {
  assert.equal(remainingMinResponseDelayMs(1000, 1500, 0), 0);
  assert.equal(remainingMinResponseDelayMs(1000, 1500, 1000), 500);
});

void (async () => {
  const immediate: string[] = [];
  const immediateGate = createChatOutputGate({
    startedAt: Date.now(),
    isCancelled: () => false,
    onChunk: (chunk) => immediate.push(chunk)
  });

  immediateGate.push("x");
  assert.deepEqual(immediate, ["x"]);
  await immediateGate.waitUntilOpen();
  immediateGate.push("y");
  assert.deepEqual(immediate, ["x", "y"]);
  passed += 1;
  console.log("ok - createChatOutputGate streams immediately with the default (no artificial delay)");

  const delayed: string[] = [];
  const delayedGate = createChatOutputGate({
    startedAt: Date.now(),
    minVisibleMs: 50,
    isCancelled: () => false,
    onChunk: (chunk) => delayed.push(chunk)
  });

  delayedGate.push("a");
  delayedGate.push("b");
  assert.deepEqual(delayed, []);
  await delayedGate.waitUntilOpen();
  assert.deepEqual(delayed, ["a", "b"]);
  delayedGate.push("c");
  assert.deepEqual(delayed, ["a", "b", "c"]);
  passed += 1;
  console.log("ok - createChatOutputGate still honors an explicit minVisibleMs when a caller opts in");

  console.log(`\n${passed} passed`);
})();

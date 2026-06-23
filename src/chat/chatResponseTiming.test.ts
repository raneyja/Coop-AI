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

test("remainingMinResponseDelayMs respects minimum window", () => {
  assert.equal(remainingMinResponseDelayMs(1000, 1500), MIN_CHAT_RESPONSE_VISIBLE_MS - 500);
  assert.equal(remainingMinResponseDelayMs(1000, 5000), 0);
});

void (async () => {
  const startedAt = Date.now() - MIN_CHAT_RESPONSE_VISIBLE_MS;
  const emitted: string[] = [];
  const gate = createChatOutputGate({
    startedAt,
    isCancelled: () => false,
    onChunk: (chunk) => emitted.push(chunk)
  });

  gate.push("a");
  gate.push("b");
  await gate.waitUntilOpen();
  assert.deepEqual(emitted, ["a", "b"]);

  gate.push("c");
  assert.deepEqual(emitted, ["a", "b", "c"]);
  passed += 1;
  console.log("ok - createChatOutputGate releases queued chunks after delay");

  console.log(`\n${passed} passed`);
})();

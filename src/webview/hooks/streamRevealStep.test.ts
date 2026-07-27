import assert from "node:assert/strict";
import { streamRevealStep } from "./useDebouncedProse";

let passed = 0;

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("no backlog yields no step", () => {
  assert.equal(streamRevealStep(0, 0.016), 0);
});

test("small backlog reveals a few characters per frame", () => {
  const step = streamRevealStep(20, 0.016);
  assert.ok(step >= 1 && step <= 22, `expected 1..22, got ${step}`);
});

test("large backlog catches up faster but still caps per frame", () => {
  const small = streamRevealStep(20, 0.016);
  const large = streamRevealStep(500, 0.016);
  assert.ok(large >= small, "larger backlog should not be slower");
  assert.ok(large <= 22, `expected cap 22, got ${large}`);
});

console.log(`\nstreamRevealStep: ${passed} passed`);

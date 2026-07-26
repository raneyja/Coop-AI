import assert from "node:assert/strict";
import {
  countEmbeddedOptionMarkers,
  detectEditOptionRequest,
  formatMultiOptionEditReminder
} from "./editOptionsIntent";

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

test("detectEditOptionRequest finds '3 different options'", () => {
  const result = detectEditOptionRequest(
    "/edit can you provide me with 3 different options to update the code here."
  );
  assert.deepEqual(result, { count: 3 });
});

test("detectEditOptionRequest ignores single-edit asks", () => {
  assert.equal(detectEditOptionRequest("/edit add a null check"), undefined);
});

test("countEmbeddedOptionMarkers finds comment options in one REPLACE", () => {
  const body = [
    "<<<<<<< SEARCH",
    "export class Foo {",
    "=======",
    "export class Foo {",
    "// Option 1: Keep minimal sidebar behavior",
    "// tl;dr — Small helpers",
    "// Option 2: Expose a factory",
    "// Option 3: Add telemetry",
    ">>>>>>> REPLACE"
  ].join("\n");
  assert.equal(countEmbeddedOptionMarkers(body), 3);
});

test("countEmbeddedOptionMarkers ignores Option headers outside patches", () => {
  const body = [
    "Option 1: discussion only",
    "Option 2: more discussion",
    "File: `src/foo.ts`",
    "```patch",
    "<<<<<<< SEARCH",
    "a",
    "=======",
    "b",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  assert.equal(countEmbeddedOptionMarkers(body), 0);
});

test("formatMultiOptionEditReminder names the count", () => {
  const text = formatMultiOptionEditReminder(3);
  assert.match(text, /exactly 3 option blocks/);
  assert.match(text, /Never put Option 1/);
  assert.match(text, /edit_options_reminder/);
});

console.log(`\neditOptionsIntent: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { isFileCallerQuery } from "./fileCallerIntent";

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

test("smoke ask: what does this file do, and who calls it", () => {
  assert.equal(isFileCallerQuery("What does this file do, and who calls it?"), true);
});

test("caller / import phrasings", () => {
  assert.equal(isFileCallerQuery("Who calls remainingContextGatherBudgetMs?"), true);
  assert.equal(isFileCallerQuery("Who imports this module?"), true);
  assert.equal(isFileCallerQuery("What imports this?"), true);
  assert.equal(isFileCallerQuery("Callers of responseDeadline"), true);
  assert.equal(isFileCallerQuery("What depends on this file?"), true);
  assert.equal(isFileCallerQuery("Which files import this?"), true);
  assert.equal(isFileCallerQuery("references to this file"), true);
});

test("rejects ownership and unrelated asks", () => {
  assert.equal(isFileCallerQuery("Who owns this file?"), false);
  assert.equal(isFileCallerQuery("Find the owner of auth"), false);
  assert.equal(isFileCallerQuery("What does this file do?"), false);
  assert.equal(isFileCallerQuery("Explain responseDeadline.ts"), false);
  assert.equal(isFileCallerQuery(""), false);
});

console.log(`\nfileCallerIntent: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

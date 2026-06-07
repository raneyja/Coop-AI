import assert from "node:assert/strict";
import { wantsCodeHostContext } from "./codeHostContext";

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

test("wantsCodeHostContext matches pull request questions", () => {
  assert.equal(wantsCodeHostContext("any open pull requests for this repo?"), true);
  assert.equal(wantsCodeHostContext("What is the auth flow?"), false);
});

test("wantsCodeHostContext matches github issue questions", () => {
  assert.equal(wantsCodeHostContext("list github issues for this repository"), true);
});

test("wantsCodeHostContext matches PR numbers", () => {
  assert.equal(wantsCodeHostContext("what happened in PR #42?"), true);
});

const total = passed + failed;
console.log(`\ncodeHostContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

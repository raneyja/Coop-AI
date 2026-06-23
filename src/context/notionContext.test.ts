import assert from "node:assert/strict";
import { shouldFetchNotionContext, wantsNotionContext } from "./notionContext";
import type { ContextFetchRequest } from "./requestBatcher";

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

test("wantsNotionContext matches explicit notion questions", () => {
  assert.equal(wantsNotionContext("any notion docs for this repo?"), true);
  assert.equal(wantsNotionContext("What is the auth flow?"), false);
});

test("shouldFetchNotionContext includes knowledge-gaps quick action", () => {
  const request = {
    type: "knowledge_gaps",
    params: { quickAction: "knowledge-gaps" }
  } as ContextFetchRequest;
  assert.equal(shouldFetchNotionContext(request), true);
});

const total = passed + failed;
console.log(`\nnotionContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { shouldFetchTeamsContext, wantsTeamsContext } from "./teamsContext";
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

test("wantsTeamsContext matches explicit teams questions", () => {
  assert.equal(wantsTeamsContext("any teams threads for this repo?"), true);
  assert.equal(wantsTeamsContext("What is the auth flow?"), false);
});

test("shouldFetchTeamsContext includes knowledge-gaps quick action", () => {
  const request = {
    type: "knowledge_gaps",
    params: { quickAction: "knowledge-gaps" }
  } as ContextFetchRequest;
  assert.equal(shouldFetchTeamsContext(request), true);
});

const total = passed + failed;
console.log(`\nteamsContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

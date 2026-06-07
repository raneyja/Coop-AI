import assert from "node:assert/strict";
import { buildRepoSearchQuery, wantsSlackContext } from "./slackContext";

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

test("wantsSlackContext matches explicit slack questions", () => {
  assert.equal(wantsSlackContext("any slack threads about this repo?"), true);
  assert.equal(wantsSlackContext("What is the auth flow?"), false);
});

test("wantsSlackContext matches discussion + repo phrasing", () => {
  assert.equal(wantsSlackContext("any discussions related to this repository?"), true);
});

test("buildRepoSearchQuery includes owner/repo and github prefix", () => {
  const query = buildRepoSearchQuery("acme", "coop-ai-core");
  assert.ok(query?.includes("acme/coop-ai-core"));
  assert.ok(query?.includes("github:acme/coop-ai-core"));
  assert.ok(query?.includes("coop-ai-core"));
});

const total = passed + failed;
console.log(`\nslackContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

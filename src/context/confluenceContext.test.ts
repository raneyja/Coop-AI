import assert from "node:assert/strict";
import { buildConfluenceCql } from "./docSearchQuery";
import { shouldFetchConfluenceContext, wantsConfluenceContext } from "./confluenceContext";
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

test("wantsConfluenceContext matches explicit confluence questions", () => {
  assert.equal(wantsConfluenceContext("any confluence pages for this repo?"), true);
  assert.equal(wantsConfluenceContext("What is the auth flow?"), false);
});

test("buildConfluenceCql searches repo terms", () => {
  const cql = buildConfluenceCql("acme", "coop-ai-core");
  assert.ok(cql?.includes('text ~ "acme/coop-ai-core"'));
  assert.ok(cql?.includes("type=page"));
});

test("shouldFetchConfluenceContext includes knowledge-gaps quick action", () => {
  const request = {
    type: "knowledge_gaps",
    params: { quickAction: "knowledge-gaps" }
  } as ContextFetchRequest;
  assert.equal(shouldFetchConfluenceContext(request), true);
});

const total = passed + failed;
console.log(`\nconfluenceContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

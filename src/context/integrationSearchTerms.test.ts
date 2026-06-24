import assert from "node:assert/strict";
import {
  buildDiscussionSearchQueries,
  buildIntegrationSearchTermList
} from "./integrationSearchTerms";

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

test("buildIntegrationSearchTermList uses only repo file and jira-derived terms", () => {
  const terms = buildIntegrationSearchTermList({
    owner: "raneyja",
    repo: "Coop-AI",
    activeFile: "src/server/githubAppApi.ts",
    contextText: ["// COOP-101 validation"],
    crossToolText: ["ADR rollout (COOP-55)"]
  });
  assert.ok(terms.includes("github:raneyja/coop-ai"));
  assert.ok(terms.includes("githubAppApi"));
  assert.ok(terms.includes("COOP-101"));
  assert.ok(!terms.some((term) => term.startsWith("in:")));
  assert.ok(!terms.includes("epd"));
});

test("buildDiscussionSearchQueries never uses channel-scoped queries", () => {
  const queries = buildDiscussionSearchQueries({
    owner: "acme",
    repo: "my-app",
    jiraIssueKeys: ["PROJ-1"],
    threadModifier: "is:thread"
  });
  assert.ok(queries.some((query) => query === "PROJ-1"));
  assert.ok(queries.some((query) => query === "PROJ-1 is:thread"));
  assert.ok(!queries.some((query) => query.startsWith("in:")));
});

const total = passed + failed;
console.log(`\nintegrationSearchTerms: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

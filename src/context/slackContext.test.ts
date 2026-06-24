import assert from "node:assert/strict";
import { buildRepoSearchQuery, buildSlackSearchQueries, buildSlackSearchQuery, wantsSlackContext } from "./slackContext";

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

test("buildSlackSearchQuery includes repo slug variants and jira keys", () => {
  const query = buildSlackSearchQuery({
    owner: "raneyja",
    repo: "Coop-AI",
    contextText: ["// Coop validation: COOP-101 trace test"]
  });
  assert.ok(query?.includes("raneyja/coop-ai"));
  assert.ok(query?.includes("COOP-101"));
});

test("buildSlackSearchQuery includes active file path terms", () => {
  const query = buildSlackSearchQuery({
    owner: "acme",
    repo: "coop-ai-core",
    activeFile: "src/server/githubAppApi.ts"
  });
  assert.ok(query?.includes("src/server/githubAppApi.ts"));
  assert.ok(query?.includes("githubAppApi.ts"));
  assert.ok(query?.includes("githubAppApi"));
});

test("buildSlackSearchQueries prioritizes jira keys and searches repo terms individually", () => {
  const queries = buildSlackSearchQueries({
    owner: "raneyja",
    repo: "Coop-AI",
    activeFile: "src/server/githubAppApi.ts",
    contextText: ["// COOP-101 validation"],
    crossToolText: ["ADR rollout (COOP-55)"],
    jiraIssueKeys: ["COOP-101", "COOP-55"]
  });
  assert.ok(queries[0]?.startsWith("COOP-"));
  assert.ok(!queries.some((query) => query.startsWith("in:")));
  assert.ok(queries.some((query) => query.includes("raneyja/coop-ai")));
  assert.ok(queries.some((query) => query.includes("githubAppApi")));
});

const total = passed + failed;
console.log(`\nslackContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

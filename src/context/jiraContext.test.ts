import assert from "node:assert/strict";
import {
  buildRepoJql,
  collectJiraKeysFromText,
  shouldFetchJiraContext,
  wantsJiraContext,
  wantsRepoLinkedJiraDiscovery
} from "./jiraContext";
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

test("wantsJiraContext matches explicit jira questions", () => {
  assert.equal(wantsJiraContext("can you look for any jira tickets that refer to this repo?"), true);
  assert.equal(wantsJiraContext("What is the auth flow?"), false);
});

test("wantsJiraContext matches ticket + repo phrasing", () => {
  assert.equal(wantsJiraContext("any tickets related to this repository?"), true);
});

test("wantsJiraContext matches issue keys in the query", () => {
  assert.equal(wantsJiraContext("summarize COOP-118"), true);
});

test("buildRepoJql searches owner/repo and github prefix", () => {
  const jql = buildRepoJql("acme", "coop-ai-core");
  assert.ok(jql?.includes('text ~ "acme/coop-ai-core"'));
  assert.ok(jql?.includes('text ~ "github:acme/coop-ai-core"'));
  assert.ok(jql?.includes('summary ~ "coop-ai-core"'));
  assert.ok(jql?.includes("ORDER BY updated DESC"));
});

test("buildRepoJql returns undefined without repo", () => {
  assert.equal(buildRepoJql("acme", undefined), undefined);
});

test("wantsRepoLinkedJiraDiscovery matches repo-wide ticket questions", () => {
  assert.equal(wantsRepoLinkedJiraDiscovery("show me any related tickets to this repo"), true);
  assert.equal(wantsRepoLinkedJiraDiscovery("summarize COOP-118"), false);
});

test("collectJiraKeysFromText deduplicates keys from commit messages", () => {
  const keys = collectJiraKeysFromText(
    "fix(auth): COOP-101 token broker",
    "Follow-up for coop-101 and COOP-118"
  );
  assert.deepEqual(keys.sort(), ["COOP-101", "COOP-118"]);
});

test("shouldFetchJiraContext includes knowledge-gaps quick action", () => {
  const request = {
    type: "knowledge_gaps",
    params: { quickAction: "knowledge-gaps" }
  } as ContextFetchRequest;
  assert.equal(shouldFetchJiraContext(request), true);
});

const total = passed + failed;
console.log(`\njiraContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

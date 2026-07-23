import assert from "node:assert/strict";
import type { ContextFetchRequest } from "./requestBatcher";
import { shouldFetchConfluenceContext } from "./confluenceContext";
import { shouldFetchGoogleDocsContext } from "./googleDocsContext";
import { shouldFetchJiraContext } from "./jiraContext";
import { shouldFetchNotionContext } from "./notionContext";
import { shouldFetchSlackContext } from "./slackContext";
import { shouldFetchTeamsContext } from "./teamsContext";
import {
  REPO_WIDE_INTEGRATION_QUICK_ACTIONS,
  shouldFetchDiscussionIntegrations,
  shouldFetchRepoWideIntegrations,
  shouldFetchTraceDecisionIntegrations
} from "./integrationFetchPolicy";

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

function request(
  quickAction: string | undefined,
  type: ContextFetchRequest["type"] = "knowledge_gaps"
): ContextFetchRequest {
  return {
    type,
    params: { quickAction }
  } as ContextFetchRequest;
}

const DOC_INTEGRATIONS = [
  ["confluence", shouldFetchConfluenceContext],
  ["jira", shouldFetchJiraContext],
  ["notion", shouldFetchNotionContext],
  ["google-docs", shouldFetchGoogleDocsContext]
] as const;

const DISCUSSION_INTEGRATIONS = [
  ["slack", shouldFetchSlackContext],
  ["teams", shouldFetchTeamsContext]
] as const;

test("repo-wide quick actions are enumerated consistently", () => {
  assert.deepEqual([...REPO_WIDE_INTEGRATION_QUICK_ACTIONS], [
    "knowledge-gaps",
    "understand-repo"
  ]);
});

test("understand-repo fetches from all connected tools", () => {
  assert.equal(shouldFetchRepoWideIntegrations(request("understand-repo")), true);
  assert.equal(shouldFetchJiraContext(request("understand-repo")), true);
  assert.equal(shouldFetchSlackContext(request("understand-repo")), true);
});

test("blast-radius skips repo-wide doc/discussion auto-fetch (code-impact hot path)", () => {
  const blast = request("blast-radius", "dependencies");
  assert.equal(shouldFetchRepoWideIntegrations(blast), false);
  assert.equal(shouldFetchJiraContext(blast), false);
  assert.equal(shouldFetchNotionContext(blast), false);
  assert.equal(shouldFetchSlackContext(blast), false);
  assert.equal(shouldFetchDiscussionIntegrations(blast), false);
});

for (const action of REPO_WIDE_INTEGRATION_QUICK_ACTIONS) {
  test(`shouldFetchRepoWideIntegrations is true for ${action}`, () => {
    assert.equal(shouldFetchRepoWideIntegrations(request(action)), true);
  });
}

for (const [name, shouldFetch] of DOC_INTEGRATIONS) {
  for (const action of REPO_WIDE_INTEGRATION_QUICK_ACTIONS) {
    test(`${name} fetches on ${action}`, () => {
      assert.equal(shouldFetch(request(action)), true);
    });
  }
}

for (const [name, shouldFetch] of DISCUSSION_INTEGRATIONS) {
  for (const action of REPO_WIDE_INTEGRATION_QUICK_ACTIONS) {
    test(`${name} fetches on ${action}`, () => {
      assert.equal(shouldFetch(request(action)), true);
    });
  }
  test(`${name} fetches on find-owner`, () => {
    assert.equal(shouldFetch(request("find-owner", "ownership")), true);
  });
}

test("doc integrations do not auto-fetch on find-owner", () => {
  const ownerRequest = request("find-owner", "ownership");
  for (const [, shouldFetch] of DOC_INTEGRATIONS) {
    assert.equal(shouldFetch(ownerRequest), false);
  }
});

test("integrations auto-fetch on trace-decision", () => {
  const traceRequest = request("trace-decision", "decision_history");
  for (const [, shouldFetch] of [...DOC_INTEGRATIONS, ...DISCUSSION_INTEGRATIONS]) {
    assert.equal(shouldFetch(traceRequest), true);
  }
});

test("outside-workspace file skips Notion and other integration auto-fetch", () => {
  const externalRequest = {
    type: "knowledge_gaps",
    params: {
      quickAction: "knowledge-gaps",
      fileSource: "external",
      file: "/Users/jonraney/Downloads/cursor_session.md"
    }
  } as ContextFetchRequest;
  assert.equal(shouldFetchRepoWideIntegrations(externalRequest), false);
  assert.equal(shouldFetchDiscussionIntegrations(externalRequest), false);
  assert.equal(shouldFetchNotionContext(externalRequest), false);
  assert.equal(shouldFetchTraceDecisionIntegrations(externalRequest), false);
});

test("absolute disk path skips integration auto-fetch even without fileSource", () => {
  const absoluteRequest = {
    type: "knowledge_gaps",
    params: {
      quickAction: "knowledge-gaps",
      file: "/Users/jonraney/Downloads/cursor_session.md"
    }
  } as ContextFetchRequest;
  assert.equal(shouldFetchRepoWideIntegrations(absoluteRequest), false);
  assert.equal(shouldFetchNotionContext(absoluteRequest), false);
});

test("integration provider slash commands always fetch", () => {
  const notionRequest = {
    type: "chat_context",
    params: { integrationProvider: "notion" }
  } as ContextFetchRequest;
  assert.equal(shouldFetchNotionContext(notionRequest), true);
  assert.equal(shouldFetchDiscussionIntegrations(notionRequest), false);
});

test("plain chat still requires keyword intent", () => {
  const chatRequest = {
    type: "chat_context",
    params: {},
    intent: { context: { queryText: "What is the auth flow?" } }
  } as ContextFetchRequest;
  for (const [, shouldFetch] of [...DOC_INTEGRATIONS, ...DISCUSSION_INTEGRATIONS]) {
    assert.equal(shouldFetch(chatRequest), false);
  }
});

const total = passed + failed;
console.log(`\nintegrationFetchPolicy: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

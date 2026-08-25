import assert from "node:assert/strict";
import {
  buildFocusAwareJiraJql,
  buildIssueKeysJql,
  buildJiraFocusTerms,
  buildRepoJql,
  collectJiraKeysFromText,
  rankJiraIssuesForFocus,
  shouldFetchJiraContext,
  shouldMergeRepoWideJiraHits,
  shouldRunJiraFocusTextSearch,
  wantsJiraContext,
  wantsOpenTickets,
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

test("buildRepoJql includes repo slug case variants", () => {
  const jql = buildRepoJql("raneyja", "Coop-AI");
  assert.ok(jql?.includes('text ~ "raneyja/Coop-AI"'));
  assert.ok(jql?.includes('text ~ "raneyja/coop-ai"'));
  assert.ok(jql?.includes('summary ~ "coop-ai"'));
});

test("buildIssueKeysJql searches by issue key", () => {
  const jql = buildIssueKeysJql(["COOP-101", "coop-55"]);
  assert.equal(jql, 'key in ("COOP-101", "COOP-55") ORDER BY updated DESC');
});

test("buildRepoJql returns undefined without repo", () => {
  assert.equal(buildRepoJql("acme", undefined), undefined);
});

test("buildJiraFocusTerms includes path stem and basename", () => {
  const terms = buildJiraFocusTerms({
    activeFile: "src/workspace/IndexedRepoWorkspace.ts"
  });
  assert.ok(terms.includes("IndexedRepoWorkspace"));
  assert.ok(terms.includes("IndexedRepoWorkspace.ts"));
  assert.ok(terms.includes("src/workspace/IndexedRepoWorkspace.ts"));
  assert.ok(terms.includes("indexed") || terms.includes("workspace") || terms.includes("Indexed"));
});

test("buildJiraFocusTerms splits camelCase basename tokens", () => {
  const terms = buildJiraFocusTerms({
    activeFile: "src/config/responseDeadline.ts"
  });
  assert.ok(terms.includes("responseDeadline"));
  assert.ok(terms.includes("response"));
  assert.ok(terms.includes("deadline"));
});

test("buildFocusAwareJiraJql ANDs repo with file focus", () => {
  const jql = buildFocusAwareJiraJql({
    owner: "raneyja",
    repo: "Coop-AI",
    activeFile: "src/workspace/IndexedRepoWorkspace.ts"
  });
  assert.ok(jql);
  assert.ok(jql!.includes("AND"));
  assert.ok(jql!.includes('summary ~ "IndexedRepoWorkspace"'));
  assert.ok(jql!.includes('text ~ "raneyja/Coop-AI"') || jql!.includes('text ~ "Coop-AI"'));
  assert.ok(jql!.includes("ORDER BY updated DESC"));
});

test("buildFocusAwareJiraJql undefined without focus", () => {
  assert.equal(
    buildFocusAwareJiraJql({ owner: "raneyja", repo: "Coop-AI" }),
    undefined
  );
});

test("rankJiraIssuesForFocus puts path-matching tickets first", () => {
  const ranked = rankJiraIssuesForFocus(
    [
      {
        key: "COOP-55",
        summary: "Architecture decision: webview vs native sidebar for chat",
        status: "Backlog"
      },
      {
        key: "COOP-235",
        summary: "Blast radius dependents missing for IndexedRepoWorkspace",
        status: "Selected for Development"
      },
      {
        key: "COOP-101",
        summary: "Extract auth and repo indexing into coop-backend",
        status: "In Progress"
      }
    ],
    {
      activeFile: "src/workspace/IndexedRepoWorkspace.ts",
      queryText: "check jira for open tickets"
    }
  );
  assert.equal(ranked[0]?.key, "COOP-235");
});

test("wantsOpenTickets matches open tickets phrasing", () => {
  assert.equal(wantsOpenTickets("check jira for open tickets as well"), true);
  assert.equal(wantsOpenTickets("what is the auth flow"), false);
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

test("collectJiraKeysFromText reads keys from confluence-style excerpts", () => {
  const keys = collectJiraKeysFromText(
    "ADR: GitHub App API (COOP-101)",
    "See also COOP-55 for rollout plan"
  );
  assert.deepEqual(keys.sort(), ["COOP-101", "COOP-55"]);
});

test("buildIssueKeysJql deduplicates mixed-case keys", () => {
  const jql = buildIssueKeysJql(["COOP-101", "coop-101", "COOP-55"]);
  assert.equal(jql, 'key in ("COOP-101", "COOP-55") ORDER BY updated DESC');
});

test("shouldFetchJiraContext includes knowledge-gaps quick action", () => {
  const request = {
    type: "knowledge_gaps",
    params: { quickAction: "knowledge-gaps" }
  } as ContextFetchRequest;
  assert.equal(shouldFetchJiraContext(request), true);
});

test("shouldFetchJiraContext includes incident-shaped chat without jira keyword", () => {
  const request = {
    type: "chat_context",
    params: {},
    intent: {
      context: { queryText: "webhook failures and retries on board sync last week" }
    }
  } as ContextFetchRequest;
  assert.equal(shouldFetchJiraContext(request), true);
  assert.equal(wantsJiraContext("webhook failures and retries on board sync last week"), false);
});

test("shouldFetchJiraContext respects jira-only allowlist on blast-radius", () => {
  const request = {
    type: "chat_context",
    params: { quickAction: "blast-radius", fetchIntegrations: ["jira"] },
    intent: { context: { queryText: "impact + jira" } }
  } as ContextFetchRequest;
  assert.equal(shouldFetchJiraContext(request), true);
});

test("focused Jira asks do not fail-open to a repo-wide dump", () => {
  assert.equal(shouldMergeRepoWideJiraHits({ hasFocusJql: true }), false);
  assert.equal(shouldMergeRepoWideJiraHits({ hasFocusJql: false }), true);
});

test("named issue keys skip the 20-ticket focus text search", () => {
  assert.equal(shouldRunJiraFocusTextSearch(["COOP-101"]), false);
  assert.equal(shouldRunJiraFocusTextSearch([]), true);
});

const total = passed + failed;
console.log(`\njiraContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

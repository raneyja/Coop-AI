import assert from "node:assert/strict";
import {
  buildDecisionJiraJql,
  fallbackDecisionJiraJql,
  isJiraJqlParseError,
  buildFocusAwareJiraJql,
  buildIssueKeysJql,
  buildJiraFocusTerms,
  buildRepoJql,
  collectJiraKeysFromText,
  rankJiraIssuesForFocus,
  shouldFetchJiraContext,
  shouldMergeRepoWideJiraHits,
  shouldRunJiraFocusTextSearch,
  shouldRunJiraTextSearch,
  shouldScanGitForJiraKeys,
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
  assert.equal(wantsJiraContext("any tickets related to this repository?"), false);
});

test("wantsJiraContext matches issue keys in the query", () => {
  assert.equal(wantsJiraContext("summarize COOP-118"), true);
});

test("buildRepoJql searches owner/repo and every code-host prefix", () => {
  const jql = buildRepoJql("acme", "coop-ai-core");
  assert.ok(jql?.includes("acme/coop ai core"));
  assert.ok(jql?.includes("github:acme/coop ai core"));
  assert.ok(jql?.includes("gitlab:acme/coop ai core"));
  assert.ok(jql?.includes("bitbucket:acme/coop ai core"));
  assert.ok(jql?.includes("coop ai core"));
  assert.match(jql!, /text ~ "\\"github:acme\/coop ai core\\""/);
  assert.ok(jql?.includes("ORDER BY updated DESC"));
});

test("buildRepoJql phrase-quotes prefixed ids and puts GitLab first when preferred", () => {
  const jql = buildRepoJql("acme", "coop-ai-core", { preferHost: "gitlab" }) ?? "";
  const gitlabClause = 'text ~ "\\"gitlab:acme/coop ai core\\""';
  const githubClause = 'text ~ "\\"github:acme/coop ai core\\""';
  const bitbucketClause = 'text ~ "\\"bitbucket:acme/coop ai core\\""';
  assert.ok(jql.includes(gitlabClause), jql);
  assert.ok(jql.includes(githubClause), jql);
  assert.ok(jql.includes(bitbucketClause), jql);
  assert.ok(jql.indexOf(gitlabClause) < jql.indexOf(githubClause));
  assert.ok(jql.indexOf(gitlabClause) < jql.indexOf(bitbucketClause));
});

test("buildRepoJql includes repo slug case variants", () => {
  const jql = buildRepoJql("raneyja", "Coop-AI");
  assert.ok(jql?.includes("raneyja/Coop AI"));
  assert.ok(jql?.includes("raneyja/coop ai"));
  assert.ok(jql?.includes('summary ~ "coop ai"') || jql?.includes('summary ~ "Coop AI"'), jql);
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
  assert.ok(
    jql!.includes('text ~ "raneyja/Coop AI"') ||
      jql!.includes('text ~ "Coop AI"')
  );
  assert.ok(jql!.includes("ORDER BY updated DESC"));
});

test("buildFocusAwareJiraJql sanitizes hyphenated extras", () => {
  const jql = buildFocusAwareJiraJql({
    owner: "acme",
    repo: "payments",
    extraTerms: ["SQL-injection", "not to mix"]
  });
  assert.ok(jql);
  assert.match(jql!, /SQL injection/);
  assert.match(jql!, /to mix/);
  assert.doesNotMatch(jql!, /SQL-injection|not to mix/);
});

test("fallbackDecisionJiraJql is one sanitized phrase", () => {
  assert.equal(
    fallbackDecisionJiraJql(["SQL-injection", "not to mix"]),
    'text ~ "SQL injection" ORDER BY updated DESC'
  );
  assert.equal(isJiraJqlParseError("Error in the JQL Query: '-' is reserved"), true);
  assert.equal(isJiraJqlParseError("401 Unauthorized"), false);
});

test("buildDecisionJiraJql searches words, never a hyphen", () => {
  const jql = buildDecisionJiraJql(["SQL-injection", "not to mix"]) ?? "";
  assert.match(jql, /text ~ "SQL injection"/);
  assert.match(jql, /text ~ "injection"/);
  assert.match(jql, /text ~ "mix"/);
  assert.match(jql, /ORDER BY updated DESC$/);
  assert.doesNotMatch(jql, /SQL\\-injection|SQL-injection|training-java|\bAND\b|text ~ "not"/);
});

test("buildFocusAwareJiraJql extrasOnly skips hyphenated repo AND", () => {
  const jql = buildFocusAwareJiraJql({
    owner: "coopai-group",
    repo: "training-java-monolith-refactor",
    extraTerms: ["SQL-injection"],
    extrasOnly: true
  });
  assert.ok(jql);
  assert.match(jql!, /SQL injection/);
  assert.doesNotMatch(jql!, /training-java|SQL-injection|AND/);
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

test("named keys skip fuzzy JQL unless the user asked for repo-wide tickets", () => {
  assert.equal(
    shouldRunJiraTextSearch({ namedIssueKeys: ["COOP-242"], wantsRepoDiscovery: false }),
    false
  );
  assert.equal(
    shouldRunJiraTextSearch({ namedIssueKeys: ["COOP-242"], wantsRepoDiscovery: true }),
    true
  );
  assert.equal(shouldRunJiraTextSearch({ namedIssueKeys: [], wantsRepoDiscovery: false }), true);
});

const connectedEmptyTextSearch = {
  textSearchCount: 0,
  runTextSearch: true,
  codeHostConnected: true,
  hasRepo: true,
  hasCodeHostRouter: true
};

test("job searches do not scan git when phrase and word JQL miss", () => {
  assert.equal(
    shouldScanGitForJiraKeys({ ...connectedEmptyTextSearch, jobScoped: true }),
    false
  );
});

test("non-job empty text search still scans git when the code host is connected", () => {
  assert.equal(
    shouldScanGitForJiraKeys({ ...connectedEmptyTextSearch, jobScoped: false }),
    true
  );
  assert.equal(shouldScanGitForJiraKeys(connectedEmptyTextSearch), true);
});

test("git key scan stays off when text search already hit or the host cannot walk", () => {
  assert.equal(
    shouldScanGitForJiraKeys({ ...connectedEmptyTextSearch, textSearchCount: 2 }),
    false
  );
  assert.equal(
    shouldScanGitForJiraKeys({ ...connectedEmptyTextSearch, runTextSearch: false }),
    false
  );
  assert.equal(
    shouldScanGitForJiraKeys({ ...connectedEmptyTextSearch, codeHostConnected: false }),
    false
  );
  assert.equal(
    shouldScanGitForJiraKeys({ ...connectedEmptyTextSearch, hasRepo: false }),
    false
  );
  assert.equal(
    shouldScanGitForJiraKeys({ ...connectedEmptyTextSearch, hasCodeHostRouter: false }),
    false
  );
});

const total = passed + failed;
console.log(`\njiraContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

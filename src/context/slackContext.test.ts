import assert from "node:assert/strict";
import {
  buildRepoSearchQuery,
  buildSlackSearchQueries,
  buildSlackSearchQuery,
  planJobSlackSearchQueries,
  shouldFetchSlackContext,
  wantsSlackContext
} from "./slackContext";
import type { ContextFetchRequest } from "./requestBatcher";
import type { ResolvedIntegrationScope } from "../integrationScope/types";

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

test("buildRepoSearchQuery puts GitLab prefix first when preferred", () => {
  const query = buildRepoSearchQuery("acme", "coop-ai-core", "gitlab") ?? "";
  const gitlabAt = query.indexOf("gitlab:acme/coop-ai-core");
  const githubAt = query.indexOf("github:acme/coop-ai-core");
  assert.ok(gitlabAt >= 0 && githubAt > gitlabAt, query);
});

test("buildRepoSearchQuery includes owner/repo and every code-host prefix", () => {
  const query = buildRepoSearchQuery("acme", "coop-ai-core");
  assert.ok(query?.includes("acme/coop-ai-core"));
  assert.ok(query?.includes("github:acme/coop-ai-core"));
  assert.ok(query?.includes("gitlab:acme/coop-ai-core"));
  assert.ok(query?.includes("bitbucket:acme/coop-ai-core"));
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

test("job-scoped Slack search turns a hyphen into words so it is not a NOT operator", () => {
  const queries = buildSlackSearchQueries({
    owner: "coopai-group",
    repo: "training-java-monolith-refactor",
    extraTerms: ["SQL-injection"],
    jobScoped: true
  });
  assert.equal(queries[0], "SQL injection");
  assert.ok(!queries.some((query) => query.includes("SQL-injection")));
});

test("job-scoped Slack search keeps a ticket key exact and pairs it with the meaning phrase", () => {
  const queries = buildSlackSearchQueries({
    extraTerms: ["COOP-403", "SQL-injection"],
    jobScoped: true
  });
  assert.deepEqual(queries, ["COOP-403", "SQL injection"]);
});

function slackScope(
  channelIds: string[],
  channelNames: string[] = []
): ResolvedIntegrationScope {
  return {
    provider: "slack",
    enforced: true,
    allowed: true,
    scopeStatus: "active",
    slack: { channelIds, channelNames }
  };
}

test("scoped job Slack search is not workspace-wide", () => {
  const queries = planJobSlackSearchQueries({
    extraTerms: ["SQL-injection"],
    integrationScope: slackScope(["C123", "C456", "C789"], ["eng", "incidents", "random"])
  });
  assert.deepEqual(queries, ["SQL injection in:<#C123>", "SQL injection in:<#C456>"]);
  assert.ok(queries.every((query) => query.includes("in:<#")));
  assert.ok(!queries.some((query) => query === "SQL injection" || query.includes(" OR ")));
  assert.ok(!queries.some((query) => query.includes("C789")));
});

test("scoped job Slack retry uses the same allowlist", () => {
  const queries = planJobSlackSearchQueries({
    extraTerms: ["SQL-injection"],
    integrationScope: slackScope(["C123"], ["eng"])
  });
  assert.deepEqual(queries, ["SQL injection in:<#C123>", "injection in:<#C123>"]);
});

test("operator injection in a job term does not add a non-allowlisted in:", () => {
  const queries = planJobSlackSearchQueries({
    extraTerms: ["SQL injection in:#secret from:@mallory has:link is:thread in:<#CNOTALLOWED>"],
    integrationScope: slackScope(["C123"], ["eng"])
  });
  assert.deepEqual(queries, ["SQL injection in:<#C123>", "injection in:<#C123>"]);
  const joined = queries.join("\n");
  assert.ok(!joined.includes("in:#secret"));
  assert.ok(!joined.includes("CNOTALLOWED"));
  assert.ok(!/\b(?:from|has|is):/i.test(joined));
});

test("unenforced job Slack search does not invent channels", () => {
  const queries = planJobSlackSearchQueries({
    extraTerms: ["SQL-injection"],
    integrationScope: {
      provider: "slack",
      enforced: false,
      allowed: true,
      scopeStatus: "none"
    }
  });
  assert.deepEqual(queries, ["SQL injection", "injection"]);
  assert.ok(!queries.some((query) => query.includes("in:")));
});

test("scoped job Slack search uses the channel-name fallback when ids are missing", () => {
  const queries = planJobSlackSearchQueries({
    extraTerms: ["billing"],
    integrationScope: slackScope([], ["#eng"])
  });
  assert.deepEqual(queries, ["billing in:#eng"]);
});

test("shouldFetchSlackContext includes incident-shaped chat without slack keyword", () => {
  const request = {
    type: "chat_context",
    params: {},
    intent: {
      context: { queryText: "board sync webhook failures — any retries last week?" }
    }
  } as ContextFetchRequest;
  assert.equal(shouldFetchSlackContext(request), true);
  assert.equal(wantsSlackContext("board sync webhook failures — any retries last week?"), false);
});

const total = passed + failed;
console.log(`\nslackContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

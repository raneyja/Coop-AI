/**
 * Shared job-verb gates — latest/search/honesty for every integration worker.
 * Slack-shaped copy-paste asserts fail this file on purpose.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { extraTermsForIntegration, jobVerbForIntegration } from "../chat/intentPlanner/planChatJobs";
import { planRawChatAskFromRules } from "../chat/intentPlanner/frontDoor";
import type { IntegrationChatProvider } from "../chat/types";
import { fetchConfluenceSearchContext } from "./confluenceContext";
import { fetchGoogleDocsSearchContext } from "./googleDocsContext";
import { fetchJiraSearchContext } from "./jiraContext";
import { fetchNotionSearchContext } from "./notionContext";
import { fetchSlackSearchContext, planJobSlackSearchQueries } from "./slackContext";
import { fetchTeamsSearchContext } from "./teamsContext";
import { fetchCodeHostSearchContext } from "./codeHostContext";
import {
  emptySearchTopicError,
  latestNeedsScopeError,
  latestUnsupportedError,
  missingRepoSearchError,
  SETTINGS_REPO_LIE
} from "./integrationJobErrors";
import type { ResolvedIntegrationScope } from "../integrationScope/types";

const USE_REPO = "coopai-group/training-java-monolith-refactor";
const CONNECTED: IntegrationChatProvider[] = [
  "slack",
  "jira",
  "confluence",
  "notion",
  "google-docs"
];

const RECENCY: Array<{ ask: string; provider: IntegrationChatProvider }> = [
  { ask: "/slack search for the most recent post", provider: "slack" },
  { ask: "/jira latest tickets", provider: "jira" },
  { ask: "/docs most recent document", provider: "google-docs" },
  { ask: "/confluence latest pages", provider: "confluence" },
  { ask: "/notion most recent", provider: "notion" }
];

const secrets = {
  getCredentials: async () => ({
    slackToken: "xoxb-test",
    notionToken: "ntn-test",
    googleDocsToken: "ya29-test",
    atlassianCloudId: "cloud"
  })
} as never;

function blockedScope(provider: ResolvedIntegrationScope["provider"]): ResolvedIntegrationScope {
  return {
    provider,
    enforced: true,
    allowed: false,
    scopeStatus: "required",
    reason: "Your organization admin must configure scope in the admin portal."
  };
}

test("recency-only job-scoped fetch never emits the Settings lie", async () => {
  for (const row of RECENCY) {
    const turn = planRawChatAskFromRules(row.ask, {
      connectedTools: CONNECTED,
      useRepo: USE_REPO
    });
    assert.equal(jobVerbForIntegration(turn.plan.jobs, row.provider), "latest", row.ask);
    assert.deepEqual(extraTermsForIntegration(turn.plan.jobs, row.provider), [], row.ask);
    assert.equal(turn.toolQueries[row.provider]?.[0], "latest", row.ask);

    const result = await fetchForProvider(row.provider, {
      extraTerms: extraTermsForIntegration(turn.plan.jobs, row.provider) ?? [],
      jobScoped: true,
      jobVerb: "latest"
    });
    assert.equal(result.error?.includes(SETTINGS_REPO_LIE), false, `${row.ask} → ${result.error}`);
    assert.equal(result.error, latestNeedsScopeError(resourceFor(row.provider)), row.ask);
  }
});

test("latest + enforced empty allowlist is a scope block, not a workspace dump", async () => {
  const slack = await fetchSlackSearchContext({
    secrets,
    extraTerms: [],
    jobScoped: true,
    jobVerb: "latest",
    integrationScope: blockedScope("slack")
  });
  assert.match(slack.error ?? "", /admin/i);
  assert.equal(slack.error?.includes(SETTINGS_REPO_LIE), false);
  assert.deepEqual(slack.messages, []);

  const jira = await fetchJiraSearchContext({
    secrets,
    extraTerms: [],
    jobScoped: true,
    jobVerb: "latest",
    integrationScope: blockedScope("atlassian"),
    client: {
      getIssue: async () => {
        throw new Error("should not open issues");
      },
      searchIssues: async () => {
        throw new Error("should not search Jira");
      }
    }
  });
  assert.match(jira.error ?? "", /admin/i);
  assert.deepEqual(jira.issues, []);
});

test("search with empty topic is honest, not Settings", async () => {
  const slack = await fetchSlackSearchContext({
    secrets,
    extraTerms: [],
    jobScoped: true,
    jobVerb: "search"
  });
  assert.equal(slack.error, emptySearchTopicError("Slack"));

  const jira = await fetchJiraSearchContext({
    secrets,
    extraTerms: [],
    jobScoped: true,
    jobVerb: "search",
    client: {
      getIssue: async () => {
        throw new Error("missing");
      },
      searchIssues: async () => []
    }
  });
  assert.equal(jira.error, emptySearchTopicError("Jira"));
});

test("allowlisted Slack latest sends in: modifiers, not a repo slug", () => {
  const queries = planJobSlackSearchQueries({
    extraTerms: [],
    jobVerb: "latest",
    integrationScope: {
      provider: "slack",
      enforced: true,
      allowed: true,
      scopeStatus: "active",
      slack: { channelIds: ["C123"], channelNames: ["eng"] }
    }
  });
  assert.deepEqual(queries, ["in:<#C123>"]);
  assert.equal(queries.some((query) => /training-java|plane/i.test(query)), false);
});

test("allowlisted Jira latest searches project scope newest-first", async () => {
  const jqls: string[] = [];
  const result = await fetchJiraSearchContext({
    secrets,
    extraTerms: [],
    jobScoped: true,
    jobVerb: "latest",
    integrationScope: {
      provider: "atlassian",
      enforced: true,
      allowed: true,
      scopeStatus: "active",
      atlassian: {
        jiraProjectIds: ["10000"],
        jiraProjectKeys: ["COOP"],
        jiraProjectNames: ["Coop"],
        confluenceSpaceIds: [],
        confluenceSpaceKeys: [],
        confluenceSpaceNames: []
      }
    },
    client: {
      getIssue: async () => {
        throw new Error("missing");
      },
      searchIssues: async (jql) => {
        jqls.push(jql);
        return [];
      }
    }
  });
  assert.equal((result.error ?? "").includes(SETTINGS_REPO_LIE), false);
  assert.ok(jqls[0]?.includes('project in ("COOP")'), jqls[0]);
  assert.match(jqls[0] ?? "", /ORDER BY updated DESC/i);
});

test("Teams latest is an honest decline, never Slack", async () => {
  const result = await fetchTeamsSearchContext({
    secrets,
    extraTerms: [],
    jobScoped: true,
    jobVerb: "latest"
  });
  assert.equal(result.error, latestUnsupportedError("Microsoft Teams"));
  assert.deepEqual(result.messages, []);
});

test("code-host latest without Use-repo is a missing-repo error, not a Settings-only lie", async () => {
  const result = await fetchCodeHostSearchContext({
    router: {
      listRepoPullRequests: async () => [],
      listRepoIssues: async () => []
    } as never,
    jobVerb: "latest"
  });
  assert.equal(result.error, missingRepoSearchError("pull requests and issues"));
  assert.equal(result.error?.includes(SETTINGS_REPO_LIE), false);
});

async function fetchForProvider(
  provider: IntegrationChatProvider,
  options: { extraTerms: string[]; jobScoped: true; jobVerb: "latest" }
): Promise<{ error?: string }> {
  switch (provider) {
    case "slack":
      return fetchSlackSearchContext({ secrets, ...options });
    case "jira":
      return fetchJiraSearchContext({
        secrets,
        ...options,
        client: {
          getIssue: async () => {
            throw new Error("missing");
          },
          searchIssues: async () => []
        }
      });
    case "confluence":
      return fetchConfluenceSearchContext({ secrets, ...options });
    case "notion":
      return fetchNotionSearchContext({ secrets, ...options });
    case "google-docs":
      return fetchGoogleDocsSearchContext({ secrets, ...options });
    default:
      return { error: "unsupported" };
  }
}

function resourceFor(provider: IntegrationChatProvider): string {
  switch (provider) {
    case "slack":
      return "Slack messages";
    case "jira":
      return "Jira tickets";
    case "confluence":
      return "Confluence pages";
    case "notion":
      return "Notion pages";
    case "google-docs":
      return "Google Docs";
    default:
      return provider;
  }
}

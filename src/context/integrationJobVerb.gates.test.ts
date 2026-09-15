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

test("Jira search hits keep the opened ticket body", async () => {
  const opened: string[] = [];
  const result = await fetchJiraSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      getIssue: async (key) => {
        opened.push(key);
        return {
          key: "COOP-101",
          summary: "Auth hardening",
          description: "Chose GitHub App over PAT for requireAuth.",
          status: "Done",
          issueType: "Story",
          acceptanceCriteria: [],
          labels: [],
          technicalDebt: false,
          created: "2026-01-01T00:00:00.000Z",
          updated: "2026-01-02T00:00:00.000Z",
          htmlUrl: "https://example.atlassian.net/browse/COOP-101"
        };
      },
      searchIssues: async () => [
        {
          key: "COOP-101",
          summary: "Auth hardening",
          status: "Done",
          issueType: "Story",
          acceptanceCriteria: [],
          labels: [],
          technicalDebt: false,
          created: "2026-01-01T00:00:00.000Z",
          updated: "2026-01-02T00:00:00.000Z",
          htmlUrl: "https://example.atlassian.net/browse/COOP-101"
        }
      ]
    }
  });
  assert.deepEqual(opened, ["COOP-101"]);
  assert.equal(result.issues[0]?.key, "COOP-101");
  assert.match(result.issues[0]?.description ?? "", /GitHub App/);
});

test("Confluence search opens ADR page body after a hit", async () => {
  const opened: string[] = [];
  const result = await fetchConfluenceSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      searchPages: async () => [
        {
          id: "42",
          title: "ADR: GitHub App API (COOP-101)",
          excerpt: "short snippet",
          updated: "2026-01-02T00:00:00.000Z",
          htmlUrl: "https://wiki/42"
        }
      ],
      getPageBody: async (id) => {
        opened.push(id);
        return "We chose a GitHub App so requireAuth can verify installation tokens.";
      }
    }
  });
  assert.deepEqual(opened, ["42"]);
  assert.match(result.pages[0]?.excerpt ?? "", /GitHub App so requireAuth/);
});

test("Notion search opens ADR page body after a hit", async () => {
  const opened: string[] = [];
  const result = await fetchNotionSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      searchPages: async () => [
        {
          id: "notion-adr-1",
          title: "ADR: GitHub App API (COOP-101)",
          updated: "2026-01-02T00:00:00.000Z",
          htmlUrl: "https://notion.so/notion-adr-1"
        }
      ],
      getPagePlainText: async (id) => {
        opened.push(id);
        return "We chose a GitHub App so requireAuth can verify installation tokens.";
      }
    }
  });
  assert.deepEqual(opened, ["notion-adr-1"]);
  assert.match(result.pages[0]?.excerpt ?? "", /GitHub App so requireAuth/);
});

test("Google Docs search opens ADR document body after a hit", async () => {
  const opened: string[] = [];
  const result = await fetchGoogleDocsSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      searchDocumentsForTerms: async () => [
        {
          id: "gdoc-adr-1",
          title: "ADR: GitHub App API (COOP-101)",
          updated: "2026-01-02T00:00:00.000Z",
          htmlUrl: "https://docs.google.com/document/d/gdoc-adr-1"
        }
      ],
      listRecentDocuments: async () => [],
      getDocumentPlainText: async (id) => {
        opened.push(id);
        return "We chose a GitHub App so requireAuth can verify installation tokens.";
      }
    }
  });
  assert.deepEqual(opened, ["gdoc-adr-1"]);
  assert.match(result.documents[0]?.excerpt ?? "", /GitHub App so requireAuth/);
});

test("Notion job-scoped search opens top hit when title is not ADR-shaped", async () => {
  const opened: string[] = [];
  const result = await fetchNotionSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      searchPages: async () => [
        {
          id: "notion-plain-1",
          title: "Auth notes for peel",
          updated: "2026-01-02T00:00:00.000Z",
          htmlUrl: "https://notion.so/notion-plain-1"
        }
      ],
      getPagePlainText: async (id) => {
        opened.push(id);
        return "Decision: use installation tokens for requireAuth.";
      }
    }
  });
  assert.deepEqual(opened, ["notion-plain-1"]);
  assert.match(result.pages[0]?.excerpt ?? "", /installation tokens/);
});

test("Slack search opens full thread body after a hit", async () => {
  const opened: string[] = [];
  const result = await fetchSlackSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      searchMessages: async () => [
        {
          channelId: "C123",
          channelName: "eng",
          ts: "1000.1",
          threadTs: "1000.1",
          text: "short snippet about auth",
          userId: "U1",
          userName: "alice",
          permalink: "https://slack.com/archives/C123/p1000000001000100"
        }
      ],
      getThread: async (channelId, threadTs) => {
        opened.push(`${channelId}:${threadTs}`);
        return {
          channelId,
          threadTs,
          messages: [
            {
              ts: "1000.1",
              userId: "U1",
              userName: "alice",
              text: "Chose GitHub App over PAT for requireAuth."
            },
            {
              ts: "1000.2",
              userId: "U2",
              userName: "bob",
              text: "Agreed — ship the App install path."
            }
          ],
          participants: ["alice", "bob"]
        };
      }
    }
  });
  assert.deepEqual(opened, ["C123:1000.1"]);
  assert.match(result.messages[0]?.text ?? "", /GitHub App over PAT/);
  assert.equal(result.messages[0]?.threadOpened, true);
  assert.ok((result.messages[0]?.text.length ?? 0) > "short snippet about auth".length);
});

test("Slack job-scoped search opens top hit when snippet is not decision-shaped", async () => {
  const opened: string[] = [];
  const result = await fetchSlackSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      searchMessages: async () => [
        {
          channelId: "C99",
          channelName: "eng",
          ts: "2000.1",
          text: "random chatter",
          userId: "U9",
          userName: "carol"
        }
      ],
      getThread: async (channelId, threadTs) => {
        opened.push(`${channelId}:${threadTs}`);
        return {
          channelId,
          threadTs,
          messages: [
            {
              ts: "2000.1",
              userId: "U9",
              userName: "carol",
              text: "Decision: use installation tokens for requireAuth."
            }
          ],
          participants: ["carol"]
        };
      }
    }
  });
  assert.deepEqual(opened, ["C99:2000.1"]);
  assert.match(result.messages[0]?.text ?? "", /installation tokens/);
});

test("Teams search opens full thread body after a hit", async () => {
  const opened: string[] = [];
  const result = await fetchTeamsSearchContext({
    secrets: {
      getCredentials: async () => ({
        ...((await secrets.getCredentials()) as object),
        teamsToken: "teams-test"
      })
    } as never,
    extraTerms: ["peel auth"],
    jobScoped: true,
    client: {
      searchMessages: async () => [
        {
          teamId: "T1",
          channelId: "CH1",
          messageId: "M1",
          body: "short snippet about auth",
          fromUserName: "dana",
          createdAt: "2026-01-02T00:00:00.000Z",
          webUrl: "https://teams.microsoft.com/l/message/M1"
        }
      ],
      getThread: async (teamId, channelId, messageId) => {
        opened.push(`${teamId}:${channelId}:${messageId}`);
        return {
          teamId,
          channelId,
          rootMessageId: messageId,
          messages: [
            {
              id: "M1",
              createdAt: "2026-01-02T00:00:00.000Z",
              fromUserName: "dana",
              body: "Chose GitHub App over PAT for requireAuth."
            }
          ],
          participants: ["dana"]
        };
      }
    }
  });
  assert.deepEqual(opened, ["T1:CH1:M1"]);
  assert.match(result.messages[0]?.body ?? "", /GitHub App over PAT/);
  assert.equal(result.messages[0]?.threadOpened, true);
});

test("code-host search opens PR description after a hit", async () => {
  const opened: number[] = [];
  const result = await fetchCodeHostSearchContext({
    provider: "github",
    owner: "acme",
    repo: "app",
    queryText: "PR #53 auth",
    jobScoped: true,
    jobVerb: "search",
    openPullBodies: true,
    router: {
      listRepoPullRequests: async () => [
        {
          number: 53,
          title: "Auth hardening",
          state: "merged",
          merged: true,
          updatedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      listRepoIssues: async () => [],
      getPullRequestDetail: async (n: number) => {
        opened.push(n);
        return {
          number: 53,
          title: "Auth hardening",
          body: "Chose GitHub App over PAT for requireAuth.",
          state: "closed",
          merged: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          labels: []
        };
      }
    } as never
  });
  assert.deepEqual(opened, [53]);
  assert.match(result.pullRequests[0]?.body ?? "", /GitHub App/);
  assert.equal(result.pullRequests[0]?.bodyOpened, true);
});

test("code-host latest never opens PR bodies", async () => {
  const opened: number[] = [];
  await fetchCodeHostSearchContext({
    provider: "github",
    owner: "acme",
    repo: "app",
    jobVerb: "latest",
    jobScoped: true,
    openPullBodies: true,
    router: {
      listRepoPullRequests: async () => [
        {
          number: 53,
          title: "Auth hardening",
          state: "merged",
          merged: true,
          updatedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      listRepoIssues: async () => [],
      getPullRequestDetail: async (n: number) => {
        opened.push(n);
        return {
          number: n,
          title: "Auth hardening",
          body: "should not open",
          state: "closed",
          merged: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          labels: []
        };
      }
    } as never
  });
  assert.deepEqual(opened, []);
});

test("code-host unfiltered bulk list does not open PR bodies (Blast guard)", async () => {
  const opened: number[] = [];
  await fetchCodeHostSearchContext({
    provider: "github",
    owner: "acme",
    repo: "app",
    queryText: "open pull requests src/server/auth.ts",
    router: {
      listRepoPullRequests: async () => [
        {
          number: 53,
          title: "Auth hardening",
          state: "open",
          merged: false,
          updatedAt: "2026-01-02T00:00:00.000Z"
        },
        {
          number: 54,
          title: "Other work",
          state: "open",
          merged: false,
          updatedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      listRepoIssues: async () => [],
      getPullRequestDetail: async (n: number) => {
        opened.push(n);
        return {
          number: n,
          title: "Auth",
          body: "should not open",
          state: "open",
          merged: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          labels: []
        };
      }
    } as never
  });
  assert.deepEqual(opened, []);
});

test("code-host detail fetch failure keeps title row", async () => {
  const result = await fetchCodeHostSearchContext({
    provider: "github",
    owner: "acme",
    repo: "app",
    queryText: "PR #53",
    openPullBodies: true,
    router: {
      listRepoPullRequests: async () => [
        {
          number: 53,
          title: "Auth hardening",
          state: "merged",
          merged: true,
          updatedAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      listRepoIssues: async () => [],
      getPullRequestDetail: async () => {
        throw new Error("not found");
      }
    } as never
  });
  assert.equal(result.pullRequests[0]?.number, 53);
  assert.equal(result.pullRequests[0]?.body, undefined);
  assert.equal(result.pullRequests[0]?.bodyOpened, undefined);
  assert.equal(result.error, undefined);
});

test("knowledge-gaps Notion openAfterHit opens top hit when title is not ADR-shaped", async () => {
  const opened: string[] = [];
  const result = await fetchNotionSearchContext({
    secrets,
    extraTerms: ["peel auth"],
    openAfterHit: true,
    client: {
      searchPages: async () => [
        {
          id: "notion-gaps-1",
          title: "Auth notes for peel",
          updated: "2026-01-02T00:00:00.000Z",
          htmlUrl: "https://notion.so/notion-gaps-1"
        }
      ],
      getPagePlainText: async (id) => {
        opened.push(id);
        return "Decision: use installation tokens for requireAuth.";
      }
    }
  });
  assert.deepEqual(opened, ["notion-gaps-1"]);
  assert.match(result.pages[0]?.excerpt ?? "", /installation tokens/);
});

test("knowledge-gaps Slack openAfterHit opens thread after a hit", async () => {
  const opened: string[] = [];
  const result = await fetchSlackSearchContext({
    secrets,
    owner: "acme",
    repo: "app",
    queryText: "auth decision",
    openAfterHit: true,
    client: {
      searchMessages: async () => [
        {
          channelId: "C123",
          channelName: "eng",
          ts: "1000.1",
          threadTs: "1000.1",
          text: "short snippet",
          userId: "U1",
          userName: "alice"
        }
      ],
      getThread: async (channelId, threadTs) => {
        opened.push(`${channelId}:${threadTs}`);
        return {
          channelId,
          threadTs,
          messages: [
            {
              ts: "1000.1",
              userId: "U1",
              userName: "alice",
              text: "Chose GitHub App over PAT for requireAuth."
            }
          ],
          participants: ["alice"]
        };
      }
    }
  });
  assert.deepEqual(opened, ["C123:1000.1"]);
  assert.equal(result.messages[0]?.threadOpened, true);
  assert.match(result.messages[0]?.text ?? "", /GitHub App/);
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

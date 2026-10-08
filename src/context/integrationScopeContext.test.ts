import test from "node:test";
import assert from "node:assert/strict";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import type { JiraIssue } from "../api/jira/jiraClient";
import { fetchConfluenceSearchContext } from "./confluenceContext";
import { fetchGoogleDocsSearchContext } from "./googleDocsContext";
import { fetchJiraSearchContext } from "./jiraContext";
import { fetchNotionSearchContext } from "./notionContext";
import { fetchSlackSearchContext } from "./slackContext";
import { fetchTeamsSearchContext } from "./teamsContext";

const emptySecrets = {
  getCredentials: async () => ({})
} as unknown as IntegrationSecrets;

const atlassianScopeNoJiraProjects: ResolvedIntegrationScope = {
  provider: "atlassian",
  enforced: true,
  allowed: true,
  scopeStatus: "active",
  atlassian: {
    jiraProjectIds: [],
    jiraProjectKeys: [],
    jiraProjectNames: [],
    confluenceSpaceIds: ["1"],
    confluenceSpaceKeys: ["ENG"],
    confluenceSpaceNames: ["Engineering"]
  }
};

const atlassianScopeNoConfluenceSpaces: ResolvedIntegrationScope = {
  provider: "atlassian",
  enforced: true,
  allowed: true,
  scopeStatus: "active",
  atlassian: {
    jiraProjectIds: ["1"],
    jiraProjectKeys: ["COOP"],
    jiraProjectNames: ["Coop"],
    confluenceSpaceIds: [],
    confluenceSpaceKeys: [],
    confluenceSpaceNames: []
  }
};

test("fetchJiraSearchContext blocks before Jira credentials when scope has no projects", async () => {
  const result = await fetchJiraSearchContext({
    secrets: emptySecrets,
    owner: "acme",
    repo: "coop",
    integrationScope: atlassianScopeNoJiraProjects
  });
  assert.equal(result.issues.length, 0);
  assert.match(result.error ?? "", /Jira scope/i);
});

function fakeJiraIssue(key: string, summary: string): JiraIssue {
  return {
    key,
    summary,
    status: "To Do",
    issueType: "Story",
    acceptanceCriteria: [],
    labels: [],
    technicalDebt: false,
    created: "2026-09-10T00:00:00.000Z",
    updated: "2026-09-10T00:00:00.000Z",
    htmlUrl: `https://coop-ai.atlassian.net/browse/${key}`
  };
}

test("named Jira keys open by ID and skip keyword JQL even if an alias key 404s", async () => {
  let searched = false;
  const result = await fetchJiraSearchContext({
    secrets: emptySecrets,
    owner: "coopai-group",
    repo: "training-java-monolith-refactor",
    queryText:
      "I'm covering COOP-401 this week (Jira COOP-242) — SQL injection in customers.jsp.",
    client: {
      async getIssue(key) {
        if (key === "COOP-242") {
          return fakeJiraIssue("COOP-242", "SQL injection in customers.jsp");
        }
        throw new Error(`An issue with key '${key}' does not exist for field 'key'.`);
      },
      async searchIssues() {
        searched = true;
        throw new Error("JQL error — should not run when keys are named");
      }
    }
  });
  assert.equal(searched, false);
  assert.equal(result.error, undefined);
  assert.equal(result.matchStrategy, "key");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.key, "COOP-242");
  assert.equal(result.keyErrors?.[0]?.key, "COOP-401");
});

test("agent Jira search still opens keys named in the user message", async () => {
  const result = await fetchJiraSearchContext({
    secrets: emptySecrets,
    owner: "coopai-group",
    repo: "training-java-monolith-refactor",
    queryText: "SQL injection customers.jsp training-java-monolith-refactor",
    contextText: [
      "I'm covering COOP-401 this week (Jira COOP-242) — SQL injection in customers.jsp."
    ],
    client: {
      async getIssue(key) {
        if (key === "COOP-242") {
          return fakeJiraIssue("COOP-242", "SQL injection in customers.jsp");
        }
        throw new Error(`An issue with key '${key}' does not exist for field 'key'.`);
      },
      async searchIssues() {
        throw new Error("JQL error — should not run when the user named keys");
      }
    }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.issues[0]?.key, "COOP-242");
  assert.ok(result.keyErrors?.some((entry) => entry.key === "COOP-401"));
});

test("missing named keys are returned as errors instead of a silent empty search", async () => {
  const result = await fetchJiraSearchContext({
    secrets: emptySecrets,
    queryText: "summarize COOP-999",
    client: {
      async getIssue(key) {
        throw new Error(`An issue with key '${key}' does not exist for field 'key'.`);
      },
      async searchIssues() {
        throw new Error("JQL should not run");
      }
    }
  });
  assert.equal(result.issues.length, 0);
  assert.match(result.error ?? "", /COOP-999/);
  assert.equal(result.keyErrors?.[0]?.key, "COOP-999");
});

test("named keys plus repo-wide discovery still run keyword search", async () => {
  let searched = false;
  const result = await fetchJiraSearchContext({
    secrets: emptySecrets,
    owner: "acme",
    repo: "app",
    queryText: "COOP-242 tickets related to this repo",
    client: {
      async getIssue(key) {
        if (key === "COOP-242") {
          return fakeJiraIssue("COOP-242", "SQL injection");
        }
        throw new Error(`missing ${key}`);
      },
      async searchIssues() {
        searched = true;
        return [];
      }
    }
  });
  assert.equal(searched, true);
  assert.equal(result.issues[0]?.key, "COOP-242");
});

test("project scope does not silently drop named tickets", async () => {
  const result = await fetchJiraSearchContext({
    secrets: emptySecrets,
    queryText: "summarize COOP-242",
    integrationScope: {
      provider: "atlassian",
      enforced: true,
      allowed: true,
      scopeStatus: "active",
      atlassian: {
        jiraProjectIds: ["99"],
        jiraProjectKeys: ["OTHER"],
        jiraProjectNames: ["Other"],
        confluenceSpaceIds: ["1"],
        confluenceSpaceKeys: ["ENG"],
        confluenceSpaceNames: ["Engineering"]
      }
    },
    client: {
      async getIssue() {
        return fakeJiraIssue("COOP-242", "SQL injection");
      },
      async searchIssues() {
        return [];
      }
    }
  });
  assert.equal(result.issues.length, 0);
  assert.match(result.error ?? "", /scope excluded/i);
});

test("fetchConfluenceSearchContext blocks before Confluence credentials when scope has no spaces", async () => {
  const result = await fetchConfluenceSearchContext({
    secrets: emptySecrets,
    owner: "acme",
    repo: "coop",
    integrationScope: atlassianScopeNoConfluenceSpaces
  });
  assert.equal(result.pages.length, 0);
  assert.match(result.error ?? "", /Confluence scope/i);
});

test("fetchNotionSearchContext blocks when notion scope is not allowed", async () => {
  const result = await fetchNotionSearchContext({
    secrets: emptySecrets,
    owner: "acme",
    repo: "coop",
    integrationScope: {
      provider: "notion",
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason: "Notion scope required"
    }
  });
  assert.equal(result.pages.length, 0);
  assert.equal(result.error, "Notion scope required");
});

test("fetchGoogleDocsSearchContext blocks when google docs scope is not allowed", async () => {
  const result = await fetchGoogleDocsSearchContext({
    secrets: emptySecrets,
    owner: "acme",
    repo: "coop",
    integrationScope: {
      provider: "google-docs",
      enforced: true,
      allowed: false,
      scopeStatus: "required",
      reason: "Google Docs scope required"
    }
  });
  assert.equal(result.documents.length, 0);
  assert.equal(result.error, "Google Docs scope required");
});

test("Choose Open re-applies provider scope to prior integration hits", async () => {
  const slack = await fetchSlackSearchContext({
    secrets: emptySecrets,
    queryText: "decision",
    openIds: ["C-allowed:1"],
    existingHits: {
      messages: [
        { id: "C-allowed:1", channelId: "C-allowed", ts: "1", text: "allowed" },
        { id: "C-denied:2", channelId: "C-denied", ts: "2", text: "denied" }
      ]
    },
    integrationScope: {
      provider: "slack", enforced: true, allowed: true, scopeStatus: "active",
      slack: { channelIds: ["C-allowed"], channelNames: ["eng"] }
    },
    client: {
      searchMessages: async () => [],
      getThread: async () => ({ channelId: "C-allowed", threadTs: "1", messages: [], participants: [] })
    }
  });
  assert.deepEqual(slack.messages.map((message) => message.channelId), ["C-allowed"]);

  const teams = await fetchTeamsSearchContext({
    secrets: emptySecrets,
    queryText: "decision",
    openIds: ["allowed"],
    existingHits: {
      messages: [
        { messageId: "allowed", teamId: "T1", channelId: "CH-allowed", body: "allowed", createdAt: "" },
        { messageId: "denied", teamId: "T1", channelId: "CH-denied", body: "denied", createdAt: "" }
      ]
    },
    integrationScope: {
      provider: "teams", enforced: true, allowed: true, scopeStatus: "active",
      teams: { channelIds: ["CH-allowed"], channelNames: ["eng"], teamIds: ["T1"] }
    },
    client: { searchMessages: async () => [] }
  });
  assert.deepEqual(teams.messages.map((message) => message.channelId), ["CH-allowed"]);

  const jira = await fetchJiraSearchContext({
    secrets: emptySecrets,
    queryText: "COOP-1",
    openIds: ["COOP-1"],
    existingHits: {
      issues: [
        { key: "COOP-1", summary: "allowed", status: "Done", issueType: "Task", updated: "", htmlUrl: "" },
        { key: "OPS-1", summary: "denied", status: "Done", issueType: "Task", updated: "", htmlUrl: "" }
      ]
    },
    integrationScope: {
      provider: "atlassian", enforced: true, allowed: true, scopeStatus: "active",
      atlassian: {
        jiraProjectIds: ["1"], jiraProjectKeys: ["COOP"], jiraProjectNames: ["Coop"],
        confluenceSpaceIds: [], confluenceSpaceKeys: [], confluenceSpaceNames: []
      }
    },
    client: {
      getIssue: async (key) => fakeJiraIssue(key, key),
      searchIssues: async () => []
    }
  });
  assert.deepEqual(jira.issues.map((issue) => issue.key), ["COOP-1"]);

  const docs = await fetchGoogleDocsSearchContext({
    secrets: emptySecrets,
    queryText: "Architecture",
    openIds: ["doc-allowed"],
    existingHits: {
      documents: [
        { id: "doc-allowed", title: "allowed", updated: "", htmlUrl: "", parents: ["folder-allowed"] },
        { id: "doc-denied", title: "denied", updated: "", htmlUrl: "", parents: ["folder-denied"] }
      ]
    },
    integrationScope: {
      provider: "google-docs", enforced: true, allowed: true, scopeStatus: "active",
      googleDocs: { folderIds: ["folder-allowed"], folderNames: ["Fixture"], folderKinds: ["folder"], expandedFolderIds: ["folder-allowed"] }
    },
    client: {
      searchDocumentsForTerms: async () => [],
      listRecentDocuments: async () => [],
      getDocumentPlainText: async () => "COOP_DOGFOOD_DECISION_20261003 body"
    }
  });
  assert.deepEqual(docs.documents.map((document) => document.id), ["doc-allowed"]);
  assert.match(docs.documents[0]?.excerpt ?? "", /COOP_DOGFOOD_DECISION/);

  const notion = await fetchNotionSearchContext({
    secrets: emptySecrets,
    queryText: "decision",
    openIds: ["page-allowed"],
    existingHits: {
      pages: [
        { id: "page-allowed", title: "allowed", updated: "", htmlUrl: "", parentId: "resource-allowed" },
        { id: "page-denied", title: "denied", updated: "", htmlUrl: "", parentId: "resource-denied" }
      ]
    },
    integrationScope: {
      provider: "notion", enforced: true, allowed: true, scopeStatus: "active",
      notion: { resourceIds: ["resource-allowed"], resourceNames: ["Fixture"] }
    },
    client: {
      searchPages: async () => [],
      getPagePlainText: async () => "COOP_DOGFOOD_DECISION_20261003 body"
    }
  });
  assert.deepEqual(notion.pages.map((page) => page.id), ["page-allowed"]);
  assert.match(notion.pages[0]?.excerpt ?? "", /COOP_DOGFOOD_DECISION/);

  const confluence = await fetchConfluenceSearchContext({
    secrets: emptySecrets,
    queryText: "decision",
    openIds: ["page-allowed"],
    existingHits: {
      pages: [
        { id: "page-allowed", title: "allowed", updated: "", htmlUrl: "", spaceKey: "ENG" },
        { id: "page-denied", title: "denied", updated: "", htmlUrl: "", spaceKey: "OPS" }
      ]
    },
    integrationScope: atlassianScopeNoJiraProjects,
    client: {
      searchPages: async () => [],
      getPageBody: async () => "COOP_DOGFOOD_DECISION_20261003 body"
    }
  });
  assert.deepEqual(confluence.pages.map((page) => page.id), ["page-allowed"]);
  assert.match(confluence.pages[0]?.excerpt ?? "", /COOP_DOGFOOD_DECISION/);
});

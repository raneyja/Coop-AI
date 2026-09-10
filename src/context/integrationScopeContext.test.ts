import test from "node:test";
import assert from "node:assert/strict";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import type { JiraIssue } from "../api/jira/jiraClient";
import { fetchConfluenceSearchContext } from "./confluenceContext";
import { fetchGoogleDocsSearchContext } from "./googleDocsContext";
import { fetchJiraSearchContext } from "./jiraContext";
import { fetchNotionSearchContext } from "./notionContext";

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

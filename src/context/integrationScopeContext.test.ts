import test from "node:test";
import assert from "node:assert/strict";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
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

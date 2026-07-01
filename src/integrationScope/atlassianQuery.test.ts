import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConfluenceSpaceScope,
  applyJiraProjectScope,
  filterJiraIssuesByProject,
  isConfluenceScopeBlocked,
  isJiraScopeBlocked
} from "./atlassianQuery";
import type { ResolvedIntegrationScope } from "./types";

test("isJiraScopeBlocked is false when scope is not enforced", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "jira",
    enforced: false,
    allowed: true,
    scopeStatus: "none"
  };
  assert.equal(isJiraScopeBlocked(scope), false);
});

test("isJiraScopeBlocked is true when enforced with no projects", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "jira",
    enforced: true,
    allowed: true,
    scopeStatus: "configured",
    atlassian: { jiraProjectIds: [], confluenceSpaceIds: [] }
  };
  assert.equal(isJiraScopeBlocked(scope), true);
});

test("applyJiraProjectScope appends project in filters", () => {
  const queries = applyJiraProjectScope(["bug OR crash"], [], ["COOP", "OPS"]);
  assert.equal(queries[0], '(bug OR crash) AND (project in ("COOP", "OPS"))');
});

test("applyConfluenceSpaceScope appends space in filters", () => {
  const queries = applyConfluenceSpaceScope(["docs"], [], ["ENG"]);
  assert.equal(queries[0], '(docs) AND (space in ("ENG"))');
});

test("filterJiraIssuesByProject keeps only allowlisted project keys", () => {
  const issues = [
    { key: "COOP-1" },
    { key: "OPS-2" }
  ];
  const filtered = filterJiraIssuesByProject(issues, new Set(["COOP"]));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.key, "COOP-1");
});

test("isConfluenceScopeBlocked is true when enforced with no spaces", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "confluence",
    enforced: true,
    allowed: true,
    scopeStatus: "configured",
    atlassian: { jiraProjectIds: ["1"], confluenceSpaceIds: [] }
  };
  assert.equal(isConfluenceScopeBlocked(scope), true);
});

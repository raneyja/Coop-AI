/**
 * fetchIntegrations allowlist: non-empty list is a hard restrict on that turn.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ContextFetchRequest } from "./requestBatcher";
import {
  integrationFetchGate,
  normalizeFetchIntegrations,
  requestAllowsIntegrationFetch,
  shouldFetchIntegrationWithAllowlist
} from "./fetchIntegrationsAllowlist";
import { shouldFetchConfluenceContext } from "./confluenceContext";
import { shouldFetchJiraContext } from "./jiraContext";
import { shouldFetchSlackContext } from "./slackContext";

function request(partial: {
  quickAction?: string;
  fetchIntegrations?: string[];
  integrationProvider?: string;
  queryText?: string;
  type?: ContextFetchRequest["type"];
}): ContextFetchRequest {
  return {
    id: "allowlist-test",
    type: partial.type ?? "chat_context",
    params: {
      quickAction: partial.quickAction,
      fetchIntegrations: partial.fetchIntegrations as ContextFetchRequest["params"]["fetchIntegrations"],
      integrationProvider: partial.integrationProvider as ContextFetchRequest["params"]["integrationProvider"]
    },
    intent: {
      id: "allowlist-intent",
      intent: "manual_chat_submit",
      timestamp: new Date(0),
      context: { queryText: partial.queryText ?? "explain this" },
      costEstimate: "expensive"
    },
    cost: "expensive",
    createdAt: new Date(0)
  } as ContextFetchRequest;
}

test("normalizeFetchIntegrations dedupes and filters", () => {
  assert.deepEqual(normalizeFetchIntegrations(["jira", "JIRA", "slack", "nope"]), ["jira", "slack"]);
  assert.deepEqual(normalizeFetchIntegrations(undefined), []);
});

test("integrationFetchGate: empty allowlist falls through", () => {
  assert.equal(integrationFetchGate(request({}), "jira"), "allow");
});

test("integrationFetchGate: non-empty allowlist includes and excludes", () => {
  const req = request({ fetchIntegrations: ["jira"] });
  assert.equal(integrationFetchGate(req, "jira"), "include");
  assert.equal(integrationFetchGate(req, "slack"), "exclude");
  assert.equal(integrationFetchGate(req, "confluence"), "exclude");
});

test("requestAllowsIntegrationFetch is true only for include", () => {
  const req = request({ fetchIntegrations: ["jira"] });
  assert.equal(requestAllowsIntegrationFetch(req, "jira"), true);
  assert.equal(requestAllowsIntegrationFetch(req, "slack"), false);
});

test("shouldFetchIntegrationWithAllowlist excludes non-listed providers", () => {
  const req = request({ fetchIntegrations: ["jira"] });
  assert.equal(
    shouldFetchIntegrationWithAllowlist(req, "slack", () => true),
    false
  );
  assert.equal(
    shouldFetchIntegrationWithAllowlist(req, "jira", () => false),
    true
  );
});

test("Blast + fetchIntegrations jira-only: Jira yes, Slack/Confluence no", () => {
  const restricted = request({
    quickAction: "blast-radius",
    fetchIntegrations: ["jira"],
    type: "blast_radius" as ContextFetchRequest["type"]
  });
  // quickAction still on params — doc integrations would normally fire without restrict.
  const withQa = request({
    quickAction: "blast-radius",
    fetchIntegrations: ["jira"]
  });
  assert.equal(shouldFetchJiraContext(withQa), true);
  assert.equal(shouldFetchSlackContext(withQa), false);
  assert.equal(shouldFetchConfluenceContext(withQa), false);
  assert.equal(shouldFetchJiraContext(restricted), true);
});

test("Bare Blast pill (no fetchIntegrations) still fetches Jira and Confluence", () => {
  const bare = request({ quickAction: "blast-radius" });
  assert.equal(shouldFetchJiraContext(bare), true);
  assert.equal(shouldFetchConfluenceContext(bare), true);
});

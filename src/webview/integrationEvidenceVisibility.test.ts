import assert from "node:assert/strict";
import test from "node:test";
import {
  isIntegrationConnectedForSources,
  isIntegrationNotConnectedError
} from "./integrationEvidenceVisibility";

test("isIntegrationNotConnectedError matches credential stubs", () => {
  assert.ok(isIntegrationNotConnectedError("Microsoft Teams token not configured."));
  assert.ok(isIntegrationNotConnectedError("Slack token not configured."));
  assert.ok(isIntegrationNotConnectedError("Confluence credentials not configured."));
  assert.ok(isIntegrationNotConnectedError("Jira is not connected. Connect Atlassian in Tools."));
});

test("isIntegrationConnectedForSources hides disconnected stubs", () => {
  assert.equal(
    isIntegrationConnectedForSources({
      messages: [],
      error: "Microsoft Teams token not configured."
    }),
    false
  );
  assert.equal(isIntegrationConnectedForSources({ messages: [], pages: [] }), true);
  assert.equal(
    isIntegrationConnectedForSources({
      pages: [],
      error: "Confluence search failed: 401 Unauthorized"
    }),
    true
  );
});

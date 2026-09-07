import assert from "node:assert/strict";
import {
  formatIntegrationHitDetail,
  integrationActivityLabel,
  integrationCompletedActivityLabel,
  integrationRunningActivityLabel,
  isActivityLabelForTool,
  isGenericIntegrationStatusLabel,
  isIntegrationActivityLabel,
  preferredIntegrationActivityQuery,
  stripGenericIntegrationStatus
} from "./integrationActivityLabels";

let passed = 0;

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("integrationActivityLabel names Slack and code hosts", () => {
  assert.equal(integrationActivityLabel("slack"), "Pulling in Slack messages…");
  assert.equal(integrationActivityLabel("code-host", "gitlab"), "Searching GitLab estate index…");
});

test("isIntegrationActivityLabel detects tool lines only", () => {
  assert.equal(isIntegrationActivityLabel("Pulling in Slack messages…"), true);
  assert.equal(isIntegrationActivityLabel("Reviewing Jira tickets…"), true);
  assert.equal(isIntegrationActivityLabel("Weighing gathered evidence…"), false);
  assert.equal(isIntegrationActivityLabel("Scan complete — preparing answer…"), false);
});

test("query-form labels are not generic theater", () => {
  assert.equal(isGenericIntegrationStatusLabel("Searching Confluence pages…"), true);
  assert.equal(isGenericIntegrationStatusLabel("Searching Confluence for `plane`"), false);
  assert.equal(isGenericIntegrationStatusLabel("Searched Confluence for `plane`"), false);
  assert.deepEqual(
    stripGenericIntegrationStatus([
      "Building repository overview…",
      "Searching Confluence pages…",
      "Searched Slack for `on-call`"
    ]),
    ["Building repository overview…", "Searched Slack for `on-call`"]
  );
});

test("running and completed labels include the query", () => {
  assert.equal(
    integrationRunningActivityLabel("confluence", "plane"),
    "Searching Confluence for `plane`"
  );
  assert.equal(
    integrationCompletedActivityLabel("jira", "COOP-12"),
    "Searched Jira for `COOP-12`"
  );
  assert.equal(integrationCompletedActivityLabel("slack"), "Searched Slack");
});

test("preferredIntegrationActivityQuery prefers repo slug over owner/repo", () => {
  assert.equal(
    preferredIntegrationActivityQuery(["CoopAI-Corp/plane", "github:CoopAI-Corp/plane", "plane"]),
    "plane"
  );
  assert.equal(preferredIntegrationActivityQuery(["auth middleware", "plane"]), "auth middleware");
});

test("isActivityLabelForTool matches generic, running, and completed", () => {
  assert.equal(isActivityLabelForTool("Searching Confluence pages…", "confluence"), true);
  assert.equal(isActivityLabelForTool("Searching Confluence for `plane`", "confluence"), true);
  assert.equal(isActivityLabelForTool("Searched Confluence for `plane`", "confluence"), true);
  assert.equal(isActivityLabelForTool("Searched Slack for `on-call`", "confluence"), false);
});

test("query-form Google Docs is not generic theater", () => {
  assert.equal(isGenericIntegrationStatusLabel("Searching Google Docs…"), true);
  assert.equal(isGenericIntegrationStatusLabel("Searching Google Docs for `plane`"), false);
  assert.equal(isGenericIntegrationStatusLabel("Searched Google Docs for `plane`"), false);
});

console.log(`\n${passed} passed`);

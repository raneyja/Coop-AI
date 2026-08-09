import assert from "node:assert/strict";
import {
  integrationActivityLabel,
  isIntegrationActivityLabel
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

console.log(`\n${passed} passed`);

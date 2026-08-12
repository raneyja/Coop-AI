import assert from "node:assert/strict";
import test from "node:test";
import { mergeIntegrationCredentialsForTests } from "./integrationSecrets";

test("org cloud Slack token wins over a leftover local bot token", () => {
  const merged = mergeIntegrationCredentialsForTests(
    { slackToken: "xoxb-local-bot-leftover" },
    { slackToken: "xoxp-org-user-token" }
  );
  assert.equal(merged.slackToken, "xoxp-org-user-token");
});

test("local Slack token remains when cloud has no Slack credential", () => {
  const merged = mergeIntegrationCredentialsForTests(
    { slackToken: "xoxp-local-only" },
    { jiraToken: "atlassian-cloud" }
  );
  assert.equal(merged.slackToken, "xoxp-local-only");
  assert.equal(merged.jiraToken, "atlassian-cloud");
});

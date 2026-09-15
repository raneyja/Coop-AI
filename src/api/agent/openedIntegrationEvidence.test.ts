import assert from "node:assert/strict";
import { formatOpenedIntegrationEvidence } from "./openedIntegrationEvidence";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("Jira title-only hits are labeled body not attached", () => {
  const text = formatOpenedIntegrationEvidence({
    search_jira: {
      issues: [{ key: "COOP-101", summary: "Extract auth", status: "In Progress" }]
    }
  });
  assert.match(text ?? "", /COOP-101/);
  assert.match(text ?? "", /Body: not attached/);
  assert.match(text ?? "", /title and status are not a decision/);
});

test("Jira description is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_jira: {
      issues: [
        {
          key: "COOP-101",
          summary: "Extract auth",
          status: "In Progress",
          description: "Chose GitHub App over PAT for requireAuth."
        }
      ]
    },
    search_slack: { messages: [] }
  });
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.match(text ?? "", /Slack: no matching messages/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
});

test("empty context yields nothing", () => {
  assert.equal(formatOpenedIntegrationEvidence(undefined), undefined);
  assert.equal(formatOpenedIntegrationEvidence({}), undefined);
});

const total = passed + failed;
console.log(`\nopenedIntegrationEvidence: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

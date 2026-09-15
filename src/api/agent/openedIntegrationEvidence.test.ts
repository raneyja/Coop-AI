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

test("Notion excerpt is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_notion: {
      pages: [
        {
          id: "n1",
          title: "ADR: Auth",
          excerpt: "Chose GitHub App over PAT for requireAuth."
        }
      ]
    }
  });
  assert.match(text ?? "", /Notion/);
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
});

test("Google Docs excerpt is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_google_docs: {
      documents: [
        {
          id: "g1",
          title: "ADR: Auth",
          excerpt: "Chose GitHub App over PAT for requireAuth."
        }
      ]
    }
  });
  assert.match(text ?? "", /Google Docs/);
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
});

test("Notion title-only hits are labeled body not attached", () => {
  const text = formatOpenedIntegrationEvidence({
    search_notion: {
      pages: [{ id: "n1", title: "ADR: Auth" }]
    }
  });
  assert.match(text ?? "", /Body: not attached/);
});

test("Slack thread body is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_slack: {
      messages: [
        {
          channelName: "eng",
          userName: "alice",
          text: "Chose GitHub App over PAT for requireAuth.",
          threadOpened: true
        }
      ]
    }
  });
  assert.match(text ?? "", /search snippet is not a decision/);
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
});

test("Slack snippet-only hits are labeled body not attached", () => {
  const text = formatOpenedIntegrationEvidence({
    search_slack: {
      messages: [
        {
          channelName: "eng",
          userName: "alice",
          text: "short search snippet about auth"
        }
      ]
    }
  });
  assert.match(text ?? "", /Body: not attached/);
});

test("Teams thread body is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_teams: {
      messages: [
        {
          fromUserName: "bob",
          body: "Chose GitHub App over PAT for requireAuth.",
          threadOpened: true
        }
      ]
    }
  });
  assert.match(text ?? "", /Teams/);
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
});

const total = passed + failed;
console.log(`\nopenedIntegrationEvidence: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

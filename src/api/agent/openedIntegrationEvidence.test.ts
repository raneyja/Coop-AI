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
      issues: [{ key: "COOP-101", summary: "Extract auth", status: "In Progress", opened: true }]
    }
  });
  assert.match(text ?? "", /COOP-101/);
  assert.match(text ?? "", /Body: not attached/);
  assert.doesNotMatch(text ?? "", /title and status are not a decision/);
});

test("Jira Search snippet without Open is not Talk-track Body", () => {
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
  assert.doesNotMatch(text ?? "", /Body: Chose GitHub App/);
  assert.match(text ?? "", /Slack: no matching messages/);
});

test("Opened Jira description is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_jira: {
      issues: [
        {
          key: "COOP-101",
          summary: "Extract auth",
          status: "In Progress",
          opened: true,
          description: "Chose GitHub App over PAT for requireAuth."
        }
      ]
    },
    search_slack: { messages: [] }
  });
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.match(text ?? "", /Slack: no matching messages/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
  assert.doesNotMatch(text ?? "", /that is not a documented decision/i);
});

test("empty context yields nothing", () => {
  assert.equal(formatOpenedIntegrationEvidence(undefined), undefined);
  assert.equal(formatOpenedIntegrationEvidence({}), undefined);
});

test("Notion Search snippet without Open is not Talk-track Body", () => {
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
  assert.equal(text, undefined);
});

test("Opened Notion excerpt is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_notion: {
      pages: [
        {
          id: "n1",
          title: "ADR: Auth",
          excerpt: "Chose GitHub App over PAT for requireAuth.",
          opened: true
        }
      ]
    }
  });
  assert.match(text ?? "", /Notion/);
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
});

test("Google Docs Search snippet without Open is not Talk-track Body", () => {
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
  assert.equal(text, undefined);
});

test("Opened Google Docs excerpt is the Body line the writer must use", () => {
  const text = formatOpenedIntegrationEvidence({
    search_google_docs: {
      documents: [
        {
          id: "g1",
          title: "ADR: Auth",
          excerpt: "Chose GitHub App over PAT for requireAuth.",
          opened: true
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
      pages: [{ id: "n1", title: "ADR: Auth", opened: true }]
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
  assert.match(text ?? "", /Opened Slack threads/);
  assert.match(text ?? "", /Body: Chose GitHub App/);
  assert.doesNotMatch(text ?? "", /Body: not attached/);
});

test("Slack snippet-only hits are not treated as Opened", () => {
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
  assert.equal(text, undefined);
});

test("Confluence Search snippet without Open is not Talk-track Body", () => {
  const text = formatOpenedIntegrationEvidence({
    search_confluence: {
      pages: [
        {
          id: "1212417",
          title: "ADR: Backend service extraction (COOP-101)",
          excerpt: "Extract GitHub pagination and repo indexing into coop-backend."
        }
      ]
    }
  });
  assert.doesNotMatch(text ?? "", /Body: Extract GitHub pagination/);
});

test("I3 Slack empty plus opened ADR is still a documented decision", () => {
  const text = formatOpenedIntegrationEvidence({
    search_slack: { messages: [] },
    search_confluence: {
      pages: [
        {
          id: "1212417",
          title: "ADR: Backend service extraction (COOP-101)",
          excerpt: "Extract GitHub pagination and repo indexing into coop-backend.",
          opened: true
        }
      ]
    }
  });
  assert.match(text ?? "", /COOP-101/);
  assert.match(text ?? "", /ADR: Backend service extraction/);
  assert.match(text ?? "", /No mention in Slack/);
  assert.doesNotMatch(text ?? "", /that is not a documented decision/i);
  assert.doesNotMatch(text ?? "", /the title is not a decision/i);
});

test("unopened Search ranks are not dumped into the Talk track", () => {
  const text = formatOpenedIntegrationEvidence({
    search_notion: {
      pages: [
        { id: "p1", title: "Standup notes" },
        { id: "p2", title: "Retro" },
        { id: "p3", title: "Weekly" },
        {
          id: "p4",
          title: "Architecture Overview",
          excerpt: "Extract auth into coop-backend.",
          opened: true
        }
      ]
    }
  });
  assert.match(text ?? "", /Architecture Overview/);
  assert.match(text ?? "", /Extract auth into coop-backend/);
  assert.doesNotMatch(text ?? "", /Standup notes/);
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

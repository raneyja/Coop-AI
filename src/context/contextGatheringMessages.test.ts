import assert from "node:assert/strict";
import { contextGatheringMessagesFor } from "./contextGatheringMessages";
import { UserIntent, type IntentEvent } from "./intentDetector";

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

function event(partial: Partial<IntentEvent> & Pick<IntentEvent, "intent">): IntentEvent {
  return {
    id: "test",
    timestamp: new Date(),
    costEstimate: "expensive",
    context: {},
    ...partial
  };
}

test("understand-repo uses GitLab label when provider is gitlab", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: { buttonClicked: "understand-repo", owner: "acme", repo: "coop-ai" }
    }),
    {
      codeHostProvider: "gitlab",
      codeHostConnected: true,
      integrations: { jira: true, confluence: true }
    }
  );
  assert.equal(messages[0], "Searching GitLab estate index…");
});

test("understand-repo omits integrations that are not connected", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: { buttonClicked: "understand-repo", owner: "acme", repo: "coop-ai" }
    }),
    {
      codeHostProvider: "github",
      codeHostConnected: true,
      integrations: { jira: false, confluence: false }
    }
  );
  assert.ok(messages.includes("Searching GitHub estate index…"));
  assert.ok(!messages.includes("Reviewing Jira tickets…"));
  assert.ok(!messages.includes("Searching Confluence pages…"));
});

test("understand-repo skips code host estate line when code host is disconnected", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: { buttonClicked: "understand-repo", owner: "acme", repo: "coop-ai" }
    }),
    {
      codeHostProvider: "gitlab",
      codeHostConnected: false,
      integrations: { jira: true }
    }
  );
  assert.ok(!messages.some((message) => message.includes("GitLab estate index")));
  assert.ok(!messages.includes("Reviewing Jira tickets…"));
});

test("trace-decision uses provider-specific PR search label", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.QUICK_ACTION_CLICKED,
      context: { buttonClicked: "trace-decision", owner: "acme", repo: "coop-ai" }
    }),
    { codeHostProvider: "bitbucket", codeHostConnected: true }
  );
  assert.equal(messages[0], "Searching Bitbucket pull request history…");
});

test("plain chat includes code host and workspace lines", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: { owner: "acme", repo: "coop-ai", queryText: "how does auth work?" }
    }),
    {
      codeHostProvider: "github",
      codeHostConnected: true,
      integrations: { jira: false, slack: false }
    }
  );
  assert.equal(messages[0], "Searching GitHub estate index…");
  assert.ok(messages.includes("Gathering workspace context…"));
  assert.ok(!messages.includes("Preparing your answer…"));
});

test("plain chat omits code host line without a repo target", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: { queryText: "hello" }
    }),
    { codeHostProvider: "github", codeHostConnected: true }
  );
  assert.ok(!messages.some((message) => message.includes("estate index")));
  assert.ok(messages.includes("Gathering workspace context…"));
});

test("plain chat file ask seeds Read / rely-on / created todos", () => {
  const messages = contextGatheringMessagesFor(
    event({
      intent: UserIntent.MANUAL_CHAT_SUBMIT,
      context: {
        owner: "acme",
        repo: "coop-ai",
        file: "src/server/authMiddleware.ts",
        queryText:
          "Give me a tl;dr of this file? What does it do, what other files rely on it, and who created it / when?"
      }
    }),
    { codeHostProvider: "github", codeHostConnected: true }
  );
  assert.ok(messages.includes("Read `src/server/authMiddleware.ts`"));
  assert.ok(messages.includes("Find files that rely on `src/server/authMiddleware.ts`"));
  assert.ok(messages.includes("Look up who created `src/server/authMiddleware.ts`"));
  assert.ok(!messages.includes("Preparing your answer…"));
  assert.ok(!messages.some((message) => message.includes("estate index")));
});

const total = passed + failed;
console.log(`\n${passed}/${total} passed`);
process.exit(failed > 0 ? 1 : 0);

import assert from "node:assert/strict";
import { resolvePlainChatIntegrationProvider } from "./integrationProviderRouting";

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

const allConnected = () => true;

test("incident ask with Jira/Slack wording does not single-route to jira", () => {
  const ask =
    "Last week’s webhook delivery failures — what Jira tickets and Slack threads are related, which code paths handle retries/monitoring, and what’s still open?";
  assert.equal(
    resolvePlainChatIntegrationProvider({ message: ask, isConnected: allConnected }),
    undefined
  );
});

test("named jira in plain chat does not enter the /jira single-route", () => {
  assert.equal(
    resolvePlainChatIntegrationProvider({
      message: "can you look for any jira tickets that refer to this repo?",
      isConnected: allConnected
    }),
    undefined
  );
});

test("named disconnected jira still does not single-route", () => {
  assert.equal(
    resolvePlainChatIntegrationProvider({
      message: "any jira tickets for this?",
      isConnected: () => false
    }),
    undefined
  );
});

test("slack and notion named does not single-route", () => {
  assert.equal(
    resolvePlainChatIntegrationProvider({
      message: "cross-check mentions in slack and notion",
      isConnected: allConnected
    }),
    undefined
  );
});

test("named slack in plain chat does not enter the /slack pipeline", () => {
  assert.equal(
    resolvePlainChatIntegrationProvider({
      message: "What did Slack say about the SQL-injection PR?",
      isConnected: allConnected
    }),
    undefined
  );
});

const total = passed + failed;
console.log(`\nintegrationProviderRouting: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import {
  deliverableForQuickAction,
  shouldClearJobActivityOnChatComplete,
  shouldShowJobActivityLine,
  shouldShowViewResultsButton
} from "./jobActivityPolicy";

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

test("quick actions no longer map to chat-deliverable background jobs", () => {
  assert.equal(deliverableForQuickAction("knowledge-gaps"), "standalone");
  assert.equal(deliverableForQuickAction("blast-radius"), "standalone");
});

test("chat-deliverable jobs hide terminal scan complete row", () => {
  assert.equal(
    shouldShowJobActivityLine({ status: "completed", deliverable: "chat" }),
    false
  );
  assert.equal(
    shouldShowJobActivityLine({ status: "running", deliverable: "chat" }),
    true
  );
});

test("standalone deliverables may show terminal rows", () => {
  assert.equal(
    shouldShowJobActivityLine({ status: "completed", deliverable: "standalone" }),
    true
  );
});

test("view results is dev-only and never shown for chat deliverables", () => {
  assert.equal(
    shouldShowViewResultsButton({ status: "completed", deliverable: "chat", showViewResults: true }),
    false
  );
  assert.equal(
    shouldShowViewResultsButton({ status: "completed", deliverable: "standalone", showViewResults: true }),
    true
  );
  assert.equal(
    shouldShowViewResultsButton({ status: "completed", deliverable: "standalone", showViewResults: false }),
    false
  );
});

test("chat deliverables clear job strip when chat completes", () => {
  assert.equal(shouldClearJobActivityOnChatComplete("chat"), true);
  assert.equal(shouldClearJobActivityOnChatComplete("standalone"), false);
});

const total = passed + failed;
console.log(`\njobActivityPolicy: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

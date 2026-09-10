import assert from "node:assert/strict";
import {
  IntentDetector,
  UserIntent,
  requestTypesForIntent
} from "./intentDetector";

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

const detector = new IntentDetector();

test("plain chat caller ask requests dependencies with chat_context", () => {
  const event = detector.fromManualChatSubmit(
    {
      owner: "raneyja",
      repo: "Coop-AI",
      file: "src/config/responseDeadline.ts",
      provider: "github"
    },
    "What does this file do, and who calls it?"
  );
  assert.deepEqual(requestTypesForIntent(event), ["chat_context", "dependencies"]);
});

test("plain chat PR review requests dependencies and ownership", () => {
  const event = detector.fromManualChatSubmit(
    {
      owner: "raneyja",
      repo: "Coop-AI",
      file: "src/server/authMiddleware.ts",
      provider: "github"
    },
    "Review requireAuth as if this were a PR touching production auth. What would you block, what's fine, and what would you ask the author? Stay specific to this code."
  );
  assert.deepEqual(requestTypesForIntent(event), ["chat_context", "dependencies", "ownership"]);
});

test("plain chat file history ask requests blame with dependents", () => {
  const event = detector.fromManualChatSubmit(
    {
      owner: "raneyja",
      repo: "Coop-AI",
      file: "src/server/authMiddleware.ts",
      provider: "github"
    },
    "Give me a tl;dr of this file? What does it do, what other files rely on it, and who created it / when?"
  );
  assert.deepEqual(requestTypesForIntent(event), ["chat_context", "dependencies", "blame"]);
});

test("plain chat explain-only stays chat_context", () => {
  const event = detector.fromManualChatSubmit(
    {
      owner: "raneyja",
      repo: "Coop-AI",
      file: "src/config/responseDeadline.ts",
      provider: "github"
    },
    "What does this file do?"
  );
  assert.deepEqual(requestTypesForIntent(event), ["chat_context"]);
});

test("caller ask without open file does not request dependencies", () => {
  const event = detector.fromManualChatSubmit(
    { owner: "raneyja", repo: "Coop-AI", provider: "github" },
    "Who calls remainingContextGatherBudgetMs?"
  );
  assert.deepEqual(requestTypesForIntent(event), ["chat_context"]);
});

test("blast-radius still requests file_metadata + dependencies", () => {
  const event = detector.fromQuickAction(
    "blast-radius",
    {
      owner: "raneyja",
      repo: "Coop-AI",
      file: "src/config/responseDeadline.ts",
      provider: "github"
    },
    "What breaks if we change this?"
  );
  assert.deepEqual(requestTypesForIntent(event), ["file_metadata", "dependencies"]);
  assert.equal(event.intent, UserIntent.QUICK_ACTION_CLICKED);
});

console.log(`\nintentDetector requestTypes: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

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

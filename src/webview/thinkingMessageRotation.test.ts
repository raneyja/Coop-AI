import assert from "node:assert/strict";
import {
  appendThinkingProcessingTerms,
  buildProcessingTermMessages
} from "../context/thinkingProcessingTerms";
import {
  buildThinkingMessageSequence,
  hasVisibleAssistantResponse,
  pickRotatingThinkingMessage,
  shouldShowThinkingIndicator
} from "./thinkingMessageRotation";
import type { IntentFeedbackState, JobProgressState } from "./types";

let passed = 0;

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("buildProcessingTermMessages shuffles terms per seed", () => {
  const first = buildProcessingTermMessages("seed-a", 6);
  const second = buildProcessingTermMessages("seed-b", 6);
  assert.equal(first.length, 6);
  assert.equal(second.length, 6);
  assert.notDeepEqual(first, second);
  assert.ok(first.every((message) => /…$/.test(message)));
});

test("appendThinkingProcessingTerms preserves tool lines and adds varied verbs", () => {
  const enriched = appendThinkingProcessingTerms(
    ["Searching GitHub estate index…", "Reviewing Jira tickets…"],
    "seed-c",
    4
  );
  assert.ok(enriched.includes("Searching GitHub estate index…"));
  assert.ok(enriched.includes("Reviewing Jira tickets…"));
  assert.ok(enriched.length >= 6);
});

test("buildThinkingMessageSequence merges integrations, jobs, and processing terms", () => {
  const sequence = buildThinkingMessageSequence(
    {
      status: "loading",
      title: "Fetching context",
      activityMessages: [
        "Searching GitHub estate index…",
        "Pulling in Slack messages…",
        "Reviewing Jira tickets…"
      ]
    } satisfies IntentFeedbackState,
    {
      jobId: "job-1",
      status: "running",
      title: "Building dependency graph",
      message: "Graph ready — preparing answer…",
      progress: 80,
      deliverable: "chat"
    } satisfies JobProgressState
  );
  assert.ok(sequence.includes("Searching GitHub estate index…"));
  assert.ok(sequence.includes("Pulling in Slack messages…"));
  assert.ok(sequence.includes("Graph ready — preparing answer…"));
  assert.ok(sequence.length >= 7);
});

test("pickRotatingThinkingMessage cycles without repeating order immediately", () => {
  const sequence = ["A", "B", "C", "D"];
  assert.equal(pickRotatingThinkingMessage(sequence, 0), "A");
  assert.equal(pickRotatingThinkingMessage(sequence, 3), "D");
  assert.equal(pickRotatingThinkingMessage(sequence, 4), "A");
});

test("buildThinkingMessageSequence returns empty when idle", () => {
  assert.deepEqual(buildThinkingMessageSequence(undefined, undefined), []);
});

test("shouldShowThinkingIndicator hides once assistant text is visible", () => {
  assert.equal(
    shouldShowThinkingIndicator("Compiling sources…", [{ role: "assistant", content: "Hello" }], null),
    false
  );
  assert.equal(
    shouldShowThinkingIndicator("Compiling sources…", [], { content: "Streaming" }),
    false
  );
  assert.equal(
    shouldShowThinkingIndicator("Compiling sources…", [{ role: "user", content: "Hi" }], null),
    true
  );
});

test("hasVisibleAssistantResponse ignores empty assistant placeholders", () => {
  assert.equal(hasVisibleAssistantResponse([{ role: "assistant", content: "   " }], null), false);
});

console.log(`\n${passed} passed`);

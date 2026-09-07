import assert from "node:assert/strict";
import {
  appendThinkingProcessingTerms,
  buildProcessingTermMessages
} from "../context/thinkingProcessingTerms";
import { isThinkingProcessingTermMessage } from "../context/thinkingProcessingTerms";
import {
  ACTIVITY_PHASE_MS,
  ACTIVITY_START_DELAY_MS,
  buildConcreteActivityMessages,
  buildThinkingMessageSequence,
  hasVisibleAssistantResponse,
  isSynthesisActivityPhase,
  pickRotatingThinkingMessage,
  resolvePacedActivityIndex,
  shouldResetThinkingRotationStep,
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

test("appendThinkingProcessingTerms does not add Distilling filler", () => {
  const source = ["Searching GitHub estate index…", "Reviewing Jira tickets…"];
  assert.deepEqual(appendThinkingProcessingTerms(source, "seed-c", 4), source);
});

test("buildThinkingMessageSequence keeps only concrete gather/job lines", () => {
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
      message: "Building dependency graph…",
      progress: 40,
      deliverable: "chat"
    } satisfies JobProgressState
  );
  assert.deepEqual(sequence, [
    "Searching GitHub estate index…",
    "Pulling in Slack messages…",
    "Reviewing Jira tickets…",
    "Building dependency graph…"
  ]);
  assert.ok(!sequence.some((line) => /preparing answer|distilling|aggregating/i.test(line)));
});

test("buildThinkingMessageSequence stays empty while awaiting a model with no gather work", () => {
  assert.deepEqual(
    buildThinkingMessageSequence(undefined, undefined, { awaitingResponse: true }),
    []
  );
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

test("shouldResetThinkingRotationStep keeps step across prefix growth", () => {
  assert.equal(shouldResetThinkingRotationStep(["A", "B"], ["A", "B", "C"]), false);
  assert.equal(shouldResetThinkingRotationStep(["A", "B"], ["X", "B"]), true);
  assert.equal(shouldResetThinkingRotationStep([], ["A"]), true);
});

test("buildConcreteActivityMessages strips spinner filler verbs", () => {
  const concrete = buildConcreteActivityMessages(
    {
      status: "loading",
      title: "Scanning",
      activityMessages: [
        "Searching GitHub estate index…",
        "Scanning for knowledge gaps…",
        "Aggregating context…",
        "Synthesizing integrations…"
      ]
    } satisfies IntentFeedbackState,
    undefined
  );
  assert.deepEqual(concrete, [
    "Searching GitHub estate index…",
    "Scanning for knowledge gaps…"
  ]);
  assert.equal(isThinkingProcessingTermMessage("Aggregating context…"), true);
  assert.equal(isThinkingProcessingTermMessage("Scanning for knowledge gaps…"), false);
});

test("resolvePacedActivityIndex waits for start delay then advances one-by-one", () => {
  assert.equal(resolvePacedActivityIndex({ concreteCount: 3, elapsedMs: 0 }), -1);
  assert.equal(
    resolvePacedActivityIndex({ concreteCount: 3, elapsedMs: ACTIVITY_START_DELAY_MS - 1 }),
    -1
  );
  assert.equal(
    resolvePacedActivityIndex({ concreteCount: 3, elapsedMs: ACTIVITY_START_DELAY_MS }),
    0
  );
  assert.equal(
    resolvePacedActivityIndex({
      concreteCount: 3,
      elapsedMs: ACTIVITY_START_DELAY_MS + ACTIVITY_PHASE_MS
    }),
    1
  );
  assert.equal(
    resolvePacedActivityIndex({
      concreteCount: 3,
      elapsedMs: ACTIVITY_START_DELAY_MS + ACTIVITY_PHASE_MS * 2
    }),
    2
  );
  // High job progress must not skip the timed reveal.
  assert.equal(
    resolvePacedActivityIndex({
      concreteCount: 3,
      progress: 95,
      elapsedMs: ACTIVITY_START_DELAY_MS
    }),
    0
  );
});

test("isSynthesisActivityPhase does not start immediately for a single prep step", () => {
  assert.equal(
    isSynthesisActivityPhase({
      awaitingResponse: true,
      prepCount: 1,
      elapsedMs: ACTIVITY_START_DELAY_MS
    }),
    false
  );
  assert.equal(
    isSynthesisActivityPhase({
      awaitingResponse: true,
      prepCount: 1,
      elapsedMs: ACTIVITY_START_DELAY_MS + ACTIVITY_PHASE_MS
    }),
    true
  );
});

test("buildConcreteActivityMessages drops terminal preparing lines", () => {
  const concrete = buildConcreteActivityMessages(
    {
      status: "loading",
      title: "Scanning",
      activityMessages: [
        "Pulling in Slack messages…",
        "Searching Confluence pages…",
        "Scan complete — preparing answer…"
      ]
    } satisfies IntentFeedbackState,
    {
      jobId: "j1",
      status: "running",
      title: "Scanning",
      message: "Scan complete — preparing answer…",
      progress: 80,
      deliverable: "chat"
    } satisfies JobProgressState
  );
  assert.deepEqual(concrete, [
    "Pulling in Slack messages…",
    "Searching Confluence pages…"
  ]);
});

console.log(`\n${passed} passed`);

import assert from "node:assert/strict";
import {
  resolveChatInlineThinkingMessage,
  shouldSuppressActivityStripLoading
} from "./chatInlineThinking";
import type { IntentFeedbackState, JobProgressState } from "./types";

let passed = 0;

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const baseJob: JobProgressState = {
  jobId: "job-1",
  status: "running",
  title: "Building dependency graph",
  progress: 50,
  deliverable: "chat"
};

test("resolveChatInlineThinkingMessage prefers chat job progress", () => {
  const message = resolveChatInlineThinkingMessage(
    {
      status: "loading",
      title: "Fetching context",
      message: "Reading files…"
    } satisfies IntentFeedbackState,
    { ...baseJob, message: "Graph ready — preparing answer…" }
  );
  assert.equal(message, "Graph ready — preparing answer…");
});

test("resolveChatInlineThinkingMessage falls back to intent loading", () => {
  const message = resolveChatInlineThinkingMessage(
    {
      status: "loading",
      title: "Fetching context",
      message: "Reading GitHub history…"
    } satisfies IntentFeedbackState,
    undefined
  );
  assert.equal(message, "Reading GitHub history…");
});

test("resolveChatInlineThinkingMessage includes standalone active jobs", () => {
  const message = resolveChatInlineThinkingMessage(undefined, {
    ...baseJob,
    deliverable: "standalone",
    status: "queued",
    message: "Generating repository summary…"
  });
  assert.equal(message, "Generating repository summary…");
});

test("resolveChatInlineThinkingMessage includes in-progress warning scans", () => {
  const message = resolveChatInlineThinkingMessage(
    {
      status: "warning",
      title: "Scanning for knowledge gaps",
      message: "This may take longer on large repositories.",
      progress: 15
    } satisfies IntentFeedbackState,
    undefined
  );
  assert.equal(message, "This may take longer on large repositories.");
});

test("resolveChatInlineThinkingMessage uses awaitingResponse fallback", () => {
  const message = resolveChatInlineThinkingMessage(undefined, undefined, {
    awaitingResponse: true
  });
  assert.equal(message, "Preparing answer…");
});

test("shouldSuppressActivityStripLoading hides chat job and intent rows in thread mode", () => {
  const suppressed = shouldSuppressActivityStripLoading(
    true,
    { status: "loading", title: "Loading" } satisfies IntentFeedbackState,
    { ...baseJob, message: "Building dependency graph…" }
  );
  assert.deepEqual(suppressed, { intent: true, job: true });
});

test("shouldSuppressActivityStripLoading hides deep-scan fallback job rows", () => {
  const suppressed = shouldSuppressActivityStripLoading(true, undefined, {
    ...baseJob,
    jobId: "unknown",
    status: "running",
    message: "Graph ready — preparing answer…"
  });
  assert.deepEqual(suppressed, { intent: false, job: true });
});

test("shouldSuppressActivityStripLoading hides standalone active jobs in thread mode", () => {
  const suppressed = shouldSuppressActivityStripLoading(
    true,
    undefined,
    {
      ...baseJob,
      deliverable: "standalone",
      status: "running",
      message: "Generating repository summary…"
    }
  );
  assert.deepEqual(suppressed, { intent: false, job: true });
});

test("shouldSuppressActivityStripLoading keeps standalone terminal jobs in strip", () => {
  const suppressed = shouldSuppressActivityStripLoading(
    true,
    undefined,
    {
      ...baseJob,
      deliverable: "standalone",
      status: "completed",
      message: "Scan finished"
    }
  );
  assert.deepEqual(suppressed, { intent: false, job: false });
});

console.log(`\n${passed} passed`);

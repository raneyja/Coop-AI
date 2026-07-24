import assert from "node:assert/strict";
import { ThreadRunManager, SESSION_RUN_THREAD_ID } from "./chatTurn";
import {
  isResponseDeadlineAbort,
  RESPONSE_DEADLINE_REASON,
  scheduleResponseDeadline
} from "../config/responseDeadline";

function beginTurn(manager: ThreadRunManager, threadId: string, modelMessage = "hi") {
  return manager.begin({
    threadId,
    context: { owner: "acme", repo: "app" },
    history: [{ role: "user", content: modelMessage, timestamp: Date.now() }],
    artifacts: [],
    sessionCostUsd: 0,
    modelMessage
  });
}

function testAbortOnSameThreadOnly(): void {
  const manager = new ThreadRunManager();
  const turnA = beginTurn(manager, "thread-a", "first");
  const turnB = beginTurn(manager, "thread-b", "second");

  assert.equal(manager.isStreamActive(turnA), true);
  assert.equal(manager.isStreamActive(turnB), true);

  manager.abort("thread-b");
  assert.equal(manager.isStreamActive(turnA), true, "aborting B must not cancel A");
  assert.equal(manager.isStreamActive(turnB), false);
  assert.deepEqual(manager.runningThreadIds(), ["thread-a"]);
}

function testResendAbortsPriorTurnOnSameThread(): void {
  const manager = new ThreadRunManager();
  const first = beginTurn(manager, "thread-a", "one");
  const second = beginTurn(manager, "thread-a", "two");

  assert.equal(manager.isStreamActive(first), false);
  assert.equal(manager.isStreamActive(second), true);
  assert.ok(first.streamAbort.signal.aborted);
}

function testPartialBufferSurvivesForResume(): void {
  const manager = new ThreadRunManager();
  const turn = beginTurn(manager, "thread-a");
  manager.appendPartial(turn, "Hello ");
  manager.appendPartial(turn, "world");
  assert.equal(manager.get("thread-a")?.partialAssistant, "Hello world");
}

function testCompleteRemovesRun(): void {
  const manager = new ThreadRunManager();
  const turn = beginTurn(manager, SESSION_RUN_THREAD_ID);
  manager.complete(turn);
  assert.equal(manager.isRunning(SESSION_RUN_THREAD_ID), false);
  assert.equal(manager.isStreamActive(turn), false);
}

function testAppendIgnoredAfterAbort(): void {
  const manager = new ThreadRunManager();
  const turn = beginTurn(manager, "thread-a");
  manager.abort("thread-a");
  manager.appendPartial(turn, "late");
  assert.equal(turn.partialAssistant, "");
}

async function testBeginSchedulesResponseDeadline(): Promise<void> {
  const manager = new ThreadRunManager();
  const turn = beginTurn(manager, "thread-deadline");
  assert.equal(typeof turn.clearResponseDeadline, "function");

  // Replace the long 15s timer with a short one so the test stays fast.
  turn.clearResponseDeadline();
  turn.clearResponseDeadline = scheduleResponseDeadline(turn.streamAbort, Date.now(), 20);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(turn.streamAbort.signal.aborted, true);
  assert.equal(isResponseDeadlineAbort(turn.streamAbort.signal), true);
  assert.equal(
    (turn.streamAbort.signal as AbortSignal & { reason?: unknown }).reason,
    RESPONSE_DEADLINE_REASON
  );
  // Deadline aborts the signal only — turn stays running until session finishes it.
  assert.equal(manager.isStreamActive(turn), true);
  turn.clearResponseDeadline();
  manager.complete(turn);
}

testAbortOnSameThreadOnly();
testResendAbortsPriorTurnOnSameThread();
testPartialBufferSurvivesForResume();
testCompleteRemovesRun();
testAppendIgnoredAfterAbort();
void testBeginSchedulesResponseDeadline()
  .then(() => {
    console.log("chatTurn.test.ts: ok");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

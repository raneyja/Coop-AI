import assert from "node:assert/strict";
import { ThreadRunManager, SESSION_RUN_THREAD_ID } from "./chatTurn";
import { emptyChatIntentPlan, type ChatIntentPlan } from "./intentPlanner/types";

function beginTurn(
  manager: ThreadRunManager,
  threadId: string,
  modelMessage = "hi",
  intentPlan: ChatIntentPlan = emptyChatIntentPlan(modelMessage)
) {
  return manager.begin({
    threadId,
    context: { owner: "acme", repo: "app" },
    history: [{ role: "user", content: modelMessage, timestamp: Date.now() }],
    artifacts: [],
    sessionCostUsd: 0,
    modelMessage,
    intentPlan
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

function testSequentialTurnsKeepIntentPlansIsolated(): void {
  const manager = new ThreadRunManager();
  const sourcePlan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["jira", "slack"],
    jobs: [{ capability: "decision", terms: ["auth rollback"] }],
    confidence: "high",
    focus: "auth rollback",
    execution: "none"
  };
  const compound = beginTurn(manager, "thread-a", "compound", sourcePlan);
  const slash = beginTurn(manager, "thread-a", "/jira COOP-53");
  const otherThread = beginTurn(manager, "thread-b", "where is auth implemented?");

  sourcePlan.jobs?.[0]?.terms.push("late mutation");

  assert.deepEqual(compound.intentPlan.jobs?.[0]?.terms, ["auth rollback"]);
  assert.deepEqual(slash.intentPlan.jobs, []);
  assert.deepEqual(otherThread.intentPlan.jobs, []);
  assert.notEqual(slash.intentPlan, compound.intentPlan);
}

async function testBeginDoesNotHardAbortOnLatencyGuideline(): Promise<void> {
  const manager = new ThreadRunManager();
  const turn = beginTurn(manager, "thread-deadline");
  assert.equal(typeof turn.clearResponseDeadline, "function");

  // Soft gather guideline must never abort the turn signal — only user Stop does.
  turn.clearResponseDeadline();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(turn.streamAbort.signal.aborted, false);
  assert.equal(manager.isStreamActive(turn), true);
  manager.complete(turn);
}

testAbortOnSameThreadOnly();
testResendAbortsPriorTurnOnSameThread();
testPartialBufferSurvivesForResume();
testCompleteRemovesRun();
testAppendIgnoredAfterAbort();
testSequentialTurnsKeepIntentPlansIsolated();
void testBeginDoesNotHardAbortOnLatencyGuideline()
  .then(() => {
    console.log("chatTurn.test.ts: ok");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

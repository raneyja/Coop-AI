import assert from "node:assert/strict";
import type { ChatMessage } from "./types";
import { buildModelHistory } from "./buildModelHistory";

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

function user(content: string, modelContent?: string): ChatMessage {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
    ...(modelContent ? { modelContent } : {})
  };
}

function assistant(content: string): ChatMessage {
  return { role: "assistant", content, timestamp: Date.now() };
}

test("buildModelHistory returns empty array for single current user turn", () => {
  assert.deepEqual(buildModelHistory([user("hello")]), []);
});

test("buildModelHistory excludes current turn and maps prior user modelContent", () => {
  const history = [
    user("bubble one", "model payload one"),
    assistant("reply one"),
    user("bubble two", "model payload two")
  ];
  const prior = buildModelHistory(history);
  assert.equal(prior.length, 2);
  assert.equal(prior[0].content, "model payload one");
  assert.equal(prior[1].content, "reply one");
});

test("buildModelHistory falls back to bubble content when modelContent is absent", () => {
  const history = [user("plain bubble"), assistant("ok"), user("current")];
  const prior = buildModelHistory(history);
  assert.equal(prior[0].content, "plain bubble");
});

test("buildModelHistory preserves assistant content unchanged", () => {
  const history = [user("q", "model q"), assistant("answer with **markdown**"), user("follow-up")];
  const prior = buildModelHistory(history);
  assert.equal(prior[1].role, "assistant");
  assert.equal(prior[1].content, "answer with **markdown**");
});

test("buildModelHistory strips persisted activity from model replay", () => {
  const withTrail = assistant("In auth.ts");
  withTrail.activity = {
    durationMs: 4000,
    thinkingText: "do not send this to the model",
    tools: [],
    files: []
  };
  const history = [user("q"), withTrail, user("follow-up")];
  const prior = buildModelHistory(history);
  assert.equal(prior[1].content, "In auth.ts");
  assert.equal(prior[1].activity, undefined);
});

test("stopped broad edits and partial proposals remain visible but cannot instruct the next rename", () => {
  const stoppedAsk = { ...user("change return type and every caller"), cancelled: true };
  const stoppedReply = { ...assistant("partial structured-token proposal"), cancelled: true };
  const history = [user("explain parser"), assistant("returns string"), stoppedAsk, stoppedReply, user("rename header only")];
  assert.deepEqual(buildModelHistory(history).map((entry) => entry.content), ["explain parser", "returns string"]);
  assert.equal(history[2].content, "change return type and every caller", "display evidence is retained");
});

test("buildModelHistory handles empty history", () => {
  assert.deepEqual(buildModelHistory([]), []);
});

test("rejected proposals cannot supply stale source to a later edit", () => {
  const proposal = {...assistant("structured return type patch"), patchCard: {
    status: "rejected" as const, fileCount: 1, hunkCount: 1, files: []
  }};
  const history = [user("rewrite return type"), proposal, user("rename header only")];
  const prior = buildModelHistory(history);
  assert.equal(prior[1].content, "The preceding edit proposal was rejected and was not applied.");
  assert.equal(prior[1].patchCard, undefined);
  assert.equal(proposal.content, "structured return type patch", "visible rejection evidence is retained");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

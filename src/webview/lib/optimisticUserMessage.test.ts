import assert from "node:assert/strict";
import {
  buildOptimisticUserMessage,
  mergeChatHistoryWithOptimistic
} from "./optimisticUserMessage";

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

test("buildOptimisticUserMessage stamps chips from Use-repo", () => {
  const turn = buildOptimisticUserMessage({
    message: "Where is login?",
    context: { owner: "acme", repo: "api", branch: "main", scope: "repo" },
    baselineCount: 0,
    timestamp: 42
  });
  assert.equal(turn.message.role, "user");
  assert.match(turn.message.content, /^Where is login\?/);
  assert.match(turn.message.content, /repo: acme\/api/);
  assert.equal(turn.message.timestamp, 42);
});

test("buildOptimisticUserMessage prefers historyContent for evidence quick actions", () => {
  const turn = buildOptimisticUserMessage({
    message: "",
    historyContent: "/blast src/auth.ts",
    quickAction: "blast-radius",
    baselineCount: 2,
    timestamp: 1
  });
  assert.equal(turn.message.content, "/blast src/auth.ts");
});

test("stale history snapshot keeps the optimistic bubble", () => {
  const optimistic = buildOptimisticUserMessage({
    message: "hello",
    baselineCount: 1,
    timestamp: 9
  });
  const merged = mergeChatHistoryWithOptimistic(
    [{ role: "assistant", content: "prior" }],
    optimistic
  );
  assert.equal(merged.settled, false);
  assert.equal(merged.messages.length, 2);
  assert.equal(merged.messages[1]?.role, "user");
});

test("host history with the new user turn replaces the optimistic bubble", () => {
  const optimistic = buildOptimisticUserMessage({
    message: "hello",
    context: { owner: "acme", repo: "api", scope: "repo" },
    baselineCount: 0,
    timestamp: 9
  });
  const incoming = [
    { role: "user", content: "hello\nrepo: acme/api · branch: main" }
  ];
  const merged = mergeChatHistoryWithOptimistic(incoming, optimistic);
  assert.equal(merged.settled, true);
  assert.equal(merged.messages, incoming);
  assert.equal(merged.messages.length, 1);
});

test("empty incoming history (new chat) drops the optimistic bubble", () => {
  const optimistic = buildOptimisticUserMessage({
    message: "hello",
    baselineCount: 0,
    timestamp: 9
  });
  const merged = mergeChatHistoryWithOptimistic([], optimistic);
  assert.equal(merged.settled, true);
  assert.equal(merged.messages.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

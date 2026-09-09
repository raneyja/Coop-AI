import assert from "node:assert/strict";
import {
  dequeueFollowUp,
  enqueueFollowUp,
  MAX_QUEUED_FOLLOW_UPS,
  previewQueuedFollowUp,
  removeFollowUp,
  resolveFollowUpSubmitAction,
  shouldAutoFlushFollowUpQueue,
  type QueuedFollowUp
} from "./chatFollowUpQueue";

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

function item(text: string, id?: string): Omit<QueuedFollowUp, "id"> & { id?: string } {
  return { id, text, attachments: [], mentions: [] };
}

test("Enter while idle sends immediately", () => {
  assert.equal(
    resolveFollowUpSubmitAction({ isStreaming: false, canSend: true, modifierSend: false }),
    "send"
  );
});

test("Enter while streaming queues instead of sending", () => {
  assert.equal(
    resolveFollowUpSubmitAction({ isStreaming: true, canSend: true, modifierSend: false }),
    "queue"
  );
});

test("Cmd/Ctrl+Enter while streaming stops and sends", () => {
  assert.equal(
    resolveFollowUpSubmitAction({ isStreaming: true, canSend: true, modifierSend: true }),
    "stop-and-send"
  );
});

test("empty composer does not queue or send", () => {
  assert.equal(
    resolveFollowUpSubmitAction({ isStreaming: true, canSend: false, modifierSend: false }),
    "ignore"
  );
  assert.equal(
    resolveFollowUpSubmitAction({ isStreaming: false, canSend: false, modifierSend: true }),
    "ignore"
  );
});

test("enqueue appends until the cap, then rejects", () => {
  let queue: QueuedFollowUp[] = [];
  for (let i = 0; i < MAX_QUEUED_FOLLOW_UPS; i += 1) {
    const result = enqueueFollowUp(queue, item(`n${i}`, `id-${i}`));
    assert.equal(result.enqueued, true);
    queue = result.queue;
  }
  const rejected = enqueueFollowUp(queue, item("overflow", "id-x"));
  assert.equal(rejected.enqueued, false);
  assert.equal(rejected.queue.length, MAX_QUEUED_FOLLOW_UPS);
  assert.deepEqual(
    rejected.queue.map((entry) => entry.text),
    ["n0", "n1", "n2"]
  );
});

test("stop-and-send prepends so the interrupt runs first", () => {
  const first = enqueueFollowUp([], item("later", "a"));
  const result = enqueueFollowUp(first.queue, item("now", "b"), { front: true });
  assert.deepEqual(
    result.queue.map((entry) => entry.text),
    ["now", "later"]
  );
});

test("remove and dequeue keep FIFO order", () => {
  let queue = enqueueFollowUp([], item("one", "a")).queue;
  queue = enqueueFollowUp(queue, item("two", "b")).queue;
  queue = enqueueFollowUp(queue, item("three", "c")).queue;
  queue = removeFollowUp(queue, "b");
  const { next, rest } = dequeueFollowUp(queue);
  assert.equal(next?.text, "one");
  assert.deepEqual(
    rest.map((entry) => entry.text),
    ["three"]
  );
});

test("preview prefers the first line of text", () => {
  assert.equal(previewQueuedFollowUp({ id: "1", text: "Hello\nworld", attachments: [], mentions: [] }), "Hello");
  assert.equal(
    previewQueuedFollowUp({
      id: "2",
      text: "",
      attachments: [{ id: "f", name: "notes.md", mimeType: "text/markdown", dataUrl: "data:," }],
      mentions: []
    }),
    "notes.md"
  );
});

test("auto-flush after a finished answer, not after stop, quota, or thread switch", () => {
  assert.equal(shouldAutoFlushFollowUpQueue({ reason: "complete", queueLength: 1 }), true);
  assert.equal(shouldAutoFlushFollowUpQueue({ reason: "error", queueLength: 1 }), true);
  assert.equal(shouldAutoFlushFollowUpQueue({ reason: "cancelled", queueLength: 1 }), false);
  assert.equal(shouldAutoFlushFollowUpQueue({ reason: "quota", queueLength: 1 }), false);
  assert.equal(shouldAutoFlushFollowUpQueue({ reason: "thread-changed", queueLength: 1 }), false);
  assert.equal(shouldAutoFlushFollowUpQueue({ reason: "complete", queueLength: 0 }), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

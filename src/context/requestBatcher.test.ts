import assert from "node:assert/strict";
import { RequestBatcher, type ContextFetchRequest, type ContextFetchResult } from "./requestBatcher";
import { UserIntent } from "./intentDetector";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function makeRequest(
  id: string,
  intent: UserIntent,
  cost: "free" | "cheap" | "expensive" = "cheap"
): ContextFetchRequest {
  return {
    id,
    type: "file_metadata",
    params: {},
    intent: {
      id: `intent-${id}`,
      intent,
      context: {},
      timestamp: new Date(),
      costEstimate: cost
    },
    cost,
    createdAt: new Date()
  };
}

function makeResult(id: string): ContextFetchResult {
  return { requestId: id, type: "file_metadata", data: {}, fetchedAt: new Date() };
}

void (async () => {
  await test(
    "quick-action click bypasses the batching window even when cost is cheap (find-owner/trace-decision hot path)",
    async () => {
      let executedAt: number | undefined;
      const started = Date.now();
      const batcher = new RequestBatcher(async (requests) => {
        executedAt = Date.now();
        return requests.map((request) => makeResult(request.id));
      }, { config: { enabled: true, window: 500, maxRequests: 5, executionStrategy: "parallel" } });

      const request = makeRequest("q1", UserIntent.QUICK_ACTION_CLICKED, "cheap");
      const result = await batcher.enqueue(request);

      assert.equal(result.requestId, "q1");
      assert.ok(executedAt !== undefined, "batch executor should have run");
      assert.ok(
        (executedAt as number) - started < 100,
        `expected near-immediate execution, took ${(executedAt as number) - started}ms`
      );
    }
  );

  await test("manual chat submit bypasses the batching window", async () => {
    let executedAt: number | undefined;
    const started = Date.now();
    const batcher = new RequestBatcher(async (requests) => {
      executedAt = Date.now();
      return requests.map((request) => makeResult(request.id));
    }, { config: { enabled: true, window: 500, maxRequests: 5, executionStrategy: "parallel" } });

    await batcher.enqueue(makeRequest("m1", UserIntent.MANUAL_CHAT_SUBMIT, "expensive"));
    assert.ok((executedAt as number) - started < 100);
  });

  await test("ambient selection-change requests still coalesce within the batching window", async () => {
    const batcher = new RequestBatcher(async (requests) => requests.map((request) => makeResult(request.id)), {
      config: { enabled: true, window: 30, maxRequests: 5, executionStrategy: "parallel" }
    });

    const started = Date.now();
    const result = await batcher.enqueue(makeRequest("s1", UserIntent.SELECTION_CHANGE, "cheap"));
    const elapsed = Date.now() - started;

    assert.equal(result.requestId, "s1");
    assert.ok(elapsed >= 25, `expected ambient request to wait for the batch window, took ${elapsed}ms`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})();

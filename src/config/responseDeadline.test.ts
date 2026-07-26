import assert from "node:assert/strict";
import {
  MAX_USER_FACING_RESPONSE_MS,
  RESERVED_SYNTHESIS_MS,
  abortablePromise,
  remainingContextGatherBudgetMs,
  remainingResponseBudgetMs,
  waitForOptionalContext
} from "./responseDeadline";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function main(): Promise<void> {
  await test("remainingResponseBudgetMs clamps at zero", () => {
    assert.equal(remainingResponseBudgetMs(Date.now() - 20_000), 0);
    assert.ok(remainingResponseBudgetMs(Date.now()) <= MAX_USER_FACING_RESPONSE_MS);
  });

  await test("remainingContextGatherBudgetMs reserves synthesis time", () => {
    const started = Date.now();
    const gather = remainingContextGatherBudgetMs(started, started);
    assert.equal(gather, MAX_USER_FACING_RESPONSE_MS - RESERVED_SYNTHESIS_MS);
  });

  await test("abortablePromise rejects when signal aborts", async () => {
    const controller = new AbortController();
    const pending = abortablePromise(new Promise<string>(() => undefined), controller.signal);
    controller.abort();
    await assert.rejects(pending, (err: unknown) => err instanceof Error && err.name === "AbortError");
  });

  await test("abortablePromise resolves when work finishes first", async () => {
    const controller = new AbortController();
    const value = await abortablePromise(Promise.resolve("ok"), controller.signal);
    assert.equal(value, "ok");
    assert.equal(controller.signal.aborted, false);
  });

  await test("optional context stops blocking without cancelling its work", async () => {
    let finished = false;
    const work = new Promise<string>((resolve) => {
      setTimeout(() => {
        finished = true;
        resolve("late context");
      }, 30);
    });
    const value = await waitForOptionalContext(work, 5);
    assert.equal(value, undefined);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(finished, true);
  });

  console.log(`\nresponseDeadline: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

import assert from "node:assert/strict";
import {
  MAX_USER_FACING_RESPONSE_MS,
  RESPONSE_DEADLINE_REASON,
  RESERVED_SYNTHESIS_MS,
  abortablePromise,
  isResponseDeadlineAbort,
  remainingContextGatherBudgetMs,
  remainingResponseBudgetMs,
  scheduleResponseDeadline
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

  await test("scheduleResponseDeadline never aborts the turn signal", async () => {
    const controller = new AbortController();
    const clear = scheduleResponseDeadline(controller, Date.now(), 20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    clear();
    assert.equal(controller.signal.aborted, false);
    assert.equal(isResponseDeadlineAbort(controller.signal), false);
  });

  await test("abortablePromise rejects when signal aborts (user Stop)", async () => {
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

  await test("isResponseDeadlineAbort detects legacy reason only", () => {
    const controller = new AbortController();
    controller.abort(RESPONSE_DEADLINE_REASON);
    assert.equal(isResponseDeadlineAbort(controller.signal), true);
  });

  console.log(`\nresponseDeadline: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

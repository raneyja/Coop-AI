import assert from "node:assert/strict";
import { shouldEnableSynthesisThinking } from "./chatSynthesisThinking";
import {
  MAX_USER_FACING_RESPONSE_MS,
  RESPONSE_DEADLINE_REASON,
  RESERVED_SYNTHESIS_MS,
  SOFT_GATHER_BUDGET_EXHAUSTED_INTERNAL,
  abortablePromise,
  isResponseDeadlineAbort,
  isSoftGatherLatencyMessage,
  remainingContextGatherBudgetMs,
  remainingResponseBudgetMs,
  scheduleResponseDeadline,
  LOCATE_PREFETCH_MIN_MS,
  locateSearchBudgetMs
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
  await test("complete named source result asks stream without a separate thinking phase", () => {
    const sourceFacts = {
      userFocus: "Explain positiveSum in src/mathRenamed.ts. Give the exact results for [], [5], and [1,2,3] from the implementation and cite source lines.",
      entryFiles: [{ path: "src/mathRenamed.ts", content: "export function positiveSum(xs: number[]) { return xs.slice(1).reduce((a,b)=>a+b,0); }" }]
    };
    const options = { quickAction: "understand-repo", startedAt: 1000, now: 7780, sourceFacts };
    assert.equal(shouldEnableSynthesisThinking(options), false);
    assert.equal(shouldEnableSynthesisThinking({ ...options, sourceFacts: { ...sourceFacts, entryFiles: [
      ...sourceFacts.entryFiles,
      { path: "README.md", content: "Repository documentation", truncated: true },
      { path: "src/caller.ts", content: "positiveSum(values);" }
    ] } }), false);
    const twoFiles = { ...sourceFacts, userFocus: `${sourceFacts.userFocus} Also give return values from src/second.ts.` };
    assert.equal(shouldEnableSynthesisThinking({ ...options, sourceFacts: twoFiles }), true);
    assert.equal(shouldEnableSynthesisThinking({ ...options, sourceFacts: { ...twoFiles, entryFiles: [
      ...sourceFacts.entryFiles, { path: "src/second.ts", content: "export function second() { return 2; }" }
    ] } }), false);
    assert.equal(shouldEnableSynthesisThinking({ ...options, sourceFacts: { ...twoFiles,
      userFocus: `${twoFiles.userFocus} And src/third.ts.`
    } }), true);
    for (const entryFiles of [[], [{ ...sourceFacts.entryFiles[0], truncated: true }], [{ ...sourceFacts.entryFiles[0], content: "" }], [{ ...sourceFacts.entryFiles[0], path: "src/unrelated.ts" }]]) {
      assert.equal(shouldEnableSynthesisThinking({ ...options, sourceFacts: { ...sourceFacts, entryFiles } }), true);
    }
    for (const userFocus of ["Explain the architecture and tradeoffs in src/mathRenamed.ts with exact results.", "Explain src/mathRenamed.ts and all its edge cases."]) {
      assert.equal(shouldEnableSynthesisThinking({ ...options, sourceFacts: { ...sourceFacts, userFocus } }), true);
    }
    assert.equal(shouldEnableSynthesisThinking({ ...options, quickAction: "edit" }), true);
  });
  await test("gathered read-only synthesis skips another thinking phase at the gather boundary", () => {
    const startedAt = 1000;
    const boundary = startedAt + MAX_USER_FACING_RESPONSE_MS - RESERVED_SYNTHESIS_MS;
    for (const quickAction of ["knowledge-gaps", "understand-repo"]) {
      assert.equal(shouldEnableSynthesisThinking({ quickAction, startedAt, now: boundary - 1 }), true);
      assert.equal(shouldEnableSynthesisThinking({ quickAction, startedAt, now: boundary }), false);
      assert.equal(shouldEnableSynthesisThinking({ quickAction, startedAt, now: startedAt + 60000 }), false);
    }
  });
  await test("complex chat, edit, and other quick actions retain reasoning after the soft budget", () => {
    for (const quickAction of [undefined, "edit", "blast-radius", "compare", "trace", "owner"]) {
      assert.equal(shouldEnableSynthesisThinking({ quickAction, startedAt: 1000, now: 61000 }), true);
    }
  });
  await test("remainingResponseBudgetMs clamps at zero", () => {
    assert.equal(remainingResponseBudgetMs(Date.now() - 20_000), 0);
    assert.ok(remainingResponseBudgetMs(Date.now()) <= MAX_USER_FACING_RESPONSE_MS);
  });

  await test("remainingContextGatherBudgetMs reserves synthesis time", () => {
    const started = Date.now();
    const gather = remainingContextGatherBudgetMs(started, started);
    assert.equal(gather, MAX_USER_FACING_RESPONSE_MS - RESERVED_SYNTHESIS_MS);
  });

  await test("locateSearchBudgetMs does not skip locate when gather leftover is zero", () => {
    assert.equal(locateSearchBudgetMs(0), LOCATE_PREFETCH_MIN_MS);
    assert.equal(locateSearchBudgetMs(-5), LOCATE_PREFETCH_MIN_MS);
    assert.equal(locateSearchBudgetMs(1_000), LOCATE_PREFETCH_MIN_MS);
    assert.equal(locateSearchBudgetMs(9_000), 9_000);
  });

  await test("scheduleResponseDeadline never aborts the turn signal", async () => {
    const controller = new AbortController();
    const clear = scheduleResponseDeadline(controller, Date.now(), 20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    clear();
    assert.equal(controller.signal.aborted, false);
    assert.equal(isResponseDeadlineAbort(controller.signal), false);
  });

  await test("soft gather hitting zero does not abort a stream AbortSignal", () => {
    const started = Date.now() - MAX_USER_FACING_RESPONSE_MS - 1_000;
    assert.equal(remainingContextGatherBudgetMs(started), 0);
    const controller = new AbortController();
    scheduleResponseDeadline(controller, started);
    assert.equal(controller.signal.aborted, false);
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

  await test("isSoftGatherLatencyMessage detects internal latency copy", () => {
    assert.equal(isSoftGatherLatencyMessage(SOFT_GATHER_BUDGET_EXHAUSTED_INTERNAL), true);
    assert.equal(
      isSoftGatherLatencyMessage("Soft gather budget exhausted — synthesizing with partial blast evidence."),
      true
    );
    assert.equal(isSoftGatherLatencyMessage("GitHub offline; showing cached impact analysis."), false);
  });

  console.log(`\nresponseDeadline: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

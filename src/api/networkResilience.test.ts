import assert from "node:assert/strict";
import {
  NetworkResilienceError,
  combineAbortSignals,
  runResilientRequest
} from "./networkResilience";

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

async function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener(
      "abort",
      () => {
        reject(abortError());
      },
      { once: true }
    );
  });
}

async function main(): Promise<void> {
  assert.ok(combineAbortSignals(undefined, undefined) === undefined);
  {
    const one = new AbortController();
    assert.equal(combineAbortSignals(one.signal), one.signal);
  }

  {
    const started = Date.now();
    const user = new AbortController();
    await assert.rejects(
      () =>
        runResilientRequest({
          timeoutMs: 40,
          signal: user.signal,
          policy: { maxRetries: 0 },
          run: hangUntilAbort
        }),
      (error: unknown) =>
        error instanceof NetworkResilienceError &&
        error.timeout === true &&
        /Request timed out/.test(error.message)
    );
    assert.ok(Date.now() - started < 1000, "TTFB timeout must fire even when a user AbortSignal is present");
  }

  {
    const user = new AbortController();
    const pending = runResilientRequest({
      timeoutMs: 5_000,
      signal: user.signal,
      policy: { maxRetries: 0 },
      run: hangUntilAbort
    });
    setTimeout(() => user.abort(), 15);
    await assert.rejects(
      () => pending,
      (error: unknown) => error instanceof Error && error.name === "AbortError" && !(error instanceof NetworkResilienceError)
    );
  }

  console.log("networkResilience: 1/1 tests passed");
}

void main();

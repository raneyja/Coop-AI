/** Target for first meaningful user-facing output from chat and quick actions. */
export const MAX_USER_FACING_RESPONSE_MS = 15_000;

/** Reserve this much of the target for LLM startup after context/job work. */
export const RESERVED_SYNTHESIS_MS = 6_000;

export function remainingResponseBudgetMs(
  startedAt: number,
  now = Date.now(),
  maxMs = MAX_USER_FACING_RESPONSE_MS
): number {
  return Math.max(0, maxMs - (now - startedAt));
}

/** Budget left for context/job gathering before synthesis should start. */
export function remainingContextGatherBudgetMs(
  startedAt: number,
  now = Date.now(),
  maxMs = MAX_USER_FACING_RESPONSE_MS,
  reserveSynthesisMs = RESERVED_SYNTHESIS_MS
): number {
  return Math.max(0, remainingResponseBudgetMs(startedAt, now, maxMs) - reserveSynthesisMs);
}

/**
 * Stop waiting for optional context when its budget expires without cancelling
 * the user-facing turn. The underlying work may finish and populate caches.
 */
export async function waitForOptionalContext<T>(
  work: Promise<T>,
  budgetMs: number
): Promise<T | undefined> {
  if (budgetMs <= 0) {
    void work.catch(() => undefined);
    return undefined;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), budgetMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function abortablePromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function createAbortError(): Error {
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  return error;
}

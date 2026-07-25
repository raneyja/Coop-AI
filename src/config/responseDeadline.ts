/** Hard ceiling for any user-facing chat / quick-action answer. */
export const MAX_USER_FACING_RESPONSE_MS = 15_000;

/** AbortController reason when the turn hits the platform ceiling. */
export const RESPONSE_DEADLINE_REASON = "coop-response-deadline";

/** Reserve this much of the budget for LLM synthesis after context/job work. */
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

export function isResponseDeadlineAbort(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) {
    return false;
  }
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  return reason === RESPONSE_DEADLINE_REASON;
}

export function abortablePromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(createDeadlineAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(createDeadlineAbortError());
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

function createDeadlineAbortError(): Error {
  const error = new Error(RESPONSE_DEADLINE_USER_MESSAGE);
  error.name = "AbortError";
  return error;
}

/**
 * Abort `controller` when the turn budget elapses.
 * Returns a disposer that clears the timer (call on complete / manual abort).
 */
export function scheduleResponseDeadline(
  controller: AbortController,
  startedAt: number,
  maxMs = MAX_USER_FACING_RESPONSE_MS
): () => void {
  const remaining = remainingResponseBudgetMs(startedAt, Date.now(), maxMs);
  if (remaining <= 0) {
    if (!controller.signal.aborted) {
      controller.abort(RESPONSE_DEADLINE_REASON);
    }
    return () => undefined;
  }
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(RESPONSE_DEADLINE_REASON);
    }
  }, remaining);
  return () => clearTimeout(timer);
}

export const RESPONSE_DEADLINE_USER_MESSAGE =
  "This took too long (over 15 seconds). Try a narrower question, or run the action again.";

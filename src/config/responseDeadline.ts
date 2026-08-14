/**
 * Soft latency guidance for chat / quick actions.
 *
 * 15s is a *start answering* guideline — stop gathering context and hand off to
 * the model with whatever evidence we have. It must never abort the turn,
 * kill the model, or replace an answer with a timeout message.
 *
 * Soft gather is silent to the user: synthesize with partial evidence, do not
 * post degradation banners or engineer jargon about “budget exhausted.”
 *
 * Agent jobs (`coopAI.chat.agentMode`) use AGENT_JOB_WALL_MS in
 * src/config/agentJobBudget.ts — do not reuse this 15s constant as the agent wall.
 */
export const MAX_USER_FACING_RESPONSE_MS = 15_000;

/** Internal-only marker — never show in chat banners or evidence chrome. */
export const SOFT_GATHER_BUDGET_EXHAUSTED_INTERNAL =
  "Soft gather budget exhausted (responseDeadline) — synthesizing with partial blast evidence.";

export function isSoftGatherLatencyMessage(message: string | undefined | null): boolean {
  if (!message) {
    return false;
  }
  return /soft gather budget exhausted|partial blast evidence|responseDeadline/i.test(message);
}

/** @deprecated Hard abort reason — kept for tests of legacy helpers; never scheduled on turns. */
export const RESPONSE_DEADLINE_REASON = "coop-response-deadline";

/** Reserve this much of the soft budget for LLM synthesis after context/job work. */
export const RESERVED_SYNTHESIS_MS = 6_000;

/** Connect/TTFB ceiling for provider streams (not the soft gather guideline). */
export const LLM_STREAM_CONNECT_TIMEOUT_MS = 120_000;

export function remainingResponseBudgetMs(
  startedAt: number,
  now = Date.now(),
  maxMs = MAX_USER_FACING_RESPONSE_MS
): number {
  return Math.max(0, maxMs - (now - startedAt));
}

/** Soft budget left for context/job gathering before synthesis should start. */
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
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Historically aborted the turn at 15s. That shut-off is removed — gather budgets
 * stay soft via remainingContextGatherBudgetMs; AbortSignal is for user Stop only.
 * Returns a no-op disposer so call sites stay compatible.
 */
export function scheduleResponseDeadline(
  _controller: AbortController,
  _startedAt: number,
  _maxMs = MAX_USER_FACING_RESPONSE_MS
): () => void {
  return () => undefined;
}

/** Clears any leftover timer disposer at synthesis handoff (defensive; schedule is a no-op). */
export function clearResponseDeadlineForSynthesis(clear: (() => void) | undefined): void {
  clear?.();
}

/** @deprecated No longer shown — answers must not be replaced by a latency timeout. */
export const RESPONSE_DEADLINE_USER_MESSAGE =
  "This took too long (over 15 seconds). Try a narrower question, or run the action again.";

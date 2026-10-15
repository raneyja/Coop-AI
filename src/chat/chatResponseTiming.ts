/**
 * Configurable floor between user send and first visible assistant text output.
 * Production default is 0 — Coop no longer buffers real output behind an artificial
 * delay. Callers may still pass an explicit `minVisibleMs` (e.g. for tests), but no
 * hot-path call site should rely on this default being non-zero.
 */
export const MIN_CHAT_RESPONSE_VISIBLE_MS = 0;

export function remainingMinResponseDelayMs(
  startedAt: number,
  now = Date.now(),
  minVisibleMs = MIN_CHAT_RESPONSE_VISIBLE_MS
): number {
  return Math.max(0, minVisibleMs - (now - startedAt));
}

export function delayUntilMinResponseVisible(
  startedAt: number,
  now = Date.now(),
  minVisibleMs = MIN_CHAT_RESPONSE_VISIBLE_MS
): Promise<void> {
  const remaining = remainingMinResponseDelayMs(startedAt, now, minVisibleMs);
  if (remaining <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

/** Buffer streamed chunks until the minimum response delay elapses. */
export function createChatOutputGate(options: {
  startedAt: number;
  isCancelled: () => boolean;
  onChunk: (chunk: string) => void;
  minVisibleMs?: number;
}): {
  push: (chunk: string) => void;
  waitUntilOpen: () => Promise<void>;
  complete: (finalContent: string) => Promise<void>;
} {
  const remaining = remainingMinResponseDelayMs(
    options.startedAt,
    Date.now(),
    options.minVisibleMs ?? MIN_CHAT_RESPONSE_VISIBLE_MS
  );
  let open = remaining <= 0;
  const queue: string[] = [];
  let receivedAnswer = false;
  const gate =
    remaining <= 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => setTimeout(resolve, remaining)).then(() => {
          if (options.isCancelled()) {
            return;
          }
          open = true;
          for (const chunk of queue) {
            options.onChunk(chunk);
          }
          queue.length = 0;
        });

  return {
    push(chunk: string) {
      if (options.isCancelled()) {
        return;
      }
      receivedAnswer ||= Boolean(chunk.trim());
      if (open) {
        options.onChunk(chunk);
        return;
      }
      queue.push(chunk);
    },
    async complete(finalContent: string) {
      await gate;
      if (!receivedAnswer && finalContent.trim() && !options.isCancelled()) {
        receivedAnswer = true;
        options.onChunk(finalContent);
      }
    },
    async waitUntilOpen() {
      await gate;
      if (!open && !options.isCancelled()) {
        open = true;
        for (const chunk of queue) {
          options.onChunk(chunk);
        }
        queue.length = 0;
      }
    }
  };
}


/** Metadata only. Durations use one process's monotonic clock, never wall-clock
 * subtraction across the webview, extension, API or provider. */
export type AnswerTimingIdentity = { traceId: string; submissionId?: string };
export type ResponseTimingEvent = {
  stage: "response-timing";
  traceId: string;
  sequence: number;
  elapsedMs: number;
  event: string;
  phase?: string;
  durationMs?: number;
  callId?: string;
  outcome?: "completed" | "incomplete" | "failed" | "canceled";
  repaired?: boolean;
  [key: string]: unknown;
};

export class ResponseTimingTrace {
  private sequence = 0;
  private calls = 0;
  private readonly displays = new Set<string>();
  private terminal = false;
  private terminalOutcome?: ResponseTimingEvent["outcome"];
  private repaired = false;
  private lastAiOutcome?: ResponseTimingEvent["outcome"];
  private readonly started: number;
  constructor(
    readonly identity: AnswerTimingIdentity,
    private readonly emit: (event: ResponseTimingEvent) => void,
    private readonly now = () => performance.now(),
    preTurnMs = 0
  ) { this.started = now() - Math.max(0, preTurnMs); }
  elapsedMs(): number { return Math.max(0, this.now() - this.started); }
  event(event: string, details: Omit<Partial<ResponseTimingEvent>, "stage" | "traceId" | "sequence" | "elapsedMs" | "event"> = {}): void {
    // No token events, source bytes, prompts, filenames or credentials. Fixed per-turn cap.
    if (this.sequence >= (event === "turn-end" || event === "display" ? 96 : 92)) return;
    try {
      this.emit({ ...details, stage: "response-timing", traceId: this.identity.traceId,
        sequence: ++this.sequence, elapsedMs: this.elapsedMs(), event });
    } catch { /* Diagnostic delivery must never change the answer or Stop. */ }
  }
  span(phase: string, details: Partial<ResponseTimingEvent> = {}): (outcome?: ResponseTimingEvent["outcome"]) => void {
    const start = this.now();
    this.event("phase-start", { ...details, phase });
    let ended = false;
    return (outcome = "completed") => {
      if (ended) return;
      ended = true;
      if (phase === "ai") this.lastAiOutcome = outcome;
      this.event("phase-end", { ...details, phase, outcome, durationMs: Math.max(0, this.now() - start) });
    };
  }
  display(milestone: "first-answer-content" | "complete", elapsedMs: number): boolean {
    if ((milestone !== "first-answer-content" && milestone !== "complete") ||
        this.terminalOutcome === "canceled" || this.terminalOutcome === "failed" ||
        this.displays.has(milestone) || this.displays.has("complete") || !validDisplayElapsed(elapsedMs)) return false;
    this.displays.add(milestone);
    this.event("display", { milestone, clientElapsedMs: elapsedMs, clock: "webview-monotonic",
      observation: "visible-dom-after-paint", usefulness: "requires-quality-review" });
    return true;
  }
  nextCallId(): string { return `${this.identity.traceId}-call-${++this.calls}`; }
  repair(reason: "incomplete" | "citation" | "structure" | "claims"): void {
    this.repaired = true;
    this.event("repair", { reason });
  }
  finish(outcome: NonNullable<ResponseTimingEvent["outcome"]>): void {
    if (this.terminal) return;
    this.terminal = true;
    this.terminalOutcome = outcome;
    this.event("turn-end", { outcome: outcome === "completed" && this.lastAiOutcome === "incomplete" ? "incomplete" : outcome, repaired: this.repaired });
  }
}

const responseTraces = new WeakMap<AbortSignal, ResponseTimingTrace>();
export function registerResponseTiming(signal: AbortSignal, trace: ResponseTimingTrace, cancelTurn = true): void {
  responseTraces.set(signal, trace);
  if (cancelTurn) signal.addEventListener("abort", () => trace.finish("canceled"), { once: true });
}
export function responseTiming(signal?: AbortSignal): ResponseTimingTrace | undefined {
  return signal ? responseTraces.get(signal) : undefined;
}
export function timeResponseWork<T>(signal: AbortSignal | undefined, phase: string, work: () => T): T {
  const end = responseTiming(signal)?.span(phase);
  try { const result = work(); end?.(); return result; }
  catch (error) { end?.(signal?.aborted ? "canceled" : "failed"); throw error; }
}

/** Runtime checks for untrusted webview receipts; no wall-clock assumptions. */
export function validDisplayElapsed(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
}


export type DisplayMilestone = "first-answer-content" | "complete";
/** Bounded frontend submission clock. Restored messages and another turn's
 * late receipts have no matching live submission and cannot invent a metric. */
export class SubmissionDisplayClock {
  private readonly submissions = new Map<string, { started: number; traceId?: string; first: boolean }>();
  constructor(private readonly now = () => performance.now()) {}
  submit(id: string): void {
    this.submissions.set(id, { started: this.now(), first: false });
    if (this.submissions.size > 64) this.submissions.delete(this.submissions.keys().next().value!);
  }
  pending(identity: AnswerTimingIdentity, milestone: DisplayMilestone): boolean {
    const submission = identity.submissionId ? this.submissions.get(identity.submissionId) : undefined;
    return Boolean(submission && (!submission.traceId || submission.traceId === identity.traceId) &&
      (milestone === "complete" || !submission.first));
  }
  receipt(identity: AnswerTimingIdentity, milestone: DisplayMilestone): number | undefined {
    const submission = identity.submissionId ? this.submissions.get(identity.submissionId) : undefined;
    if (!submission || (submission.traceId && submission.traceId !== identity.traceId)) return undefined;
    submission.traceId = identity.traceId;
    if (milestone === "first-answer-content") {
      if (submission.first) return undefined;
      submission.first = true;
    } else if (milestone === "complete") this.submissions.delete(identity.submissionId!);
    else return undefined;
    return Math.max(0, this.now() - submission.started);
  }
}
export function acceptDisplayReceipt(trace: ResponseTimingTrace, receipt: AnswerTimingIdentity & { elapsedMs: number; milestone: DisplayMilestone }): boolean {
  return trace.identity.traceId === receipt.traceId && trace.identity.submissionId === receipt.submissionId &&
    trace.display(receipt.milestone, receipt.elapsedMs);
}

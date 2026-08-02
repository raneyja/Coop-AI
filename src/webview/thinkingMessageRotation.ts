import {
  appendThinkingProcessingTerms,
  buildProcessingTermMessages,
  stripThinkingProcessingTerms
} from "../context/thinkingProcessingTerms";
import {
  isIntentInlineLoading,
  isJobInlineLoading
} from "./chatInlineThinking";
import type { IntentFeedbackState, JobProgressState } from "./types";

/** Soft whisper / synthesis-status cadence while the model is still working. */
export const THINKING_ROTATION_STEP_MS = 2_200;
/** Pause after send before the first todo appears — avoids an instant fake checklist. */
export const ACTIVITY_START_DELAY_MS = 900;
/** How long each todo stays active before the next one is revealed (one-by-one). */
export const ACTIVITY_PHASE_MS = 3_200;

/** Checklist lines paced during model synthesis (after gather/job). */
export const SYNTHESIS_TODO_MESSAGES = [
  "Weighing gathered evidence…",
  "Connecting docs and code signals…",
  "Drafting findings…",
  "Checking ownership and open questions…",
  "Prioritizing what matters…",
  "Writing your answer…"
] as const;

const SYNTHESIS_THINKING_LINES = [
  "Comparing repo signals with docs and conversations…",
  "Looking for undocumented paths, weak ownership, and open follow-ups…",
  "Organizing the strongest gaps before answering…",
  "Cross-checking evidence so the answer stays grounded…"
] as const;

/** Terminal job copy — not a checklist step; the long model wait starts here. */
export function isTerminalPreparingMessage(message: string): boolean {
  const trimmed = message.trim();
  return (
    /preparing (your )?answer/i.test(trimmed) ||
    /^scan complete\b/i.test(trimmed) ||
    /^graph ready\b/i.test(trimmed)
  );
}

export function hasTerminalPreparingSignal(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined
): boolean {
  const fromIntent = (intentFeedback?.activityMessages ?? []).some(isTerminalPreparingMessage);
  const fromJob = isTerminalPreparingMessage(jobProgress?.message || jobProgress?.title || "");
  const highProgress =
    typeof jobProgress?.progress === "number" && jobProgress.progress >= 75;
  return fromIntent || fromJob || highProgress;
}

export type ThinkingRotationOptions = {
  awaitingResponse?: boolean;
  rotationSeed?: string;
  /**
   * When false, skip filler "Synthesizing…" terms so todos map to real work only.
   * Default true for legacy single-line status rotation.
   */
  includeProcessingTerms?: boolean;
};

function uniqueMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const trimmed = message.trim();
    if (!trimmed || seen.has(trimmed)) {
      return false;
    }
    seen.add(trimmed);
    return true;
  });
}

/** Concrete gather/job lines only — used for Cursor-style todos. */
export function buildConcreteActivityMessages(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined
): string[] {
  const messages: string[] = [];

  if (intentFeedback?.activityMessages?.length) {
    messages.push(...stripThinkingProcessingTerms(intentFeedback.activityMessages));
  } else if (intentFeedback && isIntentInlineLoading(intentFeedback)) {
    const intentMessage = (intentFeedback.message || intentFeedback.title || "").trim();
    if (intentMessage) {
      messages.push(...stripThinkingProcessingTerms([intentMessage]));
    }
  }

  if (jobProgress && isJobInlineLoading(jobProgress)) {
    const jobMessage = (jobProgress.message || jobProgress.title || "").trim();
    if (jobMessage) {
      messages.push(jobMessage);
    }
  }

  return uniqueMessages(messages).filter((message) => !isTerminalPreparingMessage(message));
}

/** Soft waiting labels rotated on the *active* todo while the model/job still runs. */
export function buildWaitingActivityLabels(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ThinkingRotationOptions = {}
): string[] {
  const seed =
    options.rotationSeed ??
    intentFeedback?.actionId ??
    jobProgress?.jobId ??
    "waiting";
  return buildProcessingTermMessages(seed, 6);
}

/** Elapsed time used for pacing after the post-send start delay. */
export function activityPaceElapsedMs(elapsedMs: number): number {
  return Math.max(0, elapsedMs - ACTIVITY_START_DELAY_MS);
}

/** True once gather/job is done and we're waiting on the model. */
export function isSynthesisActivityPhase(options: {
  intentFeedback?: IntentFeedbackState;
  jobProgress?: JobProgressState;
  awaitingResponse?: boolean;
  prepCount: number;
  elapsedMs: number;
}): boolean {
  const { intentFeedback, jobProgress, awaitingResponse, prepCount, elapsedMs } = options;
  const paced = activityPaceElapsedMs(elapsedMs);

  // Job/model handoff — real signal that synthesis started.
  if (hasTerminalPreparingSignal(intentFeedback, jobProgress)) {
    return true;
  }

  // No gather lines: enter synthesis only after the start delay (never on the same tick as send).
  if (awaitingResponse && prepCount === 0) {
    return paced > 0;
  }

  // Finish a full dwell on every prep step before synthesis todos begin.
  // (Do not use (prepCount - 1) — that entered synthesis immediately when prepCount === 1.)
  if (prepCount > 0 && paced >= prepCount * ACTIVITY_PHASE_MS) {
    return true;
  }

  return false;
}

/** Rotating narrative shown in the Thinking block when the provider sends no CoT. */
export function pickSynthesisThinkingLine(step: number): string {
  return SYNTHESIS_THINKING_LINES[step % SYNTHESIS_THINKING_LINES.length] ?? "Writing your answer…";
}

/**
 * Active todo index from paced elapsed time only (after start delay).
 * Returns -1 while still in the start delay so callers can show nothing yet.
 */
export function resolvePacedActivityIndex(options: {
  concreteCount: number;
  elapsedMs: number;
  /** When true, `elapsedMs` is already pace-elapsed (start delay applied). */
  paced?: boolean;
  /** @deprecated Ignored — kept so older call sites typecheck during rollout. */
  progress?: number;
}): number {
  const { concreteCount, elapsedMs, paced = false } = options;
  if (concreteCount <= 0) {
    return 0;
  }
  const paceElapsed = paced ? Math.max(0, elapsedMs) : activityPaceElapsedMs(elapsedMs);
  if (!paced && elapsedMs < ACTIVITY_START_DELAY_MS) {
    return -1;
  }
  const lastIndex = concreteCount - 1;
  if (lastIndex === 0) {
    return 0;
  }
  return Math.min(lastIndex, Math.floor(paceElapsed / ACTIVITY_PHASE_MS));
}

/** Merge tool-connection, job, and processing lines into one rotation sequence. */
export function buildThinkingMessageSequence(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ThinkingRotationOptions = {}
): string[] {
  const seed =
    options.rotationSeed ??
    intentFeedback?.actionId ??
    jobProgress?.jobId ??
    String(Date.now());
  const includeProcessingTerms = options.includeProcessingTerms !== false;
  const concrete = buildConcreteActivityMessages(intentFeedback, jobProgress);

  if (options.awaitingResponse && concrete.length === 0) {
    return includeProcessingTerms ? appendThinkingProcessingTerms([], seed, 6) : [];
  }

  if (concrete.length === 0) {
    return [];
  }

  const activelyLoading =
    options.awaitingResponse ||
    (intentFeedback && isIntentInlineLoading(intentFeedback)) ||
    (jobProgress && isJobInlineLoading(jobProgress));

  if (!activelyLoading || !includeProcessingTerms) {
    return concrete;
  }

  return appendThinkingProcessingTerms(concrete, `${seed}:tail`, 4);
}

export function pickRotatingThinkingMessage(messages: string[], step: number): string | undefined {
  if (!messages.length) {
    return undefined;
  }
  return messages[step % messages.length];
}

export function hasVisibleAssistantResponse(
  messages: Array<{ role: string; content: string }>,
  streamingMessage: { content: string } | null | undefined
): boolean {
  if (streamingMessage?.content.trim()) {
    return true;
  }
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && Boolean(last.content.trim());
}

export function shouldShowThinkingIndicator(
  thinkingMessage: string | undefined,
  messages: Array<{ role: string; content: string }>,
  streamingMessage: { content: string } | null | undefined
): boolean {
  return Boolean(thinkingMessage) && !hasVisibleAssistantResponse(messages, streamingMessage);
}

export function shouldRotateThinkingMessages(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ThinkingRotationOptions = {}
): boolean {
  return buildThinkingMessageSequence(intentFeedback, jobProgress, options).length > 0;
}

/**
 * Job progress often appends lines to the sequence. Treat prefix growth as continuous
 * work so the timeline keeps advancing instead of snapping back to the first step.
 */
export function shouldResetThinkingRotationStep(previous: string[], next: string[]): boolean {
  const isPrefixGrowth =
    previous.length > 0 &&
    next.length >= previous.length &&
    previous.every((message, index) => next[index] === message);
  return !isPrefixGrowth;
}

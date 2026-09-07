import {
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

/** Kept empty — fake Distilling/Aggregating synthesis todos are off. */
export const SYNTHESIS_TODO_MESSAGES = [] as const;

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
   * Ignored — fake “Aggregating…” rotation is off. Real gather/search lines only.
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

/** Soft waiting labels — unused. Fake Distilling/Aggregating rotation is off. */
export function buildWaitingActivityLabels(
  _intentFeedback: IntentFeedbackState | undefined,
  _jobProgress: JobProgressState | undefined,
  _options: ThinkingRotationOptions = {}
): string[] {
  return [];
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

/** Unused — fake Distilling/Aggregating CoT is off. Real model thinking only. */
export function pickSynthesisThinkingLine(_step: number): string {
  return "";
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

/** Merge tool-connection and job lines only — no fake processing verbs. */
export function buildThinkingMessageSequence(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  _options: ThinkingRotationOptions = {}
): string[] {
  return buildConcreteActivityMessages(intentFeedback, jobProgress);
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

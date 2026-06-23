import { appendThinkingProcessingTerms } from "../context/thinkingProcessingTerms";
import {
  isIntentInlineLoading,
  isJobInlineLoading
} from "./chatInlineThinking";
import type { IntentFeedbackState, JobProgressState } from "./types";

export const THINKING_ROTATION_STEP_MS = 850;

export type ThinkingRotationOptions = {
  awaitingResponse?: boolean;
  rotationSeed?: string;
};

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
  const messages: string[] = [];

  if (intentFeedback?.activityMessages?.length) {
    messages.push(...intentFeedback.activityMessages);
  } else if (intentFeedback && isIntentInlineLoading(intentFeedback)) {
    const intentMessage = (intentFeedback.message || intentFeedback.title || "").trim();
    if (intentMessage) {
      messages.push(intentMessage);
    }
  }

  if (jobProgress && isJobInlineLoading(jobProgress)) {
    const jobMessage = (jobProgress.message || jobProgress.title || "").trim();
    if (jobMessage) {
      messages.push(jobMessage);
    }
  }

  if (options.awaitingResponse && messages.length === 0) {
    return appendThinkingProcessingTerms(messages, seed, 6);
  }

  if (messages.length === 0) {
    return [];
  }

  const activelyLoading =
    options.awaitingResponse ||
    (intentFeedback && isIntentInlineLoading(intentFeedback)) ||
    (jobProgress && isJobInlineLoading(jobProgress));

  return activelyLoading
    ? appendThinkingProcessingTerms(messages, `${seed}:tail`, 4)
    : messages;
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

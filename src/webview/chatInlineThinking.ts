import {
  isActiveJobStatus,
  shouldShowJobActivityLine
} from "../jobs/jobActivityPolicy";
import type { IntentFeedbackState, JobProgressState } from "./types";

export type ChatInlineThinkingOptions = {
  /** User submitted and we are waiting for the first streamed token. */
  awaitingResponse?: boolean;
};

export function isIntentInlineLoading(intentFeedback: IntentFeedbackState): boolean {
  if (intentFeedback.status === "loading") {
    return true;
  }
  // e.g. knowledge-gaps long scan notice while progress is shown
  if (intentFeedback.status === "warning" && intentFeedback.progress !== undefined) {
    return true;
  }
  return false;
}

export function isJobInlineLoading(jobProgress: JobProgressState): boolean {
  if (isActiveJobStatus(jobProgress.status)) {
    return true;
  }
  if (jobProgress.deliverable === "chat" && shouldShowJobActivityLine(jobProgress)) {
    return true;
  }
  return false;
}

/** Status line shown in the chat thread while context, jobs, or synthesis are in flight. */
export function resolveChatInlineThinkingMessage(
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ChatInlineThinkingOptions = {}
): string | undefined {
  if (jobProgress && isJobInlineLoading(jobProgress)) {
    const jobMessage = (jobProgress.message || jobProgress.title || "").trim();
    if (jobMessage) {
      return jobMessage;
    }
  }

  if (intentFeedback && isIntentInlineLoading(intentFeedback)) {
    return intentFeedback.message || intentFeedback.title || "Fetching context…";
  }

  if (options.awaitingResponse) {
    return "Preparing answer…";
  }

  return undefined;
}

export function shouldSuppressActivityStripLoading(
  hideInlineActivity: boolean,
  intentFeedback: IntentFeedbackState | undefined,
  jobProgress: JobProgressState | undefined,
  options: ChatInlineThinkingOptions = {}
): { intent: boolean; job: boolean } {
  if (!hideInlineActivity) {
    return { intent: false, job: false };
  }

  const hasInlineThinking = Boolean(
    intentFeedback?.activityMessages?.length ||
      (intentFeedback && isIntentInlineLoading(intentFeedback)) ||
      (jobProgress && isJobInlineLoading(jobProgress)) ||
      options.awaitingResponse
  );

  return {
    intent: Boolean(intentFeedback && isIntentInlineLoading(intentFeedback) && hasInlineThinking),
    job: Boolean(jobProgress && isJobInlineLoading(jobProgress) && hasInlineThinking)
  };
}

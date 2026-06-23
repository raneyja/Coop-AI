import React from "react";
import {
  isActiveJobStatus,
  shouldShowJobActivityLine,
  shouldShowViewResultsButton
} from "../../jobs/jobActivityPolicy";
import type { IntentFeedbackState, JobProgressState } from "../types";
import { shouldSuppressActivityStripLoading } from "../chatInlineThinking";
import type { ChatInlineThinkingOptions } from "../chatInlineThinking";

type ChatActivityStripProps = {
  error?: string;
  onDismissError?: () => void;
  contextWarning?: string;
  onDismissContextWarning?: () => void;
  jobProgress?: JobProgressState;
  onDismissJob?: () => void;
  onCancelJob?: (jobId: string) => void;
  onViewJobResults?: (jobId: string) => void;
  intentFeedback?: IntentFeedbackState;
  onDismissIntent?: () => void;
  conflictCount?: number;
  /** When true, in-thread loading replaces strip rows for intent/job progress. */
  hideInlineActivity?: boolean;
  inlineThinkingOptions?: ChatInlineThinkingOptions;
};

/**
 * Compact status row above the composer (Cursor-style).
 */
export function ChatActivityStrip({
  error,
  onDismissError,
  contextWarning,
  onDismissContextWarning,
  jobProgress,
  onDismissJob,
  onCancelJob,
  onViewJobResults,
  intentFeedback,
  onDismissIntent,
  conflictCount = 0,
  hideInlineActivity = false,
  inlineThinkingOptions
}: ChatActivityStripProps): React.ReactElement | null {
  const jobActive = jobProgress ? isActiveJobStatus(jobProgress.status) : false;
  const showJobLine = jobProgress ? shouldShowJobActivityLine(jobProgress) : false;
  const suppress = shouldSuppressActivityStripLoading(
    hideInlineActivity,
    intentFeedback,
    jobProgress,
    inlineThinkingOptions
  );
  const jobLine =
    jobProgress && showJobLine && !suppress.job
      ? jobProgress.message || jobProgress.title
      : undefined;

  const intentLine =
    intentFeedback &&
    !suppress.intent &&
    intentFeedback.status !== "idle" &&
    intentFeedback.status !== "loading" &&
    intentFeedback.status !== "complete"
      ? intentFeedback.message || intentFeedback.title
      : undefined;
  const intentLoading = !suppress.intent && intentFeedback?.status === "loading" && !jobLine;
  const loadingMessage = intentFeedback?.message || "Fetching context…";

  const line = error || (!intentLoading ? intentLine : undefined) || jobLine;

  if (!line && !intentLoading && conflictCount === 0 && !contextWarning) {
    return null;
  }

  const canDismissJob =
    Boolean(onDismissJob) &&
    Boolean(jobProgress) &&
    jobProgress?.status !== "queued" &&
    jobProgress?.status !== "running";
  const canCancelJob =
    Boolean(onCancelJob) && jobProgress?.status === "queued" && Boolean(jobProgress.jobId);
  const canViewJobResults =
    Boolean(onViewJobResults) &&
    Boolean(jobProgress?.jobId) &&
    Boolean(jobProgress && shouldShowViewResultsButton(jobProgress));

  return (
    <div className="chat-activity-strip" role="status" aria-live="polite">
      {error ? (
        <div className="chat-activity-strip-row chat-activity-strip-row--error">
          <span className="min-w-0 truncate">{error}</span>
          {onDismissError ? (
            <button type="button" className="chat-activity-strip-action" onClick={onDismissError}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
      {!error && intentLoading ? (
        <div className="chat-activity-strip-loading">
          <span className="chat-activity-strip-spinner" aria-hidden="true" />
          <span className="chat-activity-whisper-text">{loadingMessage}</span>
        </div>
      ) : null}
      {!error && !intentLoading && (intentLine || jobLine) ? (
        <div
          className={`chat-activity-strip-row${
            jobProgress?.status === "failed" ? " chat-activity-strip-row--error" : ""
          }`}
        >
          {jobActive ? <span className="chat-activity-strip-spinner" aria-hidden="true" /> : null}
          <span className="min-w-0 truncate">{line}</span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {canCancelJob ? (
              <button
                type="button"
                className="chat-activity-strip-action"
                onClick={() => onCancelJob?.(jobProgress!.jobId)}
              >
                Cancel
              </button>
            ) : null}
            {canViewJobResults ? (
              <button
                type="button"
                className="chat-activity-strip-action"
                onClick={() => onViewJobResults?.(jobProgress!.jobId)}
              >
                View results
              </button>
            ) : null}
            {intentFeedback && onDismissIntent && !suppress.intent ? (
              <button type="button" className="chat-activity-strip-action" onClick={onDismissIntent}>
                Dismiss
              </button>
            ) : null}
            {canDismissJob ? (
              <button type="button" className="chat-activity-strip-action" onClick={onDismissJob}>
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {contextWarning ? (
        <div className="chat-activity-strip-row chat-activity-strip-row--warning">
          <span className="min-w-0">{contextWarning}</span>
          {onDismissContextWarning ? (
            <button type="button" className="chat-activity-strip-action" onClick={onDismissContextWarning}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
      {conflictCount > 0 ? (
        <div className="chat-activity-strip-row">
          <span>
            {conflictCount} conflict{conflictCount === 1 ? "" : "s"} need attention
          </span>
        </div>
      ) : null}
    </div>
  );
}

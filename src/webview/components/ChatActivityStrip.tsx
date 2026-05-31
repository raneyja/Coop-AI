import React from "react";
import type { IntentFeedbackState, JobProgressState } from "../types";

type ChatActivityStripProps = {
  error?: string;
  onDismissError?: () => void;
  contextWarning?: string;
  jobProgress?: JobProgressState;
  onDismissJob?: () => void;
  onCancelJob?: (jobId: string) => void;
  onViewJobResults?: (jobId: string) => void;
  intentFeedback?: IntentFeedbackState;
  onDismissIntent?: () => void;
  conflictCount?: number;
};

/**
 * Compact status row above the composer (Cursor-style).
 */
export function ChatActivityStrip({
  error,
  onDismissError,
  contextWarning,
  jobProgress,
  onDismissJob,
  onCancelJob,
  onViewJobResults,
  intentFeedback,
  onDismissIntent,
  conflictCount = 0
}: ChatActivityStripProps): React.ReactElement | null {
  const intentLine =
    intentFeedback && intentFeedback.status !== "idle"
      ? intentFeedback.message || intentFeedback.title
      : undefined;

  const jobActive =
    jobProgress?.status === "queued" || jobProgress?.status === "running";
  const jobTerminal =
    jobProgress?.status === "failed" ||
    jobProgress?.status === "cancelled" ||
    jobProgress?.status === "completed" ||
    jobProgress?.status === "partial";
  const jobLine = jobProgress
    ? jobActive
      ? jobProgress.message || jobProgress.title
      : jobTerminal
        ? jobProgress.message || jobProgress.title
        : undefined
    : undefined;

  const line = error || intentLine || jobLine;

  if (!line && conflictCount === 0 && !contextWarning) {
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
    (jobProgress?.status === "completed" || jobProgress?.status === "partial");

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
      {!error && (intentLine || jobLine) ? (
        <div
          className={`chat-activity-strip-row${
            jobProgress?.status === "failed" ? " chat-activity-strip-row--error" : ""
          }`}
        >
          {jobActive || (intentFeedback?.status === "loading" && !jobLine) ? (
            <span className="chat-activity-strip-spinner" aria-hidden="true" />
          ) : null}
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
            {intentFeedback && intentFeedback.status !== "loading" && onDismissIntent ? (
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

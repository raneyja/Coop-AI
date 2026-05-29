import React from "react";
import type { JobProgressState } from "./types";

export type { JobProgressState };

type JobProgressProps = {
  state?: JobProgressState;
  onCancel?: (jobId: string) => void;
  onViewResults?: (jobId: string) => void;
  onDismiss?: () => void;
};

const STATUS_TONE: Record<JobProgressState["status"], { border: string; accent: string }> = {
  queued: {
    border: "var(--vscode-inputValidation-infoBorder)",
    accent: "var(--vscode-progressBar-background)"
  },
  running: {
    border: "var(--vscode-focusBorder)",
    accent: "var(--vscode-progressBar-background)"
  },
  completed: {
    border: "var(--vscode-testing-iconPassed)",
    accent: "var(--vscode-testing-iconPassed)"
  },
  partial: {
    border: "var(--vscode-inputValidation-warningBorder)",
    accent: "var(--vscode-inputValidation-warningBorder)"
  },
  failed: {
    border: "var(--vscode-inputValidation-errorBorder)",
    accent: "var(--vscode-inputValidation-errorBorder)"
  },
  cancelled: {
    border: "var(--vscode-widget-border)",
    accent: "var(--vscode-descriptionForeground)"
  }
};

export function JobProgress({
  state,
  onCancel,
  onViewResults,
  onDismiss
}: JobProgressProps): React.ReactElement | null {
  if (!state) {
    return null;
  }

  const tone = STATUS_TONE[state.status];
  const canCancel = state.status === "queued" && Boolean(onCancel);
  const canView = (state.status === "completed" || state.status === "partial") && Boolean(onViewResults);
  const canDismiss = state.status !== "running" && state.status !== "queued" && Boolean(onDismiss);

  return (
    <section
      className="mx-3 mb-2 rounded-md border px-3 py-2 text-xs shadow-sm"
      style={{ borderColor: tone.border, background: "var(--vscode-editorWidget-background)" }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <StatusIcon status={state.status} accent={tone.accent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium text-[var(--coop-panel-foreground)]">{state.title}</p>
            {canDismiss ? (
              <button type="button" className="shrink-0 text-[11px] opacity-75 hover:opacity-100" onClick={onDismiss}>
                Dismiss
              </button>
            ) : null}
          </div>

          {state.message ? <p className="mt-1 leading-relaxed opacity-90">{state.message}</p> : null}

          {state.status === "queued" && state.estimatedWaitTime ? (
            <p className="mt-1 text-[11px] opacity-80">
              Job #{state.jobId.slice(0, 8)} queued. Wait time: {state.estimatedWaitTime}
            </p>
          ) : null}

          {state.status === "running" && state.estimatedTimeRemaining ? (
            <p className="mt-1 text-[11px] opacity-80">ETA: {state.estimatedTimeRemaining}</p>
          ) : null}

          {(state.status === "queued" || state.status === "running") && (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--vscode-progressBar-background)]/20"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.progress}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${state.progress}%`, background: tone.accent }}
              />
            </div>
          )}

          {state.status === "completed" && state.resultSummary ? (
            <div className="mt-2 space-y-1 rounded border border-[var(--vscode-widget-border)] p-2">
              <p className="font-medium">Knowledge Gap scan complete</p>
              <p>Results: {state.resultSummary.foundGaps ?? 0} gaps found</p>
              <ul className="list-inside list-disc opacity-90">
                <li>{state.resultSummary.highPriority ?? 0} high priority</li>
                <li>{state.resultSummary.mediumPriority ?? 0} medium priority</li>
                <li>{state.resultSummary.lowPriority ?? 0} low priority</li>
              </ul>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-2">
            {canCancel ? (
              <button
                type="button"
                className="rounded border border-[var(--vscode-button-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                onClick={() => onCancel?.(state.jobId)}
              >
                Cancel Job
              </button>
            ) : null}
            {canView ? (
              <button
                type="button"
                className="rounded bg-[var(--vscode-button-background)] px-2 py-0.5 text-[11px] text-[var(--vscode-button-foreground)]"
                onClick={() => onViewResults?.(state.jobId)}
              >
                View Results
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusIcon({
  status,
  accent
}: {
  status: JobProgressState["status"];
  accent: string;
}): React.ReactElement {
  if (status === "running" || status === "queued") {
    return (
      <span
        className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        style={{ color: accent }}
        aria-hidden="true"
      />
    );
  }
  const symbol =
    status === "completed" ? "ok" : status === "failed" ? "x" : status === "partial" ? "!" : "-";
  return (
    <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px] font-bold" style={{ color: accent }}>
      {symbol}
    </span>
  );
}

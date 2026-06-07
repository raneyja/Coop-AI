import React from "react";
import { coopNoticeClass, type CoopNoticeTone } from "./components/CoopNotice";
import { RefreshButton } from "./components/RefreshButton";
import type { IntentFeedbackState } from "./types";

type IntentFeedbackProps = {
  state?: IntentFeedbackState;
  onDismiss?: () => void;
  onRefreshContext?: () => void;
};

const ACCENTS: Record<IntentFeedbackState["status"], string> = {
  idle: "var(--coop-panel-muted)",
  loading: "var(--vscode-progressBar-background)",
  warning: "var(--vscode-inputValidation-warningBorder, #d19a66)",
  "rate-limited": "var(--vscode-textLink-foreground, #3794ff)",
  complete: "var(--vscode-testing-iconPassed, #22c55e)",
  error: "var(--vscode-inputValidation-errorBorder, #f87171)"
};

function noticeToneForStatus(status: IntentFeedbackState["status"]): CoopNoticeTone {
  switch (status) {
    case "warning":
      return "warning";
    case "rate-limited":
      return "info";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

const ACTION_LABELS: Record<string, string> = {
  "understand-repo": "Understand Repo",
  "trace-decision": "Trace Decision",
  "find-owner": "Find Owner",
  "blast-radius": "Blast Radius",
  "knowledge-gaps": "Knowledge Gaps"
};

export function IntentFeedback({ state, onDismiss, onRefreshContext }: IntentFeedbackProps): React.ReactElement | null {
  if (!state || state.status === "idle") {
    return null;
  }

  const accent = ACCENTS[state.status];
  const progress = normalizeProgress(state.progress, state.status);
  const details = buildDetails(state);
  const canDismiss = state.status !== "loading" && Boolean(onDismiss);
  const canRefresh =
    Boolean(onRefreshContext) &&
    (state.status === "rate-limited" || state.status === "warning" || state.status === "error");

  return (
    <section
      className={`mx-3 mb-2 ${coopNoticeClass(noticeToneForStatus(state.status))}`}
      role={state.status === "error" ? "alert" : "status"}
      aria-live={state.status === "loading" ? "polite" : "assertive"}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <StatusGlyph status={state.status} accent={accent} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{state.title}</p>
              {details.subtitle ? (
                <p className="mt-0.5 text-[11px] opacity-80">{details.subtitle}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              {canRefresh ? (
                <RefreshButton
                  className="coop-text-btn text-[11px]"
                  onClick={() => onRefreshContext?.()}
                />
              ) : null}
              {canDismiss ? (
                <button
                  type="button"
                  className="text-[11px] opacity-75 hover:opacity-100"
                  onClick={onDismiss}
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          </div>

          {state.message ? (
            <p className="mt-1 leading-relaxed opacity-90">{state.message}</p>
          ) : null}

          {state.status === "loading" || state.status === "warning" ? (
            <ProgressBar progress={progress} accent={accent} indeterminate={state.progress === undefined} />
          ) : null}

          {details.footer ? (
            <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{details.footer}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StatusGlyph({
  status,
  accent
}: {
  status: IntentFeedbackState["status"];
  accent: string;
}): React.ReactElement {
  if (status === "loading") {
    return (
      <span
        className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        style={{ color: accent }}
        aria-hidden="true"
      />
    );
  }

  const symbol = symbolForStatus(status);
  return (
    <span
      className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
      style={{ color: accent }}
      aria-hidden="true"
    >
      {symbol}
    </span>
  );
}

function ProgressBar({
  progress,
  accent,
  indeterminate
}: {
  progress: number;
  accent: string;
  indeterminate: boolean;
}): React.ReactElement {
  return (
    <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--vscode-progressBar-background)]/20"
      aria-label="Context fetch progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : progress}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${indeterminate ? "w-1/2 animate-pulse" : ""}`}
        style={{
          width: indeterminate ? undefined : `${progress}%`,
          background: accent
        }}
      />
    </div>
  );
}

function buildDetails(state: IntentFeedbackState): { subtitle?: string; footer?: string } {
  const actionLabel = state.actionId ? ACTION_LABELS[state.actionId] ?? state.actionId : undefined;
  const subtitle = actionLabel ? `${actionLabel} context fetch` : humanizeIntent(state.intent);
  if (state.status === "rate-limited") {
    return {
      subtitle,
      footer: state.stale ? "Showing stale cached context" : "No cached context available"
    };
  }
  if (state.status === "warning") {
    return { subtitle };
  }
  if (state.status === "complete") {
    return {
      subtitle,
      footer: "Ready"
    };
  }
  return { subtitle };
}

function normalizeProgress(progress: number | undefined, status: IntentFeedbackState["status"]): number {
  if (progress === undefined) {
    return status === "warning" ? 15 : 45;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function symbolForStatus(status: IntentFeedbackState["status"]): string {
  switch (status) {
    case "warning":
      return "!";
    case "rate-limited":
      return "i";
    case "complete":
      return "ok";
    case "error":
      return "x";
    default:
      return "";
  }
}

function humanizeIntent(intent: string | undefined): string | undefined {
  if (!intent) {
    return undefined;
  }
  return intent
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

import React from "react";
import type { ConflictActionId, ConflictResolutionState, ConflictSummary } from "./types";

type ConflictResolutionProps = {
  state?: ConflictResolutionState;
  onDismiss?: (conflictId: string) => void;
  onAction?: (conflictId: string, action: ConflictActionId) => void;
};

type Tone = {
  border: string;
  background: string;
  foreground: string;
  accent: string;
};

const TONES: Record<ConflictSummary["severity"], Tone> = {
  low: {
    border: "var(--vscode-widget-border)",
    background: "var(--vscode-editorWidget-background)",
    foreground: "var(--coop-panel-foreground)",
    accent: "var(--vscode-descriptionForeground)"
  },
  medium: {
    border: "var(--vscode-inputValidation-infoBorder)",
    background: "var(--vscode-inputValidation-infoBackground)",
    foreground: "var(--vscode-inputValidation-infoForeground, var(--coop-panel-foreground))",
    accent: "var(--vscode-inputValidation-infoBorder)"
  },
  high: {
    border: "var(--vscode-inputValidation-warningBorder)",
    background: "var(--vscode-inputValidation-warningBackground)",
    foreground: "var(--vscode-inputValidation-warningForeground, var(--coop-panel-foreground))",
    accent: "var(--vscode-inputValidation-warningBorder)"
  },
  critical: {
    border: "var(--vscode-inputValidation-errorBorder)",
    background: "var(--vscode-inputValidation-errorBackground)",
    foreground: "var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground))",
    accent: "var(--vscode-inputValidation-errorBorder)"
  }
};

export function ConflictResolution({
  state,
  onDismiss,
  onAction
}: ConflictResolutionProps): React.ReactElement | null {
  if (!state || state.status === "idle" || state.conflicts.length === 0) {
    return null;
  }

  const visible = state.conflicts.slice(0, 3);
  const remaining = state.conflicts.length - visible.length;

  return (
    <section className="mx-3 mb-2 space-y-2" aria-label="Source conflicts">
      {visible.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          onDismiss={onDismiss}
          onAction={onAction}
        />
      ))}
      {remaining > 0 ? (
        <p className="px-1 text-[10px] text-[var(--vscode-descriptionForeground)]">
          {remaining} more conflict{remaining === 1 ? "" : "s"} hidden.
        </p>
      ) : null}
    </section>
  );
}

function ConflictCard({
  conflict,
  onDismiss,
  onAction
}: {
  conflict: ConflictSummary;
  onDismiss?: (conflictId: string) => void;
  onAction?: (conflictId: string, action: ConflictActionId) => void;
}): React.ReactElement {
  const tone = TONES[conflict.severity];
  const role = conflict.severity === "high" || conflict.severity === "critical" ? "alert" : "status";

  return (
    <article
      className="rounded-md border px-3 py-2 text-xs shadow-sm"
      style={{
        borderColor: tone.border,
        background: tone.background,
        color: tone.foreground
      }}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ color: tone.accent }}
          aria-hidden="true"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{conflict.title}</p>
              <p className="mt-0.5 text-[11px] opacity-80">{contextLabel(conflict)}</p>
            </div>
            {onDismiss ? (
              <button
                type="button"
                className="shrink-0 text-[11px] opacity-75 hover:opacity-100"
                onClick={() => onDismiss(conflict.id)}
              >
                Dismiss
              </button>
            ) : null}
          </div>

          <p className="mt-1 leading-relaxed opacity-90">{conflict.message}</p>

          <div className="mt-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]/40">
            <SourceRow
              label={`Most likely: ${conflict.authoritative.source}`}
              value={conflict.authoritative.value}
              score={conflict.authoritative.score}
              strong
            />
            {conflict.alternatives.slice(0, 3).map((alternative) => (
              <SourceRow
                key={`${conflict.id}-${alternative.source}`}
                label={alternative.source}
                value={alternative.value}
                score={alternative.score}
              />
            ))}
          </div>

          <p className="mt-2 leading-relaxed">{conflict.recommendation}</p>
          <p className="mt-1 text-[10px] opacity-70">{conflict.authoritative.reason}</p>

          {conflict.actionRequired && onAction ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="coop-text-btn"
                onClick={() => onAction(conflict.id, "accept-authoritative")}
              >
                Accept Source
              </button>
              <button
                type="button"
                className="coop-text-btn"
                onClick={() => onAction(conflict.id, "escalate")}
              >
                Escalate
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SourceRow({
  label,
  value,
  score,
  strong
}: {
  label: string;
  value: unknown;
  score: number;
  strong?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-[var(--vscode-widget-border)] px-2 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <p className={strong ? "font-medium" : "opacity-85"}>{label}</p>
        <p className="truncate text-[11px] opacity-70">{formatValue(value)}</p>
      </div>
      <span className="shrink-0 text-[10px] opacity-70">{Math.round(score)}</span>
    </div>
  );
}

function contextLabel(conflict: ConflictSummary): string {
  const location = conflict.file ?? conflict.repoId;
  return location ? `${conflict.type} · ${location}` : conflict.type;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(formatValue).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value ?? "unknown");
}

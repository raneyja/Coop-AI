import React from "react";
import type { ConflictActionId, ConflictResolutionState, ConflictSummary } from "./types";
import {
  IntegrationResultActions,
  IntegrationResultCard,
  IntegrationResultNested,
  IntegrationResultSection,
  IntegrationResultStack,
  IntegrationResultText
} from "./components/IntegrationResultCard";

type ConflictResolutionProps = {
  state?: ConflictResolutionState;
  onDismiss?: (conflictId: string) => void;
  onAction?: (conflictId: string, action: ConflictActionId) => void;
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
    <IntegrationResultStack>
      {visible.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          onDismiss={onDismiss}
          onAction={onAction}
        />
      ))}
      {remaining > 0 ? (
        <IntegrationResultText muted>
          {remaining} more conflict{remaining === 1 ? "" : "s"} hidden.
        </IntegrationResultText>
      ) : null}
    </IntegrationResultStack>
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
  const role = conflict.severity === "high" || conflict.severity === "critical" ? "alert" : "status";
  const statusTone =
    conflict.severity === "critical" || conflict.severity === "high"
      ? "warning"
      : conflict.severity === "medium"
        ? "partial"
        : "default";

  return (
    <IntegrationResultCard
      title={conflict.title}
      meta={contextLabel(conflict)}
      status={conflict.severity}
      statusTone={statusTone}
      onDismiss={onDismiss ? () => onDismiss(conflict.id) : undefined}
      ariaLabel={`Source conflict: ${conflict.title}`}
    >
      <IntegrationResultSection>
        <div role={role} aria-live={role === "alert" ? "assertive" : "polite"}>
          <IntegrationResultText>{conflict.message}</IntegrationResultText>

          <IntegrationResultNested className="mt-2">
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
        </IntegrationResultNested>

        <IntegrationResultText>{conflict.recommendation}</IntegrationResultText>
        <IntegrationResultText muted>{conflict.authoritative.reason}</IntegrationResultText>

        {conflict.actionRequired && onAction ? (
          <IntegrationResultActions>
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => onAction(conflict.id, "accept-authoritative")}
            >
              Accept source
            </button>
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => onAction(conflict.id, "escalate")}
            >
              Escalate
            </button>
          </IntegrationResultActions>
        ) : null}
        </div>
      </IntegrationResultSection>
    </IntegrationResultCard>
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
    <div className="flex items-start justify-between gap-2 border-b border-[var(--coop-settings-divider)] py-1.5 last:border-b-0">
      <div className="min-w-0">
        <p className={strong ? "font-medium" : "text-[var(--coop-panel-muted)]"}>{label}</p>
        <p className="truncate text-[11px] text-[var(--coop-panel-muted)]">{formatValue(value)}</p>
      </div>
      <span className="shrink-0 text-[10px] text-[var(--coop-panel-muted)]">{Math.round(score)}</span>
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

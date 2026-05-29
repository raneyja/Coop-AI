import React from "react";

export type AutocompleteBadgeStatus = "disabled" | "ready" | "processing" | "error";

export type AutocompleteStatusProps = {
  status: AutocompleteBadgeStatus;
  message?: string;
  onToggle?: () => void;
};

const STATUS_COLORS: Record<AutocompleteBadgeStatus, string> = {
  ready: "var(--vscode-testing-iconPassed, #3fb950)",
  processing: "var(--vscode-editorWarning-foreground, #d29922)",
  error: "var(--vscode-errorForeground, #f85149)",
  disabled: "var(--vscode-disabledForeground, #8b949e)"
};

const STATUS_LABELS: Record<AutocompleteBadgeStatus, string> = {
  ready: "Coop · ready",
  processing: "Coop · thinking",
  error: "Coop · error",
  disabled: "Coop · off"
};

/**
 * Compact status badge for the Coop sidebar (autocomplete on/off and request state).
 */
export function AutocompleteStatus({
  status,
  message,
  onToggle
}: AutocompleteStatusProps): React.ReactElement {
  const title = message ? `${STATUS_LABELS[status]} — ${message}` : STATUS_LABELS[status];

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-90"
      style={{
        borderColor: "var(--vscode-widget-border)",
        background: "var(--vscode-badge-background)",
        color: "var(--vscode-badge-foreground)"
      }}
      title={title}
      onClick={onToggle}
      aria-label={title}
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: STATUS_COLORS[status] }}
        aria-hidden
      />
      <span>{STATUS_LABELS[status]}</span>
    </button>
  );
}

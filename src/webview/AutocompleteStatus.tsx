import React from "react";

export type AutocompleteBadgeStatus = "disabled" | "ready" | "processing" | "error";

export type AutocompleteStatusProps = {
  status: AutocompleteBadgeStatus;
  message?: string;
  onToggle?: () => void;
};

const AUTOCOMPLETE_DESCRIPTION =
  "Ghost-text suggestions at the cursor while you type. Tab to accept · Escape to dismiss · Alt+] / Alt+[ cycle alternatives · Cmd+Shift+\\ manual trigger";

function tooltipFor(status: AutocompleteBadgeStatus, message?: string): string {
  if (status === "disabled") {
    return `Enable inline code completions in the editor.\n\n${AUTOCOMPLETE_DESCRIPTION}`;
  }
  if (status === "processing") {
    return `Fetching suggestion…\n\n${AUTOCOMPLETE_DESCRIPTION}`;
  }
  if (status === "error" && message) {
    return `${message}\n\n${AUTOCOMPLETE_DESCRIPTION}`;
  }
  return AUTOCOMPLETE_DESCRIPTION;
}

/**
 * Compact top-bar control: label + theme-aware on/off toggle.
 */
export function AutocompleteStatus({
  status,
  message,
  onToggle
}: AutocompleteStatusProps): React.ReactElement {
  const enabled = status !== "disabled";
  const tooltip = tooltipFor(status, message);

  return (
    <div className="coop-autocomplete-control" aria-live="polite">
      <span className="coop-autocomplete-label" title={tooltip}>
        Autocomplete
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "Turn autocomplete off" : "Turn autocomplete on"}
        className={`coop-autocomplete-toggle${enabled ? " coop-autocomplete-toggle--on" : ""}`}
        onClick={() => onToggle?.()}
      >
        {enabled ? "On" : "Off"}
      </button>
    </div>
  );
}

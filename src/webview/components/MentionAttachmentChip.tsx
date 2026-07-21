import React from "react";

type MentionAttachmentChipProps = {
  basename: string;
  /** Always show source — "Local Workspace" or "owner/repo". */
  sourceLabel: string;
  isLocal?: boolean;
  title?: string;
  onRemove?: () => void;
  disabled?: boolean;
};

export function MentionAttachmentChip({
  basename,
  sourceLabel,
  isLocal = false,
  title,
  onRemove,
  disabled = false
}: MentionAttachmentChipProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        isLocal
          ? "border-[var(--coop-pill-border)] bg-[var(--coop-pill-surface)]"
          : "border-[var(--coop-pill-border)] bg-[var(--coop-pill-surface)]"
      }`}
      title={title}
      data-mention-source={isLocal ? "local" : "remote"}
    >
      <span className="max-w-[140px] truncate font-medium">{basename}</span>
      <span
        className={`shrink-0 max-w-[120px] truncate text-[10px] ${
          isLocal ? "text-[var(--coop-panel-muted)]" : "text-[var(--coop-panel-muted)]"
        }`}
      >
        {sourceLabel}
      </span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${basename}`}
          disabled={disabled}
          className="text-[var(--coop-panel-muted)] hover:text-[var(--coop-panel-foreground)]"
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

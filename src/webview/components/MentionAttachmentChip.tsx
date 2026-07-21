import React from "react";

type MentionAttachmentChipProps = {
  basename: string;
  /** Always show source — "Local Workspace" or "owner/repo". */
  sourceLabel?: string;
  isLocal?: boolean;
  title?: string;
  onOpen?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
};

/** Manual @mention chips only — active editor file uses ContextScopeLabel. */
export function MentionAttachmentChip({
  basename,
  sourceLabel,
  isLocal = false,
  title,
  onOpen,
  onRemove,
  disabled = false
}: MentionAttachmentChipProps): React.ReactElement {
  const badge = isLocal ? "L" : "R";
  const openTitle = onOpen ? `${title ?? basename} — click to open in editor` : title;
  const resolvedSource = sourceLabel ?? (isLocal ? "Local Workspace" : "Remote");

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        isLocal
          ? "border-[var(--coop-pill-border)] bg-[var(--coop-pill-surface)]"
          : "border-[var(--vscode-focusBorder)]/50 bg-[var(--coop-pill-surface)]"
      }`}
      title={openTitle}
      data-mention-source={isLocal ? "local" : "remote"}
    >
      <span
        className={`shrink-0 rounded px-1 text-[10px] font-semibold leading-none ${
          isLocal
            ? "bg-[var(--coop-pill-border)]/40 text-[var(--coop-panel-muted)]"
            : "bg-[var(--vscode-focusBorder)]/25 text-[var(--coop-panel-foreground)]"
        }`}
        aria-hidden="true"
      >
        {badge}
      </span>
      {onOpen ? (
        <button
          type="button"
          disabled={disabled}
          className="inline-flex min-w-0 max-w-[220px] items-center gap-1 text-left hover:underline disabled:opacity-50"
          aria-label={`Open ${basename} in editor`}
          onClick={onOpen}
        >
          <span className="max-w-[120px] truncate font-medium">{basename}</span>
          <span className="shrink-0 max-w-[100px] truncate text-[10px] text-[var(--coop-panel-muted)]">
            {resolvedSource}
          </span>
        </button>
      ) : (
        <>
          <span className="max-w-[120px] truncate font-medium">{basename}</span>
          <span className="shrink-0 max-w-[100px] truncate text-[10px] text-[var(--coop-panel-muted)]">
            {resolvedSource}
          </span>
        </>
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${basename}`}
          disabled={disabled}
          className="text-[var(--coop-panel-muted)] hover:text-[var(--coop-panel-foreground)]"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

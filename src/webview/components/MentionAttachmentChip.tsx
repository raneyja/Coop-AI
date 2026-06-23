import React from "react";
import { LOCAL_WORKSPACE_MENTION_TITLE } from "../../chat/mentionSearchMerge";

type MentionAttachmentChipProps = {
  basename: string;
  isLocal?: boolean;
  title?: string;
  onRemove?: () => void;
  disabled?: boolean;
};

export function MentionAttachmentChip({
  basename,
  isLocal = false,
  title,
  onRemove,
  disabled = false
}: MentionAttachmentChipProps): React.ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--coop-pill-border)] bg-[var(--coop-pill-surface)] px-2 py-0.5 text-[11px]"
      title={title}
    >
      <span className="max-w-[180px] truncate">{basename}</span>
      {isLocal ? (
        <span className="shrink-0 text-[var(--coop-panel-muted)]">{LOCAL_WORKSPACE_MENTION_TITLE}</span>
      ) : null}
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

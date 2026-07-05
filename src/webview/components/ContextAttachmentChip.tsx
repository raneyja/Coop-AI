import React from "react";

export type ContextAttachmentChipProps = {
  label: string;
  detail?: string;
  estimated?: boolean;
  onRemove?: () => void;
  disabled?: boolean;
  title?: string;
};

export function ContextAttachmentChip({
  label,
  detail,
  estimated = false,
  onRemove,
  disabled = false,
  title
}: ContextAttachmentChipProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        estimated ? "opacity-75" : ""
      }`}
      style={{
        borderColor: "var(--coop-pill-border)",
        background: "var(--coop-pill-surface)"
      }}
      title={title ?? (estimated ? `${label} — estimated before send` : label)}
    >
      <span className="max-w-[160px] truncate">{label}</span>
      {detail ? <span className="shrink-0 text-[var(--coop-panel-muted)]">{detail}</span> : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
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

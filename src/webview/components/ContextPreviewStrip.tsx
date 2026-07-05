import React, { useMemo } from "react";
import type { ChatFileMention, RepoContext } from "../../chat/types";
import { buildContextPreviewChips } from "../../context/contextPreviewSummary";
import { ContextAttachmentChip } from "./ContextAttachmentChip";

type ContextPreviewStripProps = {
  context: RepoContext;
  draftMessage?: string;
  mentions?: ChatFileMention[];
  /** Hide when no implicit context (mentions still show via composer row in phase 1). */
  showEstimated?: boolean;
};

export function ContextPreviewStrip({
  context,
  draftMessage,
  mentions = [],
  showEstimated = true
}: ContextPreviewStripProps): React.ReactElement | null {
  const chips = useMemo(
    () =>
      buildContextPreviewChips({
        context,
        draftMessage,
        mentions,
        includeIndexHint: showEstimated
      }),
    [context, draftMessage, mentions, showEstimated]
  );

  const visible = showEstimated
    ? chips
    : chips.filter((chip) => chip.state === "confirmed" && chip.kind !== "index");

  if (visible.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2"
      style={{ borderColor: "var(--coop-composer-border)" }}
      aria-label="Context that will be attached when you send"
    >
      <span className="mr-0.5 shrink-0 text-[10px] uppercase tracking-wide text-[var(--coop-panel-muted)]">
        Context
      </span>
      {visible.map((chip) => (
        <ContextAttachmentChip
          key={chip.id}
          label={chip.label}
          detail={chip.detail}
          estimated={chip.state === "estimated"}
          title={
            chip.state === "estimated"
              ? `${chip.label} — may attach when you send`
              : chip.detail
                ? `${chip.label} · ${chip.detail}`
                : chip.label
          }
        />
      ))}
    </div>
  );
}

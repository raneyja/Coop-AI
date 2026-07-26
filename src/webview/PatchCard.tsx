import React from "react";
import type { PatchCardState } from "../chat/types";
import { PatchDiffView } from "./PatchDiffView";
import {
  IntegrationResultActions,
  IntegrationResultCard,
  IntegrationResultSection,
  IntegrationResultText
} from "./components/IntegrationResultCard";

type PatchCardProps = {
  state: PatchCardState;
  onApply?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
  onOpenFile?: (path: string) => void;
};

/** Split "Option 1: Extract a helper" into ordinal + short name for the card header. */
export function splitOptionLabel(label: string | undefined): { ordinal?: string; name?: string } {
  const trimmed = label?.trim();
  if (!trimmed) {
    return {};
  }
  const match = /^(Option|Alternative)\s*([0-9]+|[A-Za-z])\s*[:.\-–—)]\s*(.*)$/i.exec(trimmed);
  if (!match) {
    return { name: trimmed };
  }
  const ordinal = `${match[1]} ${match[2]}`.replace(/\s+/g, " ");
  const name = (match[3] ?? "").trim();
  return name ? { ordinal, name } : { ordinal, name: trimmed };
}

export function PatchCard({
  state,
  onApply,
  onReject,
  onUndo,
  onOpenFile
}: PatchCardProps): React.ReactElement | null {
  if (!shouldRenderPatchCard(state)) {
    return null;
  }

  const isMultiOption = (state.variantCount ?? 1) > 1;
  const optionParts = splitOptionLabel(state.variantLabel);
  const optionNumber =
    typeof state.variantIndex === "number" ? state.variantIndex + 1 : undefined;
  const optionTotal = state.variantCount;

  const statusTitle =
    state.status === "applied"
      ? "Patch applied"
      : state.status === "failed"
        ? "Patch failed"
        : state.status === "rejected"
          ? "Patch rejected"
          : state.status === "superseded"
            ? "Option not applied"
            : "Proposed edit";

  // Multi-option: bold title is the rewrite name; eyebrow carries "Option N of M".
  // Single patch: eyebrow names the kind, title is the status phrase.
  const eyebrow = isMultiOption
    ? optionNumber !== undefined && optionTotal !== undefined
      ? `Option ${optionNumber} of ${optionTotal}`
      : optionParts.ordinal ?? "Edit option"
    : "Edit";

  const title = isMultiOption
    ? optionParts.name ?? optionParts.ordinal ?? statusTitle
    : statusTitle;

  const changeSummary = `${state.fileCount} file${state.fileCount === 1 ? "" : "s"} · ${state.hunkCount} edit${state.hunkCount === 1 ? "" : "s"}`;

  const meta =
    state.status === "applied"
      ? `${state.appliedFileCount ?? state.fileCount} file${(state.appliedFileCount ?? state.fileCount) === 1 ? "" : "s"} updated`
      : state.status === "rejected"
        ? "Not applied"
        : state.status === "superseded"
          ? "Another option was applied"
          : changeSummary;

  const statusTone =
    state.status === "failed"
      ? "warning"
      : state.status === "applied"
        ? "partial"
        : state.status === "rejected" || state.status === "superseded"
          ? "minimal"
          : "default";

  const statusChip =
    state.status === "pending"
      ? "Review"
      : state.status === "rejected"
        ? "Rejected"
        : state.status === "superseded"
          ? "Superseded"
          : state.status;

  // Prefer the option's own TL;DR when present — that's the answer the user asked for.
  const reviewCopy =
    state.status === "applied"
      ? "I applied this to your workspace. Undo restores the original files."
      : state.status === "rejected"
        ? "I left this one out. Undo brings it back for review — I won't regenerate it."
        : state.status === "superseded"
          ? "You went with a different option. Undo that one to bring this back."
          : state.status === "failed"
            ? "These lines no longer match the file, so I can't apply this safely. Run /edit again and I'll rewrite it against the current code."
            : state.summary?.trim()
              ? state.summary.trim()
              : isMultiOption
                ? `Here's one way to write it — ${changeSummary}. Applying it sets the other options aside.`
                : `Here's the change I'd make — ${changeSummary}.`;

  const applyLabel = isMultiOption ? "Apply this option" : "Apply patch";

  const cardClassName = [
    "coop-patch-card",
    isMultiOption ? "coop-patch-card--option" : "",
    state.status === "superseded" ? "coop-patch-card--superseded" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <IntegrationResultCard
      eyebrow={eyebrow}
      leading={
        isMultiOption && optionNumber !== undefined ? (
          <span className="coop-patch-index" aria-hidden="true">
            {optionNumber}
          </span>
        ) : undefined
      }
      title={title}
      meta={meta}
      status={statusChip}
      statusTone={statusTone}
      ariaLabel={`Edit patch: ${title}`}
      scrollable
      className={cardClassName}
    >
      <IntegrationResultSection>
        {state.error ? (
          <IntegrationResultText muted>{state.error}</IntegrationResultText>
        ) : (
          <>
            {state.summary?.trim() && isMultiOption ? (
              <p className="coop-patch-tldr-label">Summary</p>
            ) : null}
            <IntegrationResultText className={state.summary?.trim() ? "coop-patch-tldr" : undefined}>
              {reviewCopy}
            </IntegrationResultText>
          </>
        )}
        {state.files.length > 0 ? <PatchDiffView files={state.files} onOpenFile={onOpenFile} /> : null}
        <IntegrationResultActions>
          {state.status === "pending" || state.status === "failed" ? (
            <>
              <button type="button" className="coop-settings-action-btn" onClick={onApply}>
                {applyLabel}
              </button>
              <button type="button" className="coop-text-btn" onClick={onReject}>
                Reject
              </button>
            </>
          ) : null}
          {(state.status === "applied" || state.status === "rejected") && state.canUndo !== false ? (
            <button type="button" className="coop-settings-action-btn" onClick={onUndo}>
              Undo
            </button>
          ) : null}
        </IntegrationResultActions>
      </IntegrationResultSection>
    </IntegrationResultCard>
  );
}

export function PatchOptionGroup({
  optionCount,
  children
}: {
  optionCount: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="coop-patch-option-group" aria-label={`${optionCount} edit options`}>
      <header className="coop-patch-option-group-header">
        <p className="coop-patch-option-group-title">
          {optionCount} way{optionCount === 1 ? "" : "s"} to write this
        </p>
        <p className="coop-patch-option-group-sub">
          Apply the one you want — the rest are set aside, and Undo brings them back.
        </p>
      </header>
      <div className="coop-patch-option-group-body">{children}</div>
    </section>
  );
}

export function shouldRenderPatchCard(state: PatchCardState | undefined): boolean {
  if (!state) {
    return false;
  }
  // Failed parses (e.g. options mashed into one REPLACE) have no files but must
  // still show the error so the user knows to regenerate.
  if (state.status === "failed" && state.error) {
    return true;
  }
  if (state.files.length === 0) {
    return false;
  }
  return (
    state.status === "pending" ||
    state.status === "applied" ||
    state.status === "failed" ||
    state.status === "rejected" ||
    state.status === "superseded"
  );
}

export function findPatchCardForMessage(
  cards: readonly PatchCardState[] | undefined,
  messageTimestamp: number
): PatchCardState | undefined {
  if (!cards?.length) {
    return undefined;
  }
  return cards.find((card) => card.messageTimestamp === messageTimestamp);
}

export function shouldRenderPatchCardForMessage(
  cardsOrState: readonly PatchCardState[] | PatchCardState | undefined,
  messageTimestamp: number
): boolean {
  let state: PatchCardState | undefined;
  if (!cardsOrState) {
    state = undefined;
  } else if (Array.isArray(cardsOrState)) {
    state = findPatchCardForMessage(cardsOrState, messageTimestamp);
  } else {
    const single = cardsOrState as PatchCardState;
    state =
      single.messageTimestamp === undefined || single.messageTimestamp === messageTimestamp
        ? single
        : undefined;
  }
  return shouldRenderPatchCard(state);
}

export function shouldHidePatchMarkdownForMessage(
  cardsOrState: readonly PatchCardState[] | PatchCardState | undefined,
  messageTimestamp: number,
  suppressedMessageTimestamps?: readonly number[]
): boolean {
  if (suppressedMessageTimestamps?.includes(messageTimestamp)) {
    return true;
  }

  const cards = Array.isArray(cardsOrState)
    ? cardsOrState
    : cardsOrState
      ? [cardsOrState]
      : [];

  for (const card of cards) {
    if (card.suppressedMessageTimestamps?.includes(messageTimestamp)) {
      return true;
    }
  }

  const state = findPatchCardForMessage(cards, messageTimestamp);
  if (!state) {
    return false;
  }
  if (state.suppressMarkdown) {
    return true;
  }
  return shouldRenderPatchCard(state);
}

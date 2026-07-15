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

  const title =
    state.status === "applied"
      ? "Patch applied"
      : state.status === "failed"
        ? "Patch failed"
        : state.status === "rejected"
          ? "Patch rejected"
          : "Patch ready";

  const meta =
    state.status === "applied"
      ? `${state.appliedFileCount ?? state.fileCount} file${(state.appliedFileCount ?? state.fileCount) === 1 ? "" : "s"} updated`
      : state.status === "rejected"
        ? "Not applied — Undo to review again"
        : `${state.fileCount} file${state.fileCount === 1 ? "" : "s"} · ${state.hunkCount} edit${state.hunkCount === 1 ? "" : "s"}`;

  const statusTone =
    state.status === "failed"
      ? "warning"
      : state.status === "applied"
        ? "partial"
        : state.status === "rejected"
          ? "minimal"
          : "default";

  const reviewCopy =
    state.status === "applied"
      ? "Changes are in your workspace. Undo restores the files and brings back Apply / Reject."
      : state.status === "rejected"
        ? "Rejected patches stay in this thread. Undo returns Apply / Reject without regenerating."
        : state.status === "failed"
          ? "Fix the SEARCH match or regenerate with /edit, then try again."
          : "Review the diff below, then apply changes to your workspace.";

  return (
    <IntegrationResultCard
      title={title}
      meta={meta}
      status={state.status === "pending" ? "Review" : state.status === "rejected" ? "Rejected" : state.status}
      statusTone={statusTone}
      ariaLabel={`Edit patch: ${title}`}
      scrollable
      className="coop-patch-card"
    >
      <IntegrationResultSection>
        {state.error ? (
          <IntegrationResultText muted>{state.error}</IntegrationResultText>
        ) : (
          <IntegrationResultText muted>{reviewCopy}</IntegrationResultText>
        )}
        {state.files.length > 0 ? <PatchDiffView files={state.files} onOpenFile={onOpenFile} /> : null}
        <IntegrationResultActions>
          {state.status === "pending" || state.status === "failed" ? (
            <>
              <button type="button" className="coop-settings-action-btn" onClick={onApply}>
                Apply patch
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

export function shouldRenderPatchCard(state: PatchCardState | undefined): boolean {
  if (!state || state.files.length === 0) {
    return false;
  }
  return (
    state.status === "pending" ||
    state.status === "applied" ||
    state.status === "failed" ||
    state.status === "rejected"
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

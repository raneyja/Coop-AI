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
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
};

function pendingEditCount(state: PatchCardState): number {
  return state.files.reduce(
    (sum, file) => sum + file.hunks.filter((hunk) => (hunk.status ?? "pending") === "pending").length,
    0
  );
}

export function PatchCard({
  state,
  onApply,
  onReject,
  onUndo,
  onOpenFile,
  onApplyHunk,
  onRejectHunk
}: PatchCardProps): React.ReactElement | null {
  if (!shouldRenderPatchCard(state)) {
    return null;
  }

  const pending = pendingEditCount(state);
  const multiEdit = state.hunkCount > 1;

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
        : `${state.fileCount} file${state.fileCount === 1 ? "" : "s"} · ${state.hunkCount} edit${state.hunkCount === 1 ? "" : "s"}${
            pending < state.hunkCount ? ` · ${pending} remaining` : ""
          }`;

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
          : multiEdit
            ? "Review each edit below — Apply or Reject individually, or apply all remaining."
            : "Review the diff below, then apply changes to your workspace.";

  const showBulkActions = (state.status === "pending" || state.status === "failed") && pending > 1;
  const showSingleActions =
    (state.status === "pending" || state.status === "failed") && pending === 1;
  // Per-hunk buttons only when there are multiple edits — avoids Apply/Reject twice for one hunk.
  const showHunkActions =
    multiEdit && (state.status === "pending" || state.status === "failed");

  return (
    <IntegrationResultCard
      title={title}
      meta={meta}
      status={state.status === "pending" ? "Review" : state.status === "rejected" ? "Rejected" : state.status}
      statusTone={statusTone}
      ariaLabel={`Edit patch: ${title}`}
      className="coop-patch-card"
    >
      <IntegrationResultSection className="coop-patch-card-section">
        {state.error ? (
          <IntegrationResultText muted>{state.error}</IntegrationResultText>
        ) : (
          <IntegrationResultText muted>{reviewCopy}</IntegrationResultText>
        )}
        {state.files.length > 0 ? (
          <div className="coop-patch-diff-scroll">
            <PatchDiffView
              files={state.files}
              onOpenFile={onOpenFile}
              onApplyHunk={showHunkActions ? onApplyHunk : undefined}
              onRejectHunk={showHunkActions ? onRejectHunk : undefined}
            />
          </div>
        ) : null}
        <IntegrationResultActions>
          {showBulkActions ? (
            <>
              <button type="button" className="coop-settings-action-btn" onClick={onApply}>
                Apply all
              </button>
              <button type="button" className="coop-text-btn" onClick={onReject}>
                Reject all
              </button>
            </>
          ) : null}
          {showSingleActions ? (
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
          {(showBulkActions || showSingleActions) && state.canUndo ? (
            <button type="button" className="coop-text-btn" onClick={onUndo}>
              Undo applied
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

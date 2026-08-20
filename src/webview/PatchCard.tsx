import React, { useEffect, useMemo, useState } from "react";
import type { CodeHostProviderPreference, PatchCardState, PatchPreviewHunk } from "../chat/types";
import { PatchDiffView } from "./PatchDiffView";
import { CreatePullRequestModal } from "./components/CreatePullRequestModal";
import {
  IntegrationResultActions,
  IntegrationResultCard,
  IntegrationResultSection,
  IntegrationResultText
} from "./components/IntegrationResultCard";
import {
  CREATE_PULL_REQUEST_BUTTON_CLASS,
  CREATE_PULL_REQUEST_BUTTON_LABEL,
  createConfirmSubmitGuard,
  defaultPrBranchName,
  defaultPrTitle,
  filesWithContent,
  type CreatePullRequestCreated,
  type CreatePullRequestDraft
} from "./createPullRequestConfirm";

type PatchCardProps = {
  state: PatchCardState;
  codeHostProvider?: CodeHostProviderPreference;
  defaultBranch?: string;
  onApply?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
  onOpenFile?: (path: string) => void;
  onApplyHunk?: (hunkId: string) => void;
  onRejectHunk?: (hunkId: string) => void;
  onToggleMatchLocation?: (hunkId: string, locationId: string, selected: boolean) => void;
  onSelectSharedProposal?: (
    relativePath: string,
    groupId: string,
    locationId: string,
    proposalId: string | null
  ) => void;
  onCreatePullRequest?: (draft: CreatePullRequestDraft) => void | Promise<void>;
  onRequestPrNotes?: () => void;
  onOpenPrLink?: (url: string) => void;
  onClearPrResult?: () => void;
  prNotesLoading?: boolean;
  generatedPrNotes?: string;
  prCreated?: CreatePullRequestCreated;
  prCreateError?: string;
};

function pendingEditCount(state: PatchCardState): number {
  return state.files.reduce(
    (sum, file) => sum + file.hunks.filter((hunk) => (hunk.status ?? "pending") === "pending").length,
    0
  );
}

function hunkReadyToApply(state: PatchCardState, hunk: PatchPreviewHunk): boolean {
  if ((hunk.status ?? "pending") !== "pending") {
    return false;
  }
  if (hunk.matchStatus === "not_found") {
    return false;
  }
  if (hunk.resolvedMatchIndices?.length || hunk.matchStatus === "matched") {
    return true;
  }
  const file = state.files.find((entry) => entry.hunks.some((item) => item.id === hunk.id));
  const sharedGroup = file?.sharedMatchGroups?.find((group) => group.hunkIds.includes(hunk.id));
  if (sharedGroup) {
    return sharedGroup.locations.some(
      (location) =>
        location.selectedProposalId &&
        location.proposals.some(
          (proposal) => proposal.id === location.selectedProposalId && proposal.hunkId === hunk.id
        )
    );
  }
  if (hunk.matchStatus === "ambiguous") {
    return hunk.matchLocations?.some((loc) => loc.selected) ?? false;
  }
  return false;
}

function cardHasAmbiguousPending(state: PatchCardState): boolean {
  for (const file of state.files) {
    for (const group of file.sharedMatchGroups ?? []) {
      if (
        group.hunkIds.some((hunkId) => {
          const hunk = file.hunks.find((entry) => entry.id === hunkId);
          return (hunk?.status ?? "pending") === "pending";
        })
      ) {
        return true;
      }
    }
  }
  return state.files.some((file) =>
    file.hunks.some(
      (hunk) =>
        (hunk.status ?? "pending") === "pending" &&
        hunk.matchStatus === "ambiguous" &&
        (hunk.matchLocations?.length ?? 0) > 1
    )
  );
}

export function PatchCard({
  state,
  codeHostProvider,
  defaultBranch,
  onApply,
  onReject,
  onUndo,
  onOpenFile,
  onApplyHunk,
  onRejectHunk,
  onToggleMatchLocation,
  onSelectSharedProposal,
  onCreatePullRequest,
  onRequestPrNotes,
  onOpenPrLink,
  onClearPrResult,
  prNotesLoading,
  generatedPrNotes,
  prCreated,
  prCreateError
}: PatchCardProps): React.ReactElement | null {
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [prSubmitting, setPrSubmitting] = useState(false);
  const [prError, setPrError] = useState<string | undefined>();
  const submitGuard = useMemo(() => createConfirmSubmitGuard(), []);
  const prFiles = filesWithContent(state.prFiles);

  useEffect(() => {
    if (!prCreated?.htmlUrl) {
      return;
    }
    setPrSubmitting(false);
  }, [prCreated?.htmlUrl]);

  useEffect(() => {
    if (!prCreateError) {
      return;
    }
    setPrSubmitting(false);
    setPrError(prCreateError);
  }, [prCreateError]);

  if (!shouldRenderPatchCard(state)) {
    return null;
  }

  const pending = pendingEditCount(state);
  const multiEdit = state.hunkCount > 1;
  const hasAmbiguous = cardHasAmbiguousPending(state);
  const readyPending = state.files
    .flatMap((file) => file.hunks)
    .filter((hunk) => hunkReadyToApply(state, hunk)).length;

  const title =
    state.status === "applied"
      ? "Patch applied"
      : state.status === "failed"
        ? "Patch failed"
        : state.status === "rejected"
          ? "Patch rejected"
          : hasAmbiguous
            ? "Choose locations"
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
          : hasAmbiguous
            ? "warning"
            : "default";

  const reviewCopy =
    state.status === "applied"
      ? "Changes are in your workspace. Create a pull request, or Undo to restore Apply / Reject."
      : state.status === "rejected"
        ? "Rejected patches stay in this thread. Undo returns Apply / Reject without regenerating."
        : state.status === "failed"
          ? "Select match locations or regenerate with /edit, then try again."
          : hasAmbiguous
            ? "This edit matches multiple places — select one or more options below, then Apply."
            : multiEdit
              ? "Review each edit below — Apply or Reject individually, or apply all remaining."
              : "Review the diff below, then apply changes to your workspace.";

  const showBulkActions = (state.status === "pending" || state.status === "failed") && pending > 1;
  const showSingleActions =
    (state.status === "pending" || state.status === "failed") && pending === 1;
  // Per-hunk buttons only when there are multiple edits — avoids Apply/Reject twice for one hunk.
  const showHunkActions =
    multiEdit && (state.status === "pending" || state.status === "failed");

  const applyDisabled = readyPending === 0;

  return (
    <IntegrationResultCard
      title={title}
      meta={meta}
      status={
        state.status === "pending"
          ? hasAmbiguous
            ? "Choose"
            : "Review"
          : state.status === "rejected"
            ? "Rejected"
            : state.status
      }
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
              onToggleMatchLocation={
                state.status === "pending" || state.status === "failed"
                  ? onToggleMatchLocation
                  : undefined
              }
              onSelectSharedProposal={
                state.status === "pending" || state.status === "failed"
                  ? onSelectSharedProposal
                  : undefined
              }
            />
          </div>
        ) : null}
        <IntegrationResultActions>
          {showBulkActions ? (
            <>
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={onApply}
                disabled={applyDisabled}
              >
                Apply all{readyPending > 0 && readyPending < pending ? ` (${readyPending})` : ""}
              </button>
              <button type="button" className="coop-text-btn" onClick={onReject}>
                Reject all
              </button>
            </>
          ) : null}
          {showSingleActions ? (
            <>
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={onApply}
                disabled={applyDisabled}
              >
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
          {showCreatePullRequestButton(state) ? (
            <CreatePullRequestButton
              onClick={() => {
                setPrError(undefined);
                onClearPrResult?.();
                setPrModalOpen(true);
                onRequestPrNotes?.();
              }}
            />
          ) : null}
          {(showBulkActions || showSingleActions) && state.canUndo ? (
            <button type="button" className="coop-text-btn" onClick={onUndo}>
              Undo applied
            </button>
          ) : null}
        </IntegrationResultActions>
      </IntegrationResultSection>
      <CreatePullRequestModal
        open={prModalOpen}
        provider={codeHostProvider}
        branch={defaultPrBranchName()}
        title={defaultPrTitle(prFiles.map((file) => file.path))}
        files={prFiles}
        submitting={prSubmitting}
        error={prError}
        notesLoading={prNotesLoading}
        generatedNotes={generatedPrNotes}
        created={prCreated}
        onOpenLink={onOpenPrLink}
        onClose={() => {
          if (!prSubmitting) {
            setPrModalOpen(false);
            onClearPrResult?.();
          }
        }}
        onConfirm={(draft) => {
          void submitGuard(async () => {
            setPrSubmitting(true);
            setPrError(undefined);
            try {
              await onCreatePullRequest?.({ ...draft, base: defaultBranch, provider: codeHostProvider });
            } catch (error) {
              setPrError(error instanceof Error ? error.message : "Could not create the pull request.");
              setPrSubmitting(false);
            }
          });
        }}
      />
    </IntegrationResultCard>
  );
}

function CreatePullRequestButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button type="button" className={CREATE_PULL_REQUEST_BUTTON_CLASS} onClick={onClick}>
      {CREATE_PULL_REQUEST_BUTTON_LABEL}
    </button>
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

/** UX-G4: one quiet Create PR after Apply — not on the pending Apply/Reject row. */
export function showCreatePullRequestButton(state: PatchCardState): boolean {
  if (state.status !== "applied") {
    return false;
  }
  if (state.canCreatePr === true) {
    return true;
  }
  return (state.prFiles ?? []).some((file) => file.path.trim() && file.content.length > 0);
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

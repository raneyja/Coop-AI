import * as vscode from "vscode";
import {
  buildPatchCardState,
  deriveCardStatusFromHunks,
  hunkNeedsMatchSelection,
  hunkReadyToApply,
  PATCH_CARD_IDLE,
  pendingHunkIds,
  selectedMatchIndicesForHunk,
  setHunkMatchLocationsOnCard,
  setHunkStatusOnCard,
  setSharedMatchProposalOnCard,
  sharedMatchIndicesForHunk,
  withSuppressionRegistry
} from "./patchDiffPreview";
import { emitPatchEvent } from "./patchEvents";
import { locateHunkById, type ParsedPatchSet } from "./patchParser";
import {
  applyPatchesToWorkspace,
  matchIndicesKey,
  undoPatchApplication,
  type FileUndoSnapshot
} from "./patchApplier";
import { applyHunksToContent } from "./patchContent";
import { lookupPatchFileContent } from "./patchFileContents";
import {
  findOpenDocumentForPatchFile,
  resolveEditablePatchTarget,
  uriFromUndoSnapshotPath
} from "./patchTarget";
import { pathsReferToSameFile } from "../context/githubVfsUri";
import {
  getPatchRecord,
  listPatchCards,
  resolveActivePatchTimestamp,
  setLastPatchApplyError,
  setPatchRecordUndo,
  updatePatchRecordCard,
  upsertPatchRecord
} from "./patchSession";
import type { PatchCardState, PatchCardsUpdatePayload, PatchPreviewHunk } from "../chat/types";

export type PatchSnapshotPublisher = (payload: PatchCardsUpdatePayload) => void;

function snapshotPayload(activeMessageTimestamp?: number): PatchCardsUpdatePayload {
  return withCardsSuppression({
    cards: listPatchCards(),
    activeMessageTimestamp
  });
}

function withCardsSuppression(payload: PatchCardsUpdatePayload): PatchCardsUpdatePayload {
  const stamps = payload.cards
    .map((card) => card.messageTimestamp)
    .filter((value): value is number => typeof value === "number");
  return {
    ...payload,
    cards: payload.cards.map((card) =>
      withSuppressionRegistry({
        ...card,
        suppressMarkdown: true,
        suppressedMessageTimestamps: stamps
      })
    ),
    suppressedMessageTimestamps: stamps
  };
}

function publishSnapshot(
  publish: PatchSnapshotPublisher | undefined,
  activeMessageTimestamp?: number
): void {
  publish?.(snapshotPayload(activeMessageTimestamp));
}

export function resolvePatchCardsSnapshot(): PatchCardsUpdatePayload {
  return snapshotPayload(resolveActivePatchTimestamp());
}

/** @deprecated Prefer resolvePatchCardsSnapshot — kept for one-card callers. */
export function resolvePatchCardStateForSession(): PatchCardState {
  const cards = listPatchCards();
  const active = resolveActivePatchTimestamp();
  const live = cards.find((card) => card.messageTimestamp === active) ?? cards[cards.length - 1];
  return live ? withSuppressionRegistry(live) : withSuppressionRegistry(PATCH_CARD_IDLE);
}

function findPreviewHunk(
  card: PatchCardState,
  hunkId: string
): { hunk: PatchPreviewHunk; file: PatchCardState["files"][number] } | undefined {
  for (const file of card.files) {
    const hunk = file.hunks.find((entry) => entry.id === hunkId);
    if (hunk) {
      return { hunk, file };
    }
  }
  return undefined;
}

function matchIndicesForPreviewHunk(
  located: { hunk: PatchPreviewHunk; file: PatchCardState["files"][number] }
): number[] {
  const shared = sharedMatchIndicesForHunk(located.file, located.hunk.id);
  if (shared !== undefined) {
    return shared;
  }
  return selectedMatchIndicesForHunk(located.hunk);
}

function patchSetForHunkIds(patches: ParsedPatchSet, hunkIds: string[]): ParsedPatchSet | undefined {
  const files: ParsedPatchSet["files"] = [];
  for (const hunkId of hunkIds) {
    const located = locateHunkById(patches, hunkId);
    if (!located) {
      return undefined;
    }
    const existing = files.find((file) => file.relativePath === located.file.relativePath);
    if (existing) {
      existing.hunks.push(located.hunk);
    } else {
      files.push({ relativePath: located.file.relativePath, hunks: [located.hunk] });
    }
  }
  return files.length > 0 ? { files } : undefined;
}

function buildMatchIndicesForHunkIds(
  card: PatchCardState,
  patches: ParsedPatchSet,
  hunkIds: string[]
): { ok: true; matchIndicesByFileHunk: Record<string, number[]> } | { ok: false; error: string } {
  const matchIndicesByFileHunk: Record<string, number[]> = {};
  const subsetIndexByPath = new Map<string, number>();

  for (const hunkId of hunkIds) {
    const located = locateHunkById(patches, hunkId);
    const preview = findPreviewHunk(card, hunkId);
    if (!located || !preview) {
      return { ok: false, error: "Could not find that edit in the patch." };
    }

    const path = located.file.relativePath;
    const subsetIndex = subsetIndexByPath.get(path) ?? 0;
    subsetIndexByPath.set(path, subsetIndex + 1);

    if (preview.hunk.matchStatus === "not_found") {
      return {
        ok: false,
        error: `${path}: SEARCH block not found in file`
      };
    }

    const indices = matchIndicesForPreviewHunk(preview);
    const needsIndices =
      Boolean(preview.hunk.resolvedMatchIndices?.length) ||
      preview.hunk.matchStatus === "ambiguous" ||
      Boolean(preview.file.sharedMatchGroups?.some((group) => group.hunkIds.includes(hunkId)));

    if (needsIndices) {
      if (indices.length === 0) {
        return {
          ok: false,
          error: `${path}: SEARCH block matches multiple locations — select where to apply`
        };
      }
      matchIndicesByFileHunk[matchIndicesKey(path, subsetIndex)] = indices;
    }
  }

  return { ok: true, matchIndicesByFileHunk };
}

function applyMatchSelectionsToCard(
  card: PatchCardState,
  matchSelections?: Readonly<Record<string, readonly string[]>>
): PatchCardState {
  if (!matchSelections) {
    return card;
  }
  let next = card;
  for (const [hunkId, locationIds] of Object.entries(matchSelections)) {
    next = setHunkMatchLocationsOnCard(next, hunkId, locationIds);
  }
  return next;
}

function mergeUndoSnapshots(
  existing: FileUndoSnapshot[] | undefined,
  next: FileUndoSnapshot[]
): FileUndoSnapshot[] {
  const byPath = new Map<string, FileUndoSnapshot>();
  for (const snap of existing ?? []) {
    byPath.set(snap.absolutePath, snap);
  }
  for (const snap of next) {
    // Keep the earliest original content for a file so Undo restores pre-any-hunk state.
    if (!byPath.has(snap.absolutePath)) {
      byPath.set(snap.absolutePath, snap);
    }
  }
  return [...byPath.values()];
}

function finalizeCardAfterHunkUpdate(
  card: PatchCardState,
  extras?: { appliedFiles?: Array<{ path: string; content: string }> }
): PatchCardState {
  const status = deriveCardStatusFromHunks(card);
  const next: PatchCardState = {
    ...card,
    status,
    canUndo:
      status === "applied" ||
      status === "rejected" ||
      card.files.some((file) => file.hunks.some((hunk) => hunk.status === "applied")),
    appliedFileCount:
      status === "applied"
        ? new Set(
            card.files
              .filter((file) => file.hunks.some((hunk) => hunk.status === "applied"))
              .map((file) => file.relativePath)
          ).size
        : undefined,
    error: undefined,
    suppressMarkdown: true
  };
  return withCreatePrState(next, extras?.appliedFiles);
}

/** After Apply, attach live buffer contents so Create PR can commit without a clone. */
export function collectAppliedPrFiles(card: PatchCardState): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const record = getPatchRecord(card.messageTimestamp);
  for (const file of card.files) {
    if (!file.hunks.some((hunk) => hunk.status === "applied")) {
      continue;
    }
    const content = readAppliedFileContent(file.relativePath, record);
    if (typeof content === "string" && content.length > 0) {
      files.push({ path: file.relativePath, content });
    }
  }
  return files;
}

function readAppliedFileContent(
  relativePath: string,
  record: ReturnType<typeof getPatchRecord>
): string | undefined {
  const live = resolveEditablePatchTarget(relativePath)?.readText();
  if (live?.trim()) {
    return live;
  }

  const captured = lookupPatchFileContent(relativePath, record?.fileContents);
  const filePatch = record?.patches.files.find((entry) =>
    pathsReferToSameFile(entry.relativePath, relativePath)
  );
  const fromOpen = findOpenDocumentForPatchFile(relativePath, {
    capturedContent: captured,
    search: filePatch?.hunks[0]?.search
  })?.getText();
  if (fromOpen?.trim()) {
    return fromOpen;
  }

  for (const snap of record?.undo ?? []) {
    if (!pathsReferToSameFile(snap.relativePath, relativePath)) {
      continue;
    }
    const uri = uriFromUndoSnapshotPath(snap.absolutePath);
    const doc = vscode.workspace.textDocuments.find(
      (open) =>
        open.uri.toString() === uri.toString() ||
        open.uri.toString() === snap.absolutePath ||
        (uri.scheme === "untitled" &&
          open.uri.scheme === "untitled" &&
          open.uri.path.replace(/^\/+/, "") === uri.path.replace(/^\/+/, ""))
    );
    if (doc?.getText().trim()) {
      return doc.getText();
    }
  }

  const original =
    captured ??
    record?.undo?.find((snap) => pathsReferToSameFile(snap.relativePath, relativePath))?.originalContent;
  if (original && filePatch?.hunks.length) {
    const applied = applyHunksToContent(original, filePatch.hunks);
    if (applied.ok && applied.content.trim()) {
      return applied.content;
    }
  }
  return undefined;
}

function withCreatePrState(
  card: PatchCardState,
  appliedFiles?: Array<{ path: string; content: string }>
): PatchCardState {
  if (card.status !== "applied") {
    return { ...card, canCreatePr: false, prFiles: undefined };
  }
  const fromApply = (appliedFiles ?? []).filter(
    (file) => file.path.trim() && file.content.length > 0
  );
  const prFiles = fromApply.length > 0 ? fromApply : collectAppliedPrFiles(card);
  return { ...card, prFiles, canCreatePr: prFiles.length > 0 };
}

export function setPendingPatchMatchLocations(
  publish: PatchSnapshotPublisher | undefined,
  messageTimestamp: number | undefined,
  hunkId: string,
  locationIds: readonly string[]
): void {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  const record = getPatchRecord(timestamp);
  if (!record || timestamp === undefined) {
    publishSnapshot(publish);
    return;
  }

  if (record.card.status !== "pending" && record.card.status !== "failed") {
    publishSnapshot(publish, timestamp);
    return;
  }

  const next = setHunkMatchLocationsOnCard(record.card, hunkId, locationIds);
  updatePatchRecordCard(timestamp, { ...next, status: "pending", suppressMarkdown: true });
  publishSnapshot(publish, timestamp);
}

export function setPendingSharedMatchProposal(
  publish: PatchSnapshotPublisher | undefined,
  messageTimestamp: number | undefined,
  relativePath: string,
  groupId: string,
  locationId: string,
  proposalId: string | null | undefined
): void {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  const record = getPatchRecord(timestamp);
  if (!record || timestamp === undefined) {
    publishSnapshot(publish);
    return;
  }

  if (record.card.status !== "pending" && record.card.status !== "failed") {
    publishSnapshot(publish, timestamp);
    return;
  }

  const next = setSharedMatchProposalOnCard(
    record.card,
    relativePath,
    groupId,
    locationId,
    proposalId
  );
  updatePatchRecordCard(timestamp, { ...next, status: "pending", suppressMarkdown: true });
  publishSnapshot(publish, timestamp);
}

export async function applyPendingPatch(
  publish?: PatchSnapshotPublisher,
  messageTimestamp?: number,
  matchSelections?: Readonly<Record<string, readonly string[]>>
): Promise<boolean> {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  const record = getPatchRecord(timestamp);
  if (!record || timestamp === undefined) {
    void vscode.window.showWarningMessage("No patch is pending. Use /edit in chat to generate one.");
    publishSnapshot(publish);
    return false;
  }

  if (record.card.status !== "pending" && record.card.status !== "failed") {
    void vscode.window.showWarningMessage("This patch is not waiting for Apply. Use Undo first if needed.");
    publishSnapshot(publish, timestamp);
    return false;
  }

  let card = applyMatchSelectionsToCard(record.card, matchSelections);
  if (matchSelections) {
    updatePatchRecordCard(timestamp, { ...card, status: "pending", suppressMarkdown: true });
  }

  const ids = pendingHunkIds(card);
  if (ids.length === 0) {
    void vscode.window.showWarningMessage("No pending edits left to apply.");
    publishSnapshot(publish, timestamp);
    return false;
  }

  const readyIds = ids.filter((hunkId) => {
    const located = findPreviewHunk(card, hunkId);
    return located ? hunkReadyToApply(located.hunk, located.file) : false;
  });
  const needingSelection = ids.filter((hunkId) => {
    const located = findPreviewHunk(card, hunkId);
    return located ? hunkNeedsMatchSelection(located.hunk, located.file) : false;
  });

  if (readyIds.length === 0) {
    const message =
      needingSelection.length > 0
        ? "This edit matches multiple places — select one or more locations, then Apply."
        : "No pending edits left to apply.";
    void vscode.window.showWarningMessage(message);
    updatePatchRecordCard(timestamp, {
      ...card,
      status: needingSelection.length > 0 ? "pending" : card.status,
      error: needingSelection.length > 0 ? message : card.error,
      suppressMarkdown: true
    });
    publishSnapshot(publish, timestamp);
    return false;
  }

  return applyPendingPatchHunks(publish, timestamp, readyIds);
}

export async function applyPendingPatchHunk(
  publish: PatchSnapshotPublisher | undefined,
  messageTimestamp: number | undefined,
  hunkId: string,
  matchLocationIds?: readonly string[]
): Promise<boolean> {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  if (timestamp === undefined) {
    void vscode.window.showWarningMessage("No patch is pending. Use /edit in chat to generate one.");
    publishSnapshot(publish);
    return false;
  }

  const record = getPatchRecord(timestamp);
  if (!record) {
    void vscode.window.showWarningMessage("No patch is pending. Use /edit in chat to generate one.");
    publishSnapshot(publish);
    return false;
  }

  if (matchLocationIds) {
    const next = setHunkMatchLocationsOnCard(record.card, hunkId, matchLocationIds);
    updatePatchRecordCard(timestamp, { ...next, status: "pending", suppressMarkdown: true });
  }

  return applyPendingPatchHunks(publish, timestamp, [hunkId]);
}

async function applyPendingPatchHunks(
  publish: PatchSnapshotPublisher | undefined,
  timestamp: number,
  hunkIds: string[]
): Promise<boolean> {
  const record = getPatchRecord(timestamp);
  if (!record) {
    void vscode.window.showWarningMessage("No patch is pending. Use /edit in chat to generate one.");
    publishSnapshot(publish);
    return false;
  }

  const subset = patchSetForHunkIds(record.patches, hunkIds);
  if (!subset) {
    void vscode.window.showWarningMessage("Could not find that edit in the patch.");
    publishSnapshot(publish, timestamp);
    return false;
  }

  const selections = buildMatchIndicesForHunkIds(record.card, record.patches, hunkIds);
  if (!selections.ok) {
    setLastPatchApplyError(selections.error);
    emitPatchEvent("edit.patch_failed", { phase: "apply", error: selections.error });
    const failed: PatchCardState = {
      ...record.card,
      status: "failed",
      error: selections.error,
      suppressMarkdown: true,
      canUndo: Boolean(record.undo?.length)
    };
    updatePatchRecordCard(timestamp, failed);
    publishSnapshot(publish, timestamp);
    void vscode.window.showErrorMessage(`CoopAI: Patch failed — ${selections.error}`);
    return false;
  }

  const preview = buildPatchCardState(record.patches, {
    status: "pending",
    messageTimestamp: timestamp,
    previousFiles: record.card.files,
    fileContents: record.fileContents
  });

  const result = await applyPatchesToWorkspace(subset, {
    matchIndicesByFileHunk: selections.matchIndicesByFileHunk,
    fileContents: record.fileContents
  });
  if (!result.ok) {
    setLastPatchApplyError(result.error);
    emitPatchEvent("edit.patch_failed", { phase: "apply", error: result.error, file: result.file });
    const failed: PatchCardState = {
      ...preview,
      status: "failed",
      error: result.error,
      suppressMarkdown: true,
      canUndo: Boolean(record.undo?.length)
    };
    updatePatchRecordCard(timestamp, failed);
    publishSnapshot(publish, timestamp);
    void vscode.window.showErrorMessage(`CoopAI: Patch failed — ${result.error}`);
    return false;
  }

  setLastPatchApplyError(undefined);
  setPatchRecordUndo(timestamp, mergeUndoSnapshots(record.undo, result.undo));

  let nextCard = preview;
  for (const hunkId of hunkIds) {
    nextCard = setHunkStatusOnCard(nextCard, hunkId, "applied");
  }
  nextCard = finalizeCardAfterHunkUpdate(nextCard, { appliedFiles: result.appliedFiles });

  if (pendingHunkIds(nextCard).length === 0) {
    void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);
  }

  emitPatchEvent("edit.patch_applied", {
    fileCount: result.filesChanged,
    hunkCount: hunkIds.length
  });

  updatePatchRecordCard(timestamp, nextCard);
  publishSnapshot(publish, timestamp);
  void vscode.window.showInformationMessage(
    result.usedRemoteEditor
      ? `CoopAI: Applied ${hunkIds.length} edit${hunkIds.length === 1 ? "" : "s"} to open file${result.filesChanged === 1 ? "" : "s"} (save/commit in the editor if needed).`
      : `CoopAI: Applied ${hunkIds.length} edit${hunkIds.length === 1 ? "" : "s"} (${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"}).`
  );
  return true;
}

export function rejectPendingPatchWithState(
  publish: PatchSnapshotPublisher | undefined,
  reason: "dismissed" | "explicit",
  messageTimestamp?: number
): void {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  const record = getPatchRecord(timestamp);
  if (!record || timestamp === undefined) {
    publishSnapshot(publish);
    return;
  }

  if (record.card.status !== "pending" && record.card.status !== "failed") {
    publishSnapshot(publish, timestamp);
    return;
  }

  const ids = pendingHunkIds(record.card);
  if (ids.length === 0) {
    publishSnapshot(publish, timestamp);
    return;
  }

  rejectPendingPatchHunks(publish, timestamp, ids, reason);
}

export function rejectPendingPatchHunk(
  publish: PatchSnapshotPublisher | undefined,
  messageTimestamp: number | undefined,
  hunkId: string
): void {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  if (timestamp === undefined) {
    publishSnapshot(publish);
    return;
  }
  rejectPendingPatchHunks(publish, timestamp, [hunkId], "explicit");
}

function rejectPendingPatchHunks(
  publish: PatchSnapshotPublisher | undefined,
  timestamp: number,
  hunkIds: string[],
  reason: "dismissed" | "explicit"
): void {
  const record = getPatchRecord(timestamp);
  if (!record) {
    publishSnapshot(publish);
    return;
  }

  emitPatchEvent("edit.patch_rejected", { reason, hunkCount: hunkIds.length });

  let nextCard = record.card;
  for (const hunkId of hunkIds) {
    nextCard = setHunkStatusOnCard(nextCard, hunkId, "rejected");
  }
  nextCard = finalizeCardAfterHunkUpdate(nextCard);

  if (pendingHunkIds(nextCard).length === 0) {
    void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);
  }

  updatePatchRecordCard(timestamp, nextCard);
  publishSnapshot(publish, timestamp);
}

/**
 * Undo:
 * - applied → restore files + restage pending (Apply/Reject return)
 * - rejected → restage pending (no file restore)
 */
export async function undoLastPatchWithState(
  publish?: PatchSnapshotPublisher,
  messageTimestamp?: number
): Promise<boolean> {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  const record = getPatchRecord(timestamp);
  if (!record || timestamp === undefined) {
    void vscode.window.showWarningMessage("Nothing to undo.");
    return false;
  }

  const hasAppliedHunk = record.card.files.some((file) =>
    file.hunks.some((hunk) => hunk.status === "applied")
  );

  if (record.card.status === "applied" || hasAppliedHunk) {
    const undo = record.undo;
    if (!undo?.length) {
      void vscode.window.showWarningMessage("Nothing to undo.");
      return false;
    }
    const result = await undoPatchApplication(undo);
    if (!result.ok) {
      emitPatchEvent("edit.patch_failed", { phase: "undo", error: result.error });
      void vscode.window.showErrorMessage(`CoopAI: Could not undo — ${result.error}`);
      return false;
    }
    emitPatchEvent("edit.patch_undone", { fileCount: undo.length });
    setPatchRecordUndo(timestamp, undefined);
  } else if (record.card.status === "rejected") {
    emitPatchEvent("edit.patch_undone", { fileCount: 0, from: "rejected" });
  } else {
    void vscode.window.showWarningMessage("Nothing to undo.");
    return false;
  }

  const pending = buildPatchCardState(record.patches, {
    status: "pending",
    messageTimestamp: timestamp,
    fileContents: record.fileContents
  });
  const review: PatchCardState =
    record.card.files.length > 0
      ? {
          ...record.card,
          status: "pending",
          canUndo: false,
          appliedFileCount: undefined,
          canCreatePr: false,
          prFiles: undefined,
          error: undefined,
          suppressMarkdown: true,
          files: record.card.files.map((file) => ({
            ...file,
            hunks: file.hunks.map((hunk) => ({ ...hunk, status: "pending" as const }))
          }))
        }
      : { ...pending, suppressMarkdown: true };

  upsertPatchRecord(timestamp, record.patches, review);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", true);
  publishSnapshot(publish, timestamp);
  return true;
}

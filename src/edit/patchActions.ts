import * as vscode from "vscode";
import {
  buildPatchCardState,
  deriveCardStatusFromHunks,
  PATCH_CARD_IDLE,
  pendingHunkIds,
  setHunkStatusOnCard,
  withSuppressionRegistry
} from "./patchDiffPreview";
import { emitPatchEvent } from "./patchEvents";
import { locateHunkById, type ParsedPatchSet } from "./patchParser";
import { applyPatchesToWorkspace, undoPatchApplication, type FileUndoSnapshot } from "./patchApplier";
import {
  getPatchRecord,
  listPatchCards,
  resolveActivePatchTimestamp,
  setLastPatchApplyError,
  setPatchRecordUndo,
  updatePatchRecordCard,
  upsertPatchRecord
} from "./patchSession";
import type { PatchCardState, PatchCardsUpdatePayload } from "../chat/types";

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

function finalizeCardAfterHunkUpdate(card: PatchCardState): PatchCardState {
  const status = deriveCardStatusFromHunks(card);
  return {
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
}

export async function applyPendingPatch(
  publish?: PatchSnapshotPublisher,
  messageTimestamp?: number
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

  const ids = pendingHunkIds(record.card);
  if (ids.length === 0) {
    void vscode.window.showWarningMessage("No pending edits left to apply.");
    publishSnapshot(publish, timestamp);
    return false;
  }

  return applyPendingPatchHunks(publish, timestamp, ids);
}

export async function applyPendingPatchHunk(
  publish: PatchSnapshotPublisher | undefined,
  messageTimestamp: number | undefined,
  hunkId: string
): Promise<boolean> {
  const timestamp = resolveActivePatchTimestamp(messageTimestamp);
  if (timestamp === undefined) {
    void vscode.window.showWarningMessage("No patch is pending. Use /edit in chat to generate one.");
    publishSnapshot(publish);
    return false;
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

  const preview = buildPatchCardState(record.patches, {
    status: "pending",
    messageTimestamp: timestamp,
    previousFiles: record.card.files
  });

  const result = await applyPatchesToWorkspace(subset);
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
  nextCard = finalizeCardAfterHunkUpdate(nextCard);

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
    messageTimestamp: timestamp
  });
  const review: PatchCardState =
    record.card.files.length > 0
      ? {
          ...record.card,
          status: "pending",
          canUndo: false,
          appliedFileCount: undefined,
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

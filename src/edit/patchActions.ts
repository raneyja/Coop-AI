import * as vscode from "vscode";
import {
  buildPatchCardState,
  PATCH_CARD_IDLE,
  withSuppressionRegistry
} from "./patchDiffPreview";
import { emitPatchEvent } from "./patchEvents";
import { countHunks } from "./patchParser";
import { applyPatchesToWorkspace, undoPatchApplication } from "./patchApplier";
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

  const preview = buildPatchCardState(record.patches, {
    status: "pending",
    messageTimestamp: timestamp
  });

  const result = await applyPatchesToWorkspace(record.patches);
  if (!result.ok) {
    setLastPatchApplyError(result.error);
    emitPatchEvent("edit.patch_failed", { phase: "apply", error: result.error, file: result.file });
    const failed: PatchCardState = {
      ...preview,
      status: "failed",
      error: result.error,
      suppressMarkdown: true,
      canUndo: false
    };
    updatePatchRecordCard(timestamp, failed);
    publishSnapshot(publish, timestamp);
    void vscode.window.showErrorMessage(`CoopAI: Patch failed — ${result.error}`);
    return false;
  }

  setLastPatchApplyError(undefined);
  setPatchRecordUndo(timestamp, result.undo);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);
  emitPatchEvent("edit.patch_applied", {
    fileCount: result.filesChanged,
    hunkCount: countHunks(record.patches)
  });

  const applied: PatchCardState = {
    ...preview,
    status: "applied",
    appliedFileCount: result.filesChanged,
    canUndo: true,
    error: undefined,
    suppressMarkdown: true
  };
  updatePatchRecordCard(timestamp, applied);
  publishSnapshot(publish, timestamp);
  void vscode.window.showInformationMessage(
    `CoopAI: Applied patch to ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"} (local workspace).`
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

  emitPatchEvent("edit.patch_rejected", { reason });
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);

  const rejected: PatchCardState = {
    ...record.card,
    status: "rejected",
    canUndo: true,
    appliedFileCount: undefined,
    error: undefined,
    suppressMarkdown: true
  };
  // Keep patches on the record so Undo can restage to pending without regenerating.
  updatePatchRecordCard(timestamp, rejected);
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

  if (record.card.status === "applied") {
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
          suppressMarkdown: true
        }
      : { ...pending, suppressMarkdown: true };

  upsertPatchRecord(timestamp, record.patches, review);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", true);
  publishSnapshot(publish, timestamp);
  return true;
}

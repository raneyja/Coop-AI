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
  listPatchCards,
  resolveActivePatchTimestamp,
  resolveVariant,
  setLastPatchApplyError,
  setVariantUndo,
  siblingVariants,
  updateVariantCard,
  type PatchVariantRecord
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

function variantMeta(variant: PatchVariantRecord): {
  variantId: string;
  variantLabel?: string;
  variantIndex?: number;
  variantCount?: number;
  summary?: string;
} {
  return {
    variantId: variant.id,
    variantLabel: variant.card.variantLabel,
    variantIndex: variant.index,
    variantCount: variant.card.variantCount,
    summary: variant.card.summary
  };
}

/**
 * When one option is applied, its siblings target the same code region and can
 * no longer match. Mark them superseded so they stop offering Apply — Undo on
 * the applied option restores them to pending.
 */
function supersedeSiblings(timestamp: number, appliedVariantId: string): void {
  for (const sibling of siblingVariants(timestamp, appliedVariantId)) {
    if (sibling.card.status === "pending" || sibling.card.status === "failed") {
      updateVariantCard(timestamp, sibling.id, {
        ...sibling.card,
        status: "superseded",
        canUndo: false,
        error: undefined,
        suppressMarkdown: true
      });
    }
  }
}

/** Restore superseded siblings back to pending after an applied option is undone. */
function restoreSiblings(timestamp: number, appliedVariantId: string): void {
  for (const sibling of siblingVariants(timestamp, appliedVariantId)) {
    if (sibling.card.status === "superseded") {
      const pending = buildPatchCardState(sibling.patches, {
        status: "pending",
        messageTimestamp: timestamp,
        ...variantMeta(sibling)
      });
      updateVariantCard(timestamp, sibling.id, { ...pending, suppressMarkdown: true });
    }
  }
}

export async function applyPendingPatch(
  publish?: PatchSnapshotPublisher,
  messageTimestamp?: number,
  variantId?: string
): Promise<boolean> {
  const resolved = resolveVariant(messageTimestamp, variantId);
  if (!resolved) {
    void vscode.window.showWarningMessage("No patch is pending. Use /edit in chat to generate one.");
    publishSnapshot(publish);
    return false;
  }
  const { messageTimestamp: timestamp, variant } = resolved;

  if (variant.card.status !== "pending" && variant.card.status !== "failed") {
    void vscode.window.showWarningMessage("This patch is not waiting for Apply. Use Undo first if needed.");
    publishSnapshot(publish, timestamp);
    return false;
  }

  const preview = buildPatchCardState(variant.patches, {
    status: "pending",
    messageTimestamp: timestamp,
    targetUri: resolved.record.targetUri,
    ...variantMeta(variant)
  });

  const result = await applyPatchesToWorkspace(variant.patches, resolved.record.targetUri);
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
    updateVariantCard(timestamp, variant.id, failed);
    publishSnapshot(publish, timestamp);
    void vscode.window.showErrorMessage(`CoopAI: Patch failed — ${result.error}`);
    return false;
  }

  setLastPatchApplyError(undefined);
  setVariantUndo(timestamp, variant.id, result.undo);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);
  emitPatchEvent("edit.patch_applied", {
    fileCount: result.filesChanged,
    hunkCount: countHunks(variant.patches)
  });

  const applied: PatchCardState = {
    ...preview,
    status: "applied",
    appliedFileCount: result.filesChanged,
    canUndo: true,
    error: undefined,
    suppressMarkdown: true
  };
  updateVariantCard(timestamp, variant.id, applied);
  supersedeSiblings(timestamp, variant.id);
  publishSnapshot(publish, timestamp);
  void vscode.window.showInformationMessage(
    `CoopAI: Applied patch to ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"} (local workspace).`
  );
  return true;
}

export function rejectPendingPatchWithState(
  publish: PatchSnapshotPublisher | undefined,
  reason: "dismissed" | "explicit",
  messageTimestamp?: number,
  variantId?: string
): void {
  const resolved = resolveVariant(messageTimestamp, variantId);
  if (!resolved) {
    publishSnapshot(publish);
    return;
  }
  const { messageTimestamp: timestamp, variant } = resolved;

  if (variant.card.status !== "pending" && variant.card.status !== "failed") {
    publishSnapshot(publish, timestamp);
    return;
  }

  emitPatchEvent("edit.patch_rejected", { reason });

  const rejected: PatchCardState = {
    ...variant.card,
    status: "rejected",
    canUndo: true,
    appliedFileCount: undefined,
    error: undefined,
    suppressMarkdown: true
  };
  // Keep patches on the record so Undo can restage to pending without regenerating.
  updateVariantCard(timestamp, variant.id, rejected);

  const anyPending = siblingVariants(timestamp, variant.id).some(
    (sibling) => sibling.card.status === "pending" || sibling.card.status === "failed"
  );
  if (!anyPending) {
    void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);
  }
  publishSnapshot(publish, timestamp);
}

/**
 * Undo:
 * - applied → restore files + restage pending (Apply/Reject return); restore siblings
 * - rejected → restage pending (no file restore)
 */
export async function undoLastPatchWithState(
  publish?: PatchSnapshotPublisher,
  messageTimestamp?: number,
  variantId?: string
): Promise<boolean> {
  const resolved = resolveVariant(messageTimestamp, variantId);
  if (!resolved) {
    void vscode.window.showWarningMessage("Nothing to undo.");
    return false;
  }
  const { messageTimestamp: timestamp, variant } = resolved;

  let restoreSiblingsAfter = false;
  if (variant.card.status === "applied") {
    const undo = variant.undo;
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
    setVariantUndo(timestamp, variant.id, undefined);
    restoreSiblingsAfter = true;
  } else if (variant.card.status === "rejected") {
    emitPatchEvent("edit.patch_undone", { fileCount: 0, from: "rejected" });
  } else {
    void vscode.window.showWarningMessage("Nothing to undo.");
    return false;
  }

  const review: PatchCardState =
    variant.card.files.length > 0
      ? {
          ...variant.card,
          status: "pending",
          canUndo: false,
          appliedFileCount: undefined,
          error: undefined,
          suppressMarkdown: true
        }
      : {
          ...buildPatchCardState(variant.patches, {
            status: "pending",
            messageTimestamp: timestamp,
            ...variantMeta(variant)
          }),
          suppressMarkdown: true
        };

  updateVariantCard(timestamp, variant.id, review);
  if (restoreSiblingsAfter) {
    restoreSiblings(timestamp, variant.id);
  }
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", true);
  publishSnapshot(publish, timestamp);
  return true;
}

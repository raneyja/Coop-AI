import * as vscode from "vscode";
import type { PatchCardState, PatchCardsUpdatePayload } from "../chat/types";
import { buildPatchCardState, PATCH_CARD_IDLE, withSuppressionRegistry } from "./patchDiffPreview";
import type { ParsedPatchSet, PatchVariant } from "./patchParser";
import { countHunks, parsePatchVariants } from "./patchParser";
import { emitPatchEvent } from "./patchEvents";
import { type PatchSnapshotPublisher } from "./patchActions";
import {
  listPatchCards,
  setLastAssistantPatchContent,
  setLastPatchApplyError,
  setLastPatchMessageTimestamp,
  upsertPatchVariants,
  type PatchVariantRecord
} from "./patchSession";

function patchReadyLabel(patches: ParsedPatchSet): string {
  const fileCount = patches.files.length;
  const hunkCount = countHunks(patches);
  return fileCount === 1
    ? `1 file (${hunkCount} edit${hunkCount === 1 ? "" : "s"})`
    : `${fileCount} files (${hunkCount} edits)`;
}

export function showPatchReadyNotification(patches: ParsedPatchSet): void {
  const label = patchReadyLabel(patches);
  void vscode.window
    .showInformationMessage(`CoopAI: Patch ready — ${label}`, "Apply", "Reject")
    .then((choice) => {
      if (choice === "Apply") {
        void vscode.commands.executeCommand("coopAI.applyPatch");
        return;
      }
      if (choice === "Reject") {
        void vscode.commands.executeCommand("coopAI.rejectPatch");
      }
    });
}

export type HandlePatchCompleteOptions = {
  messageTimestamp?: number;
  publish?: PatchSnapshotPublisher;
  /** Exact local editor selected when the /edit request was submitted. */
  targetUri?: string;
};

export async function handlePatchComplete(
  content: string,
  options: HandlePatchCompleteOptions = {}
): Promise<PatchCardState> {
  setLastAssistantPatchContent(content);
  setLastPatchApplyError(undefined);
  setLastPatchMessageTimestamp(options.messageTimestamp);

  const parsed = parsePatchVariants(content);
  if (!parsed.ok) {
    emitPatchEvent("edit.patch_failed", { phase: "parse", error: parsed.error });
    const failed: PatchCardState = {
      status: "failed",
      messageTimestamp: options.messageTimestamp,
      fileCount: 0,
      hunkCount: 0,
      files: [],
      error: parsed.error,
      suppressMarkdown: true
    };
    const failedWithSuppress = withSuppressionRegistry(failed);
    if (options.messageTimestamp !== undefined) {
      // Record a zero-file failed card so the webview can show the error instead of
      // silently swallowing a bad multi-option mash-up.
      upsertPatchVariants(
        options.messageTimestamp,
        [
          {
            id: "v0",
            label: "",
            index: 0,
            patches: { files: [] },
            card: failedWithSuppress
          }
        ],
        options.targetUri
      );
    }
    if (options.publish) {
      options.publish({
        cards: listPatchCards().map((card) => withSuppressionRegistry({ ...card, suppressMarkdown: true })),
        activeMessageTimestamp: options.messageTimestamp,
        suppressedMessageTimestamps: options.messageTimestamp ? [options.messageTimestamp] : []
      });
    }
    return failedWithSuppress;
  }

  const variantCount = parsed.variants.length;
  const totalFiles = parsed.variants.reduce((sum, variant) => sum + variant.patches.files.length, 0);
  const totalHunks = parsed.variants.reduce((sum, variant) => sum + countHunks(variant.patches), 0);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", true);
  emitPatchEvent("edit.patch_parsed", {
    fileCount: totalFiles,
    hunkCount: totalHunks,
    variantCount
  });

  const records: Omit<PatchVariantRecord, "undo">[] = parsed.variants.map(
    (variant: PatchVariant) => {
      const card = buildPatchCardState(variant.patches, {
        status: "pending",
        messageTimestamp: options.messageTimestamp,
        variantId: variant.id,
        variantLabel: variantCount > 1 ? variant.label : undefined,
        variantIndex: variant.index,
        variantCount,
        summary: variant.summary
      });
      return {
        id: variant.id,
        label: variant.label,
        index: variant.index,
        patches: variant.patches,
        card: withSuppressionRegistry({ ...card, suppressMarkdown: true })
      };
    }
  );

  const firstCard = records[0]!.card;

  if (options.messageTimestamp !== undefined) {
    upsertPatchVariants(options.messageTimestamp, records, options.targetUri);
  }

  if (options.publish) {
    const cards = listPatchCards().map((card) => withSuppressionRegistry({ ...card, suppressMarkdown: true }));
    options.publish({
      cards,
      activeMessageTimestamp: options.messageTimestamp
    });
  } else {
    showPatchReadyNotification(records[0]!.patches);
  }

  return firstCard;
}

export function idlePatchCardState(): PatchCardState {
  return PATCH_CARD_IDLE;
}

export type { PatchCardsUpdatePayload };

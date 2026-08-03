import * as vscode from "vscode";
import type { PatchCardState, PatchCardsUpdatePayload } from "../chat/types";
import { buildPatchCardState, PATCH_CARD_IDLE, withSuppressionRegistry } from "./patchDiffPreview";
import type { ParsedPatchSet } from "./patchParser";
import { countHunks, countUniqueFiles, parsePatchResponse } from "./patchParser";
import { emitPatchEvent } from "./patchEvents";
import { rejectPendingPatchWithState, type PatchSnapshotPublisher } from "./patchActions";
import {
  listPatchCards,
  setLastAssistantPatchContent,
  setLastPatchApplyError,
  setLastPatchMessageTimestamp,
  upsertPatchRecord
} from "./patchSession";

function patchReadyLabel(patches: ParsedPatchSet): string {
  const fileCount = countUniqueFiles(patches);
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
        rejectPendingPatchWithState(undefined, "explicit");
      }
    });
}

export type HandlePatchCompleteOptions = {
  messageTimestamp?: number;
  publish?: PatchSnapshotPublisher;
  /**
   * Ask-mode opportunistic patches: if the response has no valid File:/SEARCH-REPLACE
   * blocks, do nothing (no failed card, no markdown suppression). Edit mode must leave
   * this unset so parse failures still surface.
   */
  ignoreParseFailure?: boolean;
};

export async function handlePatchComplete(
  content: string,
  options: HandlePatchCompleteOptions = {}
): Promise<PatchCardState | undefined> {
  const parsed = parsePatchResponse(content);
  if (!parsed.ok) {
    if (options.ignoreParseFailure) {
      return undefined;
    }
    setLastAssistantPatchContent(content);
    setLastPatchApplyError(undefined);
    setLastPatchMessageTimestamp(options.messageTimestamp);
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
    if (options.messageTimestamp !== undefined) {
      // Failed parse has no hunks — still record suppression timestamp via empty files skip.
      // Prefer not upserting empty cards; publish snapshot if publisher provided.
    }
    options.publish?.({
      cards: [],
      activeMessageTimestamp: options.messageTimestamp,
      suppressedMessageTimestamps: options.messageTimestamp ? [options.messageTimestamp] : []
    });
    return failed;
  }

  setLastAssistantPatchContent(content);
  setLastPatchApplyError(undefined);
  setLastPatchMessageTimestamp(options.messageTimestamp);

  const fileCount = countUniqueFiles(parsed.patches);
  const hunkCount = countHunks(parsed.patches);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", true);
  emitPatchEvent("edit.patch_parsed", { fileCount, hunkCount });

  const pending = buildPatchCardState(parsed.patches, {
    status: "pending",
    messageTimestamp: options.messageTimestamp
  });
  const pendingWithSuppress = withSuppressionRegistry({ ...pending, suppressMarkdown: true });

  if (options.messageTimestamp !== undefined) {
    upsertPatchRecord(options.messageTimestamp, parsed.patches, pendingWithSuppress);
  }

  if (options.publish) {
    const cards = listPatchCards().map((card) => withSuppressionRegistry({ ...card, suppressMarkdown: true }));
    options.publish({
      cards,
      activeMessageTimestamp: options.messageTimestamp
    });
  } else {
    showPatchReadyNotification(parsed.patches);
  }

  return pendingWithSuppress;
}

export function idlePatchCardState(): PatchCardState {
  return PATCH_CARD_IDLE;
}

export type { PatchCardsUpdatePayload };

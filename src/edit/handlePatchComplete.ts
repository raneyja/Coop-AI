import * as vscode from "vscode";
import type { ParsedPatchSet } from "./patchParser";
import { countHunks, parsePatchResponse } from "./patchParser";
import { emitPatchEvent } from "./patchEvents";
import {
  clearPendingPatches,
  getPendingPatches,
  setLastAssistantPatchContent,
  setLastPatchApplyError,
  setPendingPatches
} from "./patchSession";

function patchReadyLabel(patches: ParsedPatchSet): string {
  const fileCount = patches.files.length;
  const hunkCount = countHunks(patches);
  return fileCount === 1
    ? `1 file (${hunkCount} edit${hunkCount === 1 ? "" : "s"})`
    : `${fileCount} files (${hunkCount} edits)`;
}

export function rejectPendingPatch(reason: "dismissed" | "explicit"): void {
  if (!getPendingPatches()) {
    return;
  }
  clearPendingPatches();
  setLastPatchApplyError(undefined);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);
  emitPatchEvent("edit.patch_rejected", { reason });
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
        rejectPendingPatch("explicit");
        return;
      }
      // Dismiss (X) — keep patch pending; user can Apply via notification or Command Palette.
    });
}

export async function handlePatchComplete(content: string): Promise<void> {
  setLastAssistantPatchContent(content);
  setLastPatchApplyError(undefined);

  const parsed = parsePatchResponse(content);
  if (!parsed.ok) {
    emitPatchEvent("edit.patch_failed", { phase: "parse", error: parsed.error });
    return;
  }

  const fileCount = parsed.patches.files.length;
  const hunkCount = countHunks(parsed.patches);
  setPendingPatches(parsed.patches);
  void vscode.commands.executeCommand("setContext", "coopAI.patchPending", true);
  emitPatchEvent("edit.patch_parsed", { fileCount, hunkCount });
  showPatchReadyNotification(parsed.patches);
}

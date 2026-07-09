import * as vscode from "vscode";
import type { CoopChatSession } from "../chat/CoopChatSession";
import { coopSessionRegistry } from "../chat/CoopSessionRegistry";
import type { SecureApiClient } from "../chat/SecureApiClient";
import { applyPatchesToWorkspace, undoPatchApplication } from "./patchApplier";
import { handlePatchComplete, rejectPendingPatch, showPatchReadyNotification } from "./handlePatchComplete";
import { emitPatchEvent, setPatchEventHandler } from "./patchEvents";
import { countHunks } from "./patchParser";
import {
  clearLastUndoStack,
  clearPendingPatches,
  getLastAssistantPatchContent,
  getLastPatchApplyError,
  getLastUndoStack,
  getPendingPatches,
  setLastPatchApplyError,
  setLastUndoStack
} from "./patchSession";

export function registerPatchCommands(
  context: vscode.ExtensionContext,
  api: SecureApiClient,
  getFallbackSession: () => CoopChatSession
): void {
  setPatchEventHandler((eventType, payload) => {
    void api.recordUsageEvents(eventType, payload).catch(() => undefined);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("coopAI.applyPatch", async () => {
      const pending = getPendingPatches();
      if (!pending) {
        void vscode.window.showWarningMessage("No patch is pending. Use /edit in chat to generate one.");
        return;
      }

      const result = await applyPatchesToWorkspace(pending);
      if (!result.ok) {
        setLastPatchApplyError(result.error);
        emitPatchEvent("edit.patch_failed", { phase: "apply", error: result.error, file: result.file });
        void vscode.window
          .showErrorMessage(`CoopAI: Could not apply patch — ${result.error}`, "Retry")
          .then((choice) => {
            if (choice === "Retry") {
              void vscode.commands.executeCommand("coopAI.retryLastPatch");
            }
          });
        return;
      }

      setLastPatchApplyError(undefined);
      setLastUndoStack(result.undo);
      clearPendingPatches();
      void vscode.commands.executeCommand("setContext", "coopAI.patchPending", false);
      emitPatchEvent("edit.patch_applied", {
        fileCount: result.filesChanged,
        hunkCount: countHunks(pending)
      });

      void vscode.window
        .showInformationMessage(
          `CoopAI: Applied patch to ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"}.`,
          "Undo"
        )
        .then((choice) => {
          if (choice === "Undo") {
            void vscode.commands.executeCommand("coopAI.undoLastPatch");
          }
        });
    }),
    vscode.commands.registerCommand("coopAI.undoLastPatch", async () => {
      const undo = getLastUndoStack();
      if (!undo?.length) {
        void vscode.window.showWarningMessage("Nothing to undo.");
        return;
      }

      const result = await undoPatchApplication(undo);
      if (!result.ok) {
        emitPatchEvent("edit.patch_failed", { phase: "undo", error: result.error });
        void vscode.window.showErrorMessage(`CoopAI: Could not undo — ${result.error}`);
        return;
      }

      const fileCount = undo.length;
      clearLastUndoStack();
      emitPatchEvent("edit.patch_undone", { fileCount });
      void vscode.window.showInformationMessage(
        `CoopAI: Undid patch on ${fileCount} file${fileCount === 1 ? "" : "s"}.`
      );
    }),
    vscode.commands.registerCommand("coopAI.rejectPatch", () => {
      if (!getPendingPatches()) {
        void vscode.window.showWarningMessage("No patch is pending.");
        return;
      }
      rejectPendingPatch("explicit");
      void vscode.window.showInformationMessage("CoopAI: Patch rejected.");
    }),
    vscode.commands.registerCommand("coopAI.retryLastPatch", async () => {
      const applyError = getLastPatchApplyError();
      if (applyError) {
        const session = coopSessionRegistry.getActive() ?? getFallbackSession();
        const hint = [
          `The patch failed to apply: ${applyError}`,
          "",
          "Please regenerate the patch with SEARCH blocks that match the current file content.",
          "Match whitespace and indentation exactly, or use the same logical lines with corrected spacing."
        ].join("\n");
        await session.sendEditFollowUp(hint);
        return;
      }

      const pending = getPendingPatches();
      if (pending) {
        showPatchReadyNotification(pending);
        return;
      }

      const lastContent = getLastAssistantPatchContent();
      if (lastContent) {
        await handlePatchComplete(lastContent);
        return;
      }

      void vscode.window.showWarningMessage("Nothing to retry. Use /edit in chat to generate a patch.");
    })
  );
}

import * as vscode from "vscode";
import type { CoopChatSession } from "../chat/CoopChatSession";
import { coopSessionRegistry } from "../chat/CoopSessionRegistry";
import type { SecureApiClient } from "../chat/SecureApiClient";
import { handlePatchComplete, showPatchReadyNotification } from "./handlePatchComplete";
import {
  applyPendingPatch,
  rejectPendingPatchWithState,
  undoLastPatchWithState
} from "./patchActions";
import { setPatchEventHandler } from "./patchEvents";
import {
  getLastAssistantPatchContent,
  getLastPatchApplyError,
  getPendingPatches
} from "./patchSession";

export function registerPatchCommands(
  context: vscode.ExtensionContext,
  api: SecureApiClient,
  getFallbackSession: () => CoopChatSession
): void {
  setPatchEventHandler((eventType, payload) => {
    void api.recordUsageEvents(eventType, payload).catch(() => undefined);
  });

  const publishForSession = () => {
    const session = coopSessionRegistry.getActive() ?? getFallbackSession();
    return (payload: Parameters<CoopChatSession["postPatchUpdate"]>[0]) => session.postPatchUpdate(payload);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("coopAI.applyPatch", async () => {
      await applyPendingPatch(publishForSession());
    }),
    vscode.commands.registerCommand("coopAI.undoLastPatch", async () => {
      await undoLastPatchWithState(publishForSession());
    }),
    vscode.commands.registerCommand("coopAI.rejectPatch", () => {
      rejectPendingPatchWithState(publishForSession(), "explicit");
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
        const session = coopSessionRegistry.getActive() ?? getFallbackSession();
        await handlePatchComplete(lastContent, {
          publish: (payload) => session.postPatchUpdate(payload)
        });
        return;
      }

      void vscode.window.showWarningMessage("Nothing to retry. Use /edit in chat to generate a patch.");
    })
  );
}

import * as vscode from "vscode";
import type { CoopChatSession } from "../chat/CoopChatSession";
import { coopSessionRegistry } from "../chat/CoopSessionRegistry";
import type { QuickActionId } from "../webview/types";
import { repoContextFromEditor } from "../context/intentDetector";
import { isQuickActionBlocked, quickActionBlockedMessage } from "../context/quickActionScope";
import { readConfiguration } from "../chat/SecureApiClient";

export function registerQuickActionCommands(
  context: vscode.ExtensionContext,
  getFallbackSession: () => CoopChatSession
): void {
  const actions: Array<{ command: string; actionId: QuickActionId; title: string }> = [
    { command: "coopAI.findOwnerFromContext", actionId: "find-owner", title: "Find Owner" },
    { command: "coopAI.blastRadiusFromContext", actionId: "blast-radius", title: "Blast Radius" },
    { command: "coopAI.understandRepoFromContext", actionId: "understand-repo", title: "Understand Repo" },
    { command: "coopAI.knowledgeGapsFromContext", actionId: "knowledge-gaps", title: "Knowledge Gaps" }
  ];

  for (const action of actions) {
    context.subscriptions.push(
      vscode.commands.registerCommand(action.command, async () => {
        await runQuickActionFromEditor(action.actionId, getFallbackSession);
      })
    );
  }
}

export async function runQuickActionFromEditor(
  actionId: QuickActionId,
  getFallbackSession: () => CoopChatSession
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const session = coopSessionRegistry.getActive() ?? getFallbackSession();
  const preferences = readConfiguration();
  const repoContext = editor
    ? repoContextFromEditor(editor, preferences, {})
    : { owner: preferences.owner, repo: preferences.repo, branch: preferences.branch };

  if (isQuickActionBlocked(actionId, repoContext)) {
    void vscode.window.showWarningMessage(quickActionBlockedMessage(actionId, repoContext));
    return;
  }

  await vscode.commands.executeCommand("workbench.view.extension.coopAI");
  await session.submitQuickAction(actionId, repoContext);
}

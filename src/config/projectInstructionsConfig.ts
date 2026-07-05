import * as vscode from "vscode";

/** When true, chat attaches local AGENTS.md and alwaysApply Cursor rules. */
export function readProjectInstructionsEnabled(): boolean {
  return vscode.workspace.getConfiguration("coopAI.projectInstructions").get<boolean>("enabled", true);
}

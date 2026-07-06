import * as vscode from "vscode";

const WORKSPACE_KEY = "coopAI.attachedAgentsMdPath";

export function getAttachedAgentsMdPath(context: vscode.ExtensionContext): string | undefined {
  const value = context.workspaceState.get<string>(WORKSPACE_KEY);
  return value?.trim() ? value : undefined;
}

export async function setAttachedAgentsMdPath(
  context: vscode.ExtensionContext,
  fsPath: string | undefined
): Promise<void> {
  await context.workspaceState.update(WORKSPACE_KEY, fsPath?.trim() || undefined);
}

export function attachedAgentsMdLabel(fsPath: string | undefined): string | undefined {
  if (!fsPath?.trim()) {
    return undefined;
  }
  const parts = fsPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || undefined;
}

import * as vscode from "vscode";
import {
  normalizeAgentsMdAccountKey,
  readAttachedAgentsMdPath,
  writeAttachedAgentsMdPath
} from "./agentsMdAttachmentRecord";

export { attachedAgentsMdLabel, normalizeAgentsMdAccountKey } from "./agentsMdAttachmentRecord";

export function getAttachedAgentsMdPath(
  context: vscode.ExtensionContext,
  accountKey?: string
): string | undefined {
  return readAttachedAgentsMdPath(context.workspaceState, accountKey);
}

export async function setAttachedAgentsMdPath(
  context: vscode.ExtensionContext,
  accountKey: string | undefined,
  fsPath: string | undefined
): Promise<void> {
  await writeAttachedAgentsMdPath(context.workspaceState, accountKey, fsPath);
}

export function currentAgentsMdAccountKey(prefs: {
  userEmail?: string;
  isSignedIn?: boolean;
}): string | undefined {
  return normalizeAgentsMdAccountKey(prefs.userEmail, prefs.isSignedIn);
}

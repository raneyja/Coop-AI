import * as vscode from "vscode";
import { resolveGitRootFromWorkspace } from "./gitRootResolver";

export function resolveWorkspaceGitRoot(options?: {
  activeFile?: string;
  resolveAbsolutePath?: (relativePath: string) => string | undefined;
  workspaceRoots?: string[];
}): string | undefined {
  return resolveGitRootFromWorkspace({
    ...options,
    workspaceRoots:
      options?.workspaceRoots ?? vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath)
  });
}

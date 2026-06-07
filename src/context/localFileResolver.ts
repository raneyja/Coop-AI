import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { collectOpenEditorFileRefs } from "./editorManifestContext";
import { resolveEditorFile } from "./editorFileContext";
import { isRemoteTabAbsolutePath } from "./githubVfsUri";
import {
  normalizeRelativePath,
  readWorkspaceFileFromAbsolutePath,
} from "./localFileContext";
import { toRepositoryRelativePath } from "./repoFilePath";

export function resolveLocalAbsolutePath(relativePath: string): string | undefined {
  const normalized = toRepositoryRelativePath(relativePath);

  for (const ref of collectOpenEditorFileRefs()) {
    if (normalizeRelativePath(ref.relativePath) === normalizeRelativePath(normalized)) {
      if (isRemoteTabAbsolutePath(ref.absolutePath)) {
        return undefined;
      }
      if (fs.existsSync(ref.absolutePath)) {
        return ref.absolutePath;
      }
    }
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidate = path.join(folder.uri.fsPath, normalized);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const editor = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
  if (editor) {
    const resolved = resolveEditorFile(editor);
    if (resolved.gitRoot) {
      const candidate = path.join(resolved.gitRoot, normalized);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export { readWorkspaceFileFromAbsolutePath } from "./localFileContext";

/** Read a repo-relative path from the opened workspace folders (no editor focus required). */
export function readWorkspaceFileFromDisk(
  relativePath: string,
  lines?: { start: number; end: number }
): LocalFileContextPayload | undefined {
  const normalized = toRepositoryRelativePath(relativePath);
  const absolute = resolveLocalAbsolutePath(normalized);
  if (!absolute) {
    return undefined;
  }

  return readWorkspaceFileFromAbsolutePath(absolute, normalized, lines);
}

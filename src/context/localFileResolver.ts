import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { collectOpenEditorFileRefs } from "./editorManifestContext";
import { resolveEditorFile } from "./editorFileContext";
import { isRemoteTabAbsolutePath } from "./githubVfsUri";
import {
  normalizeRelativePath,
  readWorkspaceFileFromAbsolutePath,
  type LocalFileContextPayload
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

/** Workspace-only @mention search for the free plan (no remote graph). */
export async function searchLocalWorkspaceFiles(
  pattern: string,
  limit = 12
): Promise<string[]> {
  const needle = pattern.trim().toLowerCase();
  if (!needle || !vscode.workspace.workspaceFolders?.length) {
    return [];
  }
  const exclude = "**/{node_modules,.git,dist,build,.coop,.next,out}/**";
  const uris = await vscode.workspace.findFiles("**/*", exclude, 400);
  const matches: string[] = [];
  for (const uri of uris) {
    const relative = vscode.workspace.asRelativePath(uri).replace(/\\/g, "/");
    if (!relative.toLowerCase().includes(needle)) {
      continue;
    }
    matches.push(relative);
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

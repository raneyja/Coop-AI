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

function mentionPathFromFsPath(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, "/");
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath.replace(/\\/g, "/");
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      const suffix = normalized.slice(root.length).replace(/^\//, "");
      return `${folder.name}/${suffix}`;
    }
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-4).join("/");
}

function pathMatchesMentionNeedle(filePath: string, needle: string): boolean {
  return filePath.replace(/\\/g, "/").toLowerCase().includes(needle);
}

function resolvePathInWorkspaceFolders(normalized: string): string | undefined {
  if (path.isAbsolute(normalized) && fs.existsSync(normalized)) {
    return normalized;
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderName = folder.name.replace(/\\/g, "/");
    const relativeInside =
      normalized.startsWith(`${folderName}/`) ? normalized.slice(folderName.length + 1) : normalized;
    const candidate = path.join(folder.uri.fsPath, relativeInside);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function resolveLocalAbsolutePath(relativePath: string): string | undefined {
  const raw = relativePath?.trim().replace(/\\/g, "/");
  if (!raw) {
    return undefined;
  }
  // Outside-workspace chat attach uses absolute paths (Cmd+O / Downloads).
  if (path.isAbsolute(raw.replace(/\//g, path.sep)) && fs.existsSync(raw)) {
    return raw;
  }
  if (/^Users\/[^/]+\//i.test(raw) || /^home\/[^/]+\//i.test(raw)) {
    const restored = `/${raw}`;
    if (fs.existsSync(restored)) {
      return restored;
    }
  }

  const normalized = toRepositoryRelativePath(relativePath);

  for (const ref of collectOpenEditorFileRefs()) {
    const refPath = ref.relativePath.replace(/\\/g, "/");
    const samePath =
      normalizeRelativePath(refPath) === normalizeRelativePath(normalized) ||
      refPath.toLowerCase().endsWith(`/${normalized.toLowerCase()}`) ||
      normalized.toLowerCase().endsWith(`/${refPath.toLowerCase()}`);
    if (!samePath) {
      continue;
    }
    // Skip remote VFS tabs — Apply always targets the on-disk workspace file.
    if (isRemoteTabAbsolutePath(ref.absolutePath)) {
      continue;
    }
    if (fs.existsSync(ref.absolutePath)) {
      return ref.absolutePath;
    }
  }

  const fromWorkspace = resolvePathInWorkspaceFolders(normalized);
  if (fromWorkspace) {
    return fromWorkspace;
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

function searchOpenEditorPaths(pattern: string, limit: number): string[] {
  const needle = pattern.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const matches: string[] = [];
  for (const ref of collectOpenEditorFileRefs()) {
    const relative = ref.relativePath.replace(/\\/g, "/");
    if (!pathMatchesMentionNeedle(relative, needle)) {
      continue;
    }
    matches.push(relative);
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

/** Workspace-only @mention search (local disk + open tabs). Case-insensitive on path. */
export async function searchLocalWorkspaceFiles(
  pattern: string,
  limit = 12
): Promise<string[]> {
  const needle = pattern.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const seen = new Set<string>();
  const matches: string[] = [];
  const push = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    matches.push(normalized);
  };

  for (const openPath of searchOpenEditorPaths(needle, limit)) {
    push(openPath);
    if (matches.length >= limit) {
      return matches;
    }
  }

  if (!vscode.workspace.workspaceFolders?.length) {
    return matches;
  }

  const exclude = "**/{node_modules,.git,dist,build,.coop,.next,out}/**";
  const uris = await vscode.workspace.findFiles("**/*", exclude, 2500);
  for (const uri of uris) {
    const relative = vscode.workspace.asRelativePath(uri).replace(/\\/g, "/");
    if (relative.startsWith("..")) {
      continue;
    }
    if (!pathMatchesMentionNeedle(relative, needle)) {
      continue;
    }
    push(relative);
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

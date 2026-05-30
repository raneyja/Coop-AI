import * as path from "node:path";
import * as vscode from "vscode";

/**
 * GitHub/GitLab APIs expect paths relative to the repository root (e.g. src/foo.ts),
 * not absolute workspace paths.
 */
export function toRepositoryRelativePath(filePath: string): string {
  const trimmed = filePath?.trim();
  if (!trimmed) {
    return filePath;
  }

  let normalized = trimmed.replace(/\\/g, "/");

  // Some callers strip a leading "/" from "/Users/..." so path.isAbsolute() fails.
  if (/^Users\/[^/]+\//i.test(normalized) || /^home\/[^/]+\//i.test(normalized)) {
    normalized = `/${normalized}`;
  }

  const fromWorkspace = stripWorkspaceFolderPrefix(normalized);
  if (fromWorkspace !== undefined) {
    return fromWorkspace.replace(/^\/+/, "");
  }

  const fromProjectFolder = stripEmbeddedProjectRoot(normalized);
  if (fromProjectFolder !== undefined) {
    return fromProjectFolder.replace(/^\/+/, "");
  }

  if (!isAbsoluteFilePath(normalized)) {
    const embedded = stripEmbeddedProjectRoot(`/${normalized}`);
    if (embedded !== undefined) {
      return embedded.replace(/^\/+/, "");
    }
    return normalized.replace(/^\/+/, "");
  }

  try {
    const relative = vscode.workspace.asRelativePath(
      vscode.Uri.file(normalized.replace(/\//g, path.sep)),
      false
    );
    const relNorm = relative.replace(/\\/g, "/");
    if (relNorm && !isAbsoluteFilePath(relNorm)) {
      return relNorm.replace(/^\/+/, "");
    }
  } catch {
    // fall through
  }

  return normalized.replace(/^\/+/, "");
}

/** When VS Code has no workspace root, strip ".../CoopAI/..." from a local path. */
function stripEmbeddedProjectRoot(normalized: string): string | undefined {
  const markers = ["/CoopAI/", "/Coop AI/", "/coop-ai/", "/Coop-AI/"];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) {
      return normalized.slice(index + marker.length);
    }
  }
  return undefined;
}

function stripWorkspaceFolderPrefix(normalized: string): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath.replace(/\\/g, "/");
    const candidates = [root, root.replace(/^\//, "")];
    for (const base of candidates) {
      if (!base) {
        continue;
      }
      if (normalized === base) {
        return "";
      }
      const prefix = `${base}/`;
      if (normalized.startsWith(prefix)) {
        return normalized.slice(prefix.length);
      }
    }
  }
  return undefined;
}

function isAbsoluteFilePath(value: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return true;
  }
  return path.isAbsolute(value.replace(/\//g, path.sep));
}

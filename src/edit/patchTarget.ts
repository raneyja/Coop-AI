import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { findEditorForRepoFile } from "../context/editorFileContext";
import { parseGithubVfsUri, pathsReferToSameFile, isRemoteTabAbsolutePath } from "../context/githubVfsUri";
import { resolveLocalAbsolutePath } from "../context/localFileResolver";
import { toRepositoryRelativePath } from "../context/repoFilePath";

export type EditablePatchTarget = {
  uri: vscode.Uri;
  /** Live buffer text when the document is open; disk read for local files. */
  readText: () => string | undefined;
};

export function documentMatchesPatchPath(doc: vscode.TextDocument, relativePath: string): boolean {
  const normalized = toRepositoryRelativePath(relativePath);
  if (!normalized) {
    return false;
  }

  if (doc.uri.scheme === "file") {
    const abs = resolveLocalAbsolutePath(normalized);
    if (!abs) {
      return false;
    }
    return path.normalize(doc.uri.fsPath) === path.normalize(abs);
  }

  const parsed = parseGithubVfsUri(doc.uri.toString());
  if (parsed?.file) {
    return pathsReferToSameFile(parsed.file, normalized);
  }

  const pathPart = doc.uri.path.replace(/^\/+/, "");
  return pathsReferToSameFile(pathPart, normalized);
}

/**
 * Resolve a patch target for Apply/preview: open editor (including remote VFS),
 * then on-disk workspace path.
 */
export function resolveEditablePatchTarget(relativePath: string): EditablePatchTarget | undefined {
  const normalized = toRepositoryRelativePath(relativePath);
  if (!normalized) {
    return undefined;
  }

  const openEditor = findEditorForRepoFile(normalized, {
    includeRemote: true,
    includeExternal: true
  });
  if (openEditor) {
    return {
      uri: openEditor.document.uri,
      readText: () => openEditor.document.getText()
    };
  }

  for (const doc of vscode.workspace.textDocuments) {
    if (!documentMatchesPatchPath(doc, normalized)) {
      continue;
    }
    return {
      uri: doc.uri,
      readText: () => doc.getText()
    };
  }

  const absolutePath = resolveLocalAbsolutePath(normalized);
  if (!absolutePath || isRemoteTabAbsolutePath(absolutePath)) {
    return undefined;
  }

  return {
    uri: vscode.Uri.file(absolutePath),
    readText: () => {
      try {
        return fs.readFileSync(absolutePath, "utf8");
      } catch {
        return undefined;
      }
    }
  };
}

export function uriFromUndoSnapshotPath(absolutePath: string): vscode.Uri {
  if (isRemoteTabAbsolutePath(absolutePath)) {
    return vscode.Uri.parse(absolutePath);
  }
  return vscode.Uri.file(absolutePath);
}

export function undoSnapshotPathForUri(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

import * as vscode from "vscode";
import type { ParsedPatchSet } from "./patchParser";
import { applyHunksToContent } from "./patchContent";
import { lookupPatchFileContent } from "./patchFileContents";
import {
  ensureEditablePatchTarget,
  languageIdForPatchPath,
  undoSnapshotPathForUri,
  uriFromUndoSnapshotPath,
  type EnsurePatchTargetOptions
} from "./patchTarget";

export { applyHunkToContent, applyHunksToContent } from "./patchContent";
export type { ApplyHunkResult } from "./patchContent";

export type FileUndoSnapshot = {
  /** Local fs path or remote URI string (e.g. vscode-vfs://…). */
  absolutePath: string;
  relativePath: string;
  originalContent: string;
};

export type ApplyPatchesResult =
  | {
      ok: true;
      undo: FileUndoSnapshot[];
      filesChanged: number;
      usedRemoteEditor: boolean;
      appliedFiles: Array<{ path: string; content: string }>;
    }
  | { ok: false; error: string; file?: string };

export type ApplyPatchesOptions = {
  /**
   * Match selections keyed by `relativePath::hunkIndex` within the patch set
   * passed to apply (not the full session patch set).
   */
  matchIndicesByFileHunk?: Readonly<Record<string, readonly number[]>>;
  repo?: EnsurePatchTargetOptions["repo"];
  openRemoteFile?: EnsurePatchTargetOptions["openRemoteFile"];
  /** Captured full-file bytes when the live tab cannot be read. */
  fileContents?: Readonly<Record<string, string>>;
};

function fileHunkKey(relativePath: string, hunkIndex: number): string {
  return `${relativePath}::${hunkIndex}`;
}

export function matchIndicesKey(relativePath: string, hunkIndex: number): string {
  return fileHunkKey(relativePath, hunkIndex);
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  const lastCharacter = document.lineAt(lastLine).text.length;
  return new vscode.Range(0, 0, lastLine, lastCharacter);
}

export async function applyPatchesToWorkspace(
  patches: ParsedPatchSet,
  options?: ApplyPatchesOptions
): Promise<ApplyPatchesResult> {
  const planned: Array<{ uri: vscode.Uri; relativePath: string; originalContent: string; nextContent: string }> =
    [];
  let usedRemoteEditor = false;

  for (const filePatch of patches.files) {
    const resolved = await ensureEditablePatchTarget(filePatch.relativePath, {
      repo: options?.repo,
      openRemoteFile: options?.openRemoteFile,
      fileContents: options?.fileContents,
      search: filePatch.hunks[0]?.search
    });
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error,
        file: filePatch.relativePath
      };
    }
    const target = resolved.target;

    if (target.uri.scheme !== "file" || resolved.usedRemoteOpen) {
      usedRemoteEditor = true;
    }

    const live = target.readText();
    const captured = lookupPatchFileContent(filePatch.relativePath, options?.fileContents);
    const originalContent = live?.trim() ? live : captured;
    if (originalContent === undefined) {
      return { ok: false, error: `Could not read file: ${filePatch.relativePath}`, file: filePatch.relativePath };
    }

    const matchIndicesByHunk: { [hunkIndex: number]: readonly number[] } = {};
    for (let hunkIndex = 0; hunkIndex < filePatch.hunks.length; hunkIndex++) {
      const key = fileHunkKey(filePatch.relativePath, hunkIndex);
      const indices = options?.matchIndicesByFileHunk?.[key];
      if (indices) {
        matchIndicesByHunk[hunkIndex] = indices;
      }
    }

    const applied = applyHunksToContent(originalContent, filePatch.hunks, { matchIndicesByHunk });
    if (!applied.ok) {
      return { ok: false, error: `${filePatch.relativePath}: ${applied.error}`, file: filePatch.relativePath };
    }

    if (applied.content === originalContent) {
      continue;
    }

    planned.push({
      uri: target.uri,
      relativePath: filePatch.relativePath,
      originalContent,
      nextContent: applied.content
    });
  }

  if (planned.length === 0) {
    return { ok: false, error: "No changes to apply" };
  }

  const edits = new vscode.WorkspaceEdit();
  for (const item of planned) {
    const document = await vscode.workspace.openTextDocument(item.uri);
    edits.replace(item.uri, fullDocumentRange(document), item.nextContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the edit" };
  }

  return {
    ok: true,
    filesChanged: planned.length,
    usedRemoteEditor,
    appliedFiles: planned.map((item) => ({
      path: item.relativePath,
      content: item.nextContent
    })),
    undo: planned.map((item) => ({
      absolutePath: undoSnapshotPathForUri(item.uri),
      relativePath: item.relativePath,
      originalContent: item.originalContent
    }))
  };
}

export async function undoPatchApplication(
  undo: FileUndoSnapshot[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!undo.length) {
    return { ok: false, error: "Nothing to undo" };
  }

  const edits = new vscode.WorkspaceEdit();
  for (const snapshot of undo) {
    const document = await openDocumentForUndo(snapshot);
    edits.replace(document.uri, fullDocumentRange(document), snapshot.originalContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the undo" };
  }

  return { ok: true };
}

async function openDocumentForUndo(snapshot: FileUndoSnapshot): Promise<vscode.TextDocument> {
  const uri = uriFromUndoSnapshotPath(snapshot.absolutePath);
  const open = vscode.workspace.textDocuments.find(
    (doc) =>
      doc.uri.toString() === uri.toString() ||
      doc.uri.toString() === snapshot.absolutePath ||
      (uri.scheme === "untitled" &&
        doc.uri.scheme === "untitled" &&
        doc.uri.path.replace(/^\/+/, "") === uri.path.replace(/^\/+/, ""))
  );
  if (open) {
    return open;
  }
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return vscode.workspace.openTextDocument({
      content: snapshot.originalContent,
      language: languageIdForPatchPath(snapshot.relativePath)
    });
  }
}

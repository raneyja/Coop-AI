import * as vscode from "vscode";
import type { ParsedPatchSet } from "./patchParser";
import { applyHunksToContent } from "./patchContent";
import {
  resolveEditablePatchTarget,
  undoSnapshotPathForUri,
  uriFromUndoSnapshotPath
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
  | { ok: true; undo: FileUndoSnapshot[]; filesChanged: number; usedRemoteEditor: boolean }
  | { ok: false; error: string; file?: string };

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  const lastCharacter = document.lineAt(lastLine).text.length;
  return new vscode.Range(0, 0, lastLine, lastCharacter);
}

export async function applyPatchesToWorkspace(
  patches: ParsedPatchSet
): Promise<ApplyPatchesResult> {
  const planned: Array<{ uri: vscode.Uri; relativePath: string; originalContent: string; nextContent: string }> =
    [];
  let usedRemoteEditor = false;

  for (const filePatch of patches.files) {
    const target = resolveEditablePatchTarget(filePatch.relativePath);
    if (!target) {
      return {
        ok: false,
        error: `Could not resolve file: ${filePatch.relativePath}. Open it in the editor (remote tabs work), then Apply again.`,
        file: filePatch.relativePath
      };
    }

    if (target.uri.scheme !== "file") {
      usedRemoteEditor = true;
    }

    const originalContent = target.readText();
    if (originalContent === undefined) {
      return { ok: false, error: `Could not read file: ${filePatch.relativePath}`, file: filePatch.relativePath };
    }

    const applied = applyHunksToContent(originalContent, filePatch.hunks);
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
    const uri = uriFromUndoSnapshotPath(snapshot.absolutePath);
    const document = await vscode.workspace.openTextDocument(uri);
    edits.replace(uri, fullDocumentRange(document), snapshot.originalContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the undo" };
  }

  return { ok: true };
}

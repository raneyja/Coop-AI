import * as fs from "node:fs";
import * as vscode from "vscode";
import { resolveLocalAbsolutePath } from "../context/localFileResolver";
import type { ParsedPatchSet } from "./patchParser";
import { applyHunksToContent } from "./patchContent";

export { applyHunkToContent, applyHunksToContent } from "./patchContent";
export type { ApplyHunkResult } from "./patchContent";

export type FileUndoSnapshot = {
  absolutePath: string;
  relativePath: string;
  originalContent: string;
};

export type ApplyPatchesResult =
  | { ok: true; undo: FileUndoSnapshot[]; filesChanged: number }
  | { ok: false; error: string; file?: string };

function readFileUtf8(absolutePath: string): string | undefined {
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

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

  for (const filePatch of patches.files) {
    const absolutePath = resolveLocalAbsolutePath(filePatch.relativePath);
    if (!absolutePath) {
      return { ok: false, error: `Could not resolve file: ${filePatch.relativePath}`, file: filePatch.relativePath };
    }

    const originalContent = readFileUtf8(absolutePath);
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
      uri: vscode.Uri.file(absolutePath),
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
    undo: planned.map((item) => ({
      absolutePath: item.uri.fsPath,
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
    const uri = vscode.Uri.file(snapshot.absolutePath);
    const document = await vscode.workspace.openTextDocument(uri);
    edits.replace(uri, fullDocumentRange(document), snapshot.originalContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the undo" };
  }

  return { ok: true };
}

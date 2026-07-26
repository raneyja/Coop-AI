import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { resolveLocalAbsolutePath } from "../context/localFileResolver";
import { normalizeRelativePath } from "../context/localFileContext";
import { toRepositoryRelativePath } from "../context/repoFilePath";
import { isRemoteTabAbsolutePath } from "../context/githubVfsUri";
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

function pathsMatchRelative(candidate: string, target: string): boolean {
  const a = normalizeRelativePath(toRepositoryRelativePath(candidate)).toLowerCase();
  const b = normalizeRelativePath(toRepositoryRelativePath(target)).toLowerCase();
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * Prefer an already-open editor tab for this path so Apply edits that buffer
 * instead of opening a second tab with a different URI for the same file.
 */
export function findOpenDocumentForPatchPath(relativePath: string): vscode.TextDocument | undefined {
  const target = relativePath.trim();
  if (!target) {
    return undefined;
  }

  const documents = vscode.workspace.textDocuments.filter(
    (doc) => doc.uri.scheme === "file" && !doc.isUntitled
  );

  // Prefer the active / visible editor when it matches — that's the file the user is looking at.
  const preferred = [
    vscode.window.activeTextEditor?.document,
    ...vscode.window.visibleTextEditors.map((editor) => editor.document)
  ].filter((doc): doc is vscode.TextDocument => Boolean(doc));

  for (const doc of [...preferred, ...documents]) {
    if (doc.uri.scheme !== "file" || doc.isUntitled) {
      continue;
    }
    const asRelative = vscode.workspace.asRelativePath(doc.uri).replace(/\\/g, "/");
    if (!asRelative.startsWith("..") && pathsMatchRelative(asRelative, target)) {
      return doc;
    }
    const fsPath = doc.uri.fsPath.replace(/\\/g, "/");
    if (pathsMatchRelative(path.basename(fsPath), path.basename(target))) {
      // Basename-only is too weak alone; require the relative suffix to match.
      if (fsPath.toLowerCase().endsWith(`/${toRepositoryRelativePath(target).toLowerCase()}`)) {
        return doc;
      }
    }
  }

  return undefined;
}

type PlannedEdit = {
  uri: vscode.Uri;
  relativePath: string;
  absolutePath: string;
  originalContent: string;
  nextContent: string;
  existingDocument?: vscode.TextDocument;
};

function planFileEdit(relativePath: string, hunks: ParsedPatchSet["files"][number]["hunks"]): PlannedEdit | { error: string } {
  const openDoc = findOpenDocumentForPatchPath(relativePath);
  if (openDoc) {
    const originalContent = openDoc.getText();
    const applied = applyHunksToContent(originalContent, hunks);
    if (!applied.ok) {
      return { error: `${relativePath}: ${applied.error}` };
    }
    if (applied.content === originalContent) {
      return { error: "NO_CHANGE" };
    }
    return {
      uri: openDoc.uri,
      relativePath,
      absolutePath: openDoc.uri.fsPath,
      originalContent,
      nextContent: applied.content,
      existingDocument: openDoc
    };
  }

  const absolutePath = resolveLocalAbsolutePath(relativePath);
  if (!absolutePath) {
    return { error: `Could not resolve file: ${relativePath}` };
  }
  if (isRemoteTabAbsolutePath(absolutePath)) {
    return { error: `Could not apply to remote-only tab: ${relativePath}` };
  }

  const originalContent = readFileUtf8(absolutePath);
  if (originalContent === undefined) {
    return { error: `Could not read file: ${relativePath}` };
  }

  const applied = applyHunksToContent(originalContent, hunks);
  if (!applied.ok) {
    return { error: `${relativePath}: ${applied.error}` };
  }
  if (applied.content === originalContent) {
    return { error: "NO_CHANGE" };
  }

  return {
    uri: vscode.Uri.file(absolutePath),
    relativePath,
    absolutePath,
    originalContent,
    nextContent: applied.content
  };
}

async function revealExistingDocument(document: vscode.TextDocument): Promise<void> {
  const visible = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === document.uri.toString()
  );
  if (visible) {
    await vscode.window.showTextDocument(document, {
      viewColumn: visible.viewColumn,
      preview: false,
      preserveFocus: false
    });
    return;
  }
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active,
    preview: false,
    preserveFocus: false
  });
}

export async function applyPatchesToWorkspace(
  patches: ParsedPatchSet
): Promise<ApplyPatchesResult> {
  const planned: PlannedEdit[] = [];

  for (const filePatch of patches.files) {
    const plannedEdit = planFileEdit(filePatch.relativePath, filePatch.hunks);
    if ("error" in plannedEdit) {
      if (plannedEdit.error === "NO_CHANGE") {
        continue;
      }
      return { ok: false, error: plannedEdit.error, file: filePatch.relativePath };
    }
    planned.push(plannedEdit);
  }

  if (planned.length === 0) {
    return { ok: false, error: "No changes to apply" };
  }

  const edits = new vscode.WorkspaceEdit();
  for (const item of planned) {
    // Reuse the open document when present so VS Code does not open a second tab.
    const document = item.existingDocument ?? (await vscode.workspace.openTextDocument(item.uri));
    edits.replace(document.uri, fullDocumentRange(document), item.nextContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the edit" };
  }

  // Focus the buffer we actually edited (same tab), never a freshly resolved duplicate URI.
  for (const item of planned) {
    const document =
      item.existingDocument ??
      vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === item.uri.toString());
    if (document) {
      await revealExistingDocument(document);
    }
  }

  return {
    ok: true,
    filesChanged: planned.length,
    undo: planned.map((item) => ({
      absolutePath: item.absolutePath,
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
    const openDoc = findOpenDocumentForPatchPath(snapshot.relativePath);
    const uri = openDoc?.uri ?? vscode.Uri.file(snapshot.absolutePath);
    const document = openDoc ?? (await vscode.workspace.openTextDocument(uri));
    edits.replace(document.uri, fullDocumentRange(document), snapshot.originalContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the undo" };
  }

  return { ok: true };
}

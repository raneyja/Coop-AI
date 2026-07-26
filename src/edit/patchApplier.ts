import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { resolveLocalAbsolutePath } from "../context/localFileResolver";
import { normalizeRelativePath } from "../context/localFileContext";
import { toRepositoryRelativePath } from "../context/repoFilePath";
import { parseGithubVfsUri } from "../context/githubVfsUri";
import type { ParsedPatchSet } from "./patchParser";
import { applyHunksToContent } from "./patchContent";

export { applyHunkToContent, applyHunksToContent } from "./patchContent";
export type { ApplyHunkResult } from "./patchContent";

export type FileUndoSnapshot = {
  /** Exact workspace resource edited (file://, vscode-vfs://, or github://). */
  uri: string;
  relativePath: string;
  originalContent: string;
  appliedContent: string;
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

function fullContentRange(content: string): vscode.Range {
  const lines = content.split(/\r?\n/);
  const lastLine = Math.max(0, lines.length - 1);
  const lastCharacter = lines[lastLine]?.length ?? 0;
  return new vscode.Range(0, 0, lastLine, lastCharacter);
}

function pathsMatchRelative(candidate: string, target: string): boolean {
  const a = normalizeRelativePath(toRepositoryRelativePath(candidate)).toLowerCase();
  const b = normalizeRelativePath(toRepositoryRelativePath(target)).toLowerCase();
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function isEditablePatchDocument(document: vscode.TextDocument): boolean {
  return (
    !document.isUntitled &&
    (document.uri.scheme === "file" ||
      document.uri.scheme === "vscode-vfs" ||
      document.uri.scheme === "github")
  );
}

function matchesSourceFilter(
  document: vscode.TextDocument,
  source?: "local" | "remote"
): boolean {
  if (source === "remote") {
    return document.uri.scheme === "vscode-vfs" || document.uri.scheme === "github";
  }
  if (source === "local") {
    return document.uri.scheme === "file";
  }
  return true;
}

/**
 * Match by workspace-relative path only. Do NOT suffix-match across clones
 * (Desktop/Coop AI vs ~/Coop-AI) — that opened the wrong tab.
 */
function documentMatchesPatchPath(document: vscode.TextDocument, target: string): boolean {
  if (document.uri.scheme === "vscode-vfs" || document.uri.scheme === "github") {
    const remote = parseGithubVfsUri(document.uri.toString());
    return Boolean(remote?.file && pathsMatchRelative(remote.file, target));
  }

  if (document.uri.scheme !== "file") {
    return false;
  }

  // Prefer an in-workspace relative path. Outside-workspace clones of the same
  // relative path must not steal Apply from the open workspace tab.
  if (!vscode.workspace.getWorkspaceFolder(document.uri)) {
    return false;
  }

  const asRelative = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
  if (asRelative.startsWith("..") || path.isAbsolute(asRelative)) {
    return false;
  }
  return pathsMatchRelative(asRelative, target);
}

function collectEditableDocuments(source?: "local" | "remote"): vscode.TextDocument[] {
  const byUri = new Map<string, vscode.TextDocument>();

  for (const document of vscode.workspace.textDocuments) {
    if (!isEditablePatchDocument(document) || !matchesSourceFilter(document, source)) {
      continue;
    }
    byUri.set(document.uri.toString(), document);
  }

  // tabGroups sees every open tab, including ones not currently visible.
  for (const group of vscode.window.tabGroups?.all ?? []) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputText)) {
        continue;
      }
      const uriKey = input.uri.toString();
      if (byUri.has(uriKey)) {
        continue;
      }
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === uriKey
      );
      if (
        document &&
        isEditablePatchDocument(document) &&
        matchesSourceFilter(document, source)
      ) {
        byUri.set(uriKey, document);
      }
    }
  }

  return [...byUri.values()];
}

function findDocumentByExactUri(preferredUri: string): vscode.TextDocument | undefined {
  const fromDocuments = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === preferredUri && isEditablePatchDocument(document)
  );
  if (fromDocuments) {
    return fromDocuments;
  }

  for (const group of vscode.window.tabGroups?.all ?? []) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputText)) {
        continue;
      }
      if (input.uri.toString() !== preferredUri) {
        continue;
      }
      return vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === preferredUri && isEditablePatchDocument(document)
      );
    }
  }

  return undefined;
}

/**
 * Resolve the exact open resource for a patch path. Remote GitHub tabs are
 * writable virtual documents; never replace them with a same-path local clone.
 */
export function findOpenDocumentForPatchPath(
  relativePath: string,
  preferredUri?: string,
  source?: "local" | "remote"
): vscode.TextDocument | undefined {
  const target = relativePath.trim();
  if (!target) {
    return undefined;
  }

  // Absolute URI short-circuit — the tab captured at /edit send wins, always.
  if (preferredUri) {
    const exact = findDocumentByExactUri(preferredUri);
    if (exact) {
      return exact;
    }
  }

  const documents = collectEditableDocuments(source);
  const eligibleUris = new Set(documents.map((document) => document.uri.toString()));

  // With sidebar focus, activeTextEditor is often undefined — still prefer
  // visible editors that pass the local/remote filter.
  const preferred = [
    vscode.window.activeTextEditor?.document,
    ...vscode.window.visibleTextEditors.map((editor) => editor.document)
  ].filter(
    (doc): doc is vscode.TextDocument =>
      Boolean(doc && eligibleUris.has(doc.uri.toString()))
  );

  const seen = new Set<string>();
  for (const doc of [...preferred, ...documents]) {
    const key = doc.uri.toString();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (documentMatchesPatchPath(doc, target)) {
      return doc;
    }
  }

  return undefined;
}

type PlannedEdit = {
  uri: vscode.Uri;
  relativePath: string;
  originalContent: string;
  nextContent: string;
};

function sourceFromPreferredUri(preferredUri?: string): "local" | "remote" | undefined {
  if (!preferredUri) {
    return undefined;
  }
  try {
    const scheme = vscode.Uri.parse(preferredUri).scheme;
    if (scheme === "vscode-vfs" || scheme === "github") {
      return "remote";
    }
    if (scheme === "file") {
      return "local";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function planFileEdit(
  relativePath: string,
  hunks: ParsedPatchSet["files"][number]["hunks"],
  preferredUri?: string
): PlannedEdit | { error: string } {
  const openDoc = findOpenDocumentForPatchPath(
    relativePath,
    preferredUri,
    sourceFromPreferredUri(preferredUri)
  );
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
      originalContent,
      nextContent: applied.content
    };
  }

  if (preferredUri) {
    const preferred = vscode.Uri.parse(preferredUri);
    if (preferred.scheme === "vscode-vfs" || preferred.scheme === "github") {
      return {
        error: `The original remote tab is no longer open: ${relativePath}. Reopen it and run /edit again.`
      };
    }
    // Local capture existed but the tab closed — refuse silent cross-clone open.
    return {
      error: `The original editor tab is no longer open: ${relativePath}. Reopen it and run /edit again.`
    };
  }

  const absolutePath = resolveLocalAbsolutePath(relativePath);
  if (!absolutePath) {
    return { error: `Could not resolve file: ${relativePath}` };
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
    originalContent,
    nextContent: applied.content
  };
}

export async function applyPatchesToWorkspace(
  patches: ParsedPatchSet,
  preferredUri?: string
): Promise<ApplyPatchesResult> {
  const planned: PlannedEdit[] = [];

  for (const filePatch of patches.files) {
    const plannedEdit = planFileEdit(filePatch.relativePath, filePatch.hunks, preferredUri);
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
    edits.replace(item.uri, fullContentRange(item.originalContent), item.nextContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the edit" };
  }

  return {
    ok: true,
    filesChanged: planned.length,
    undo: planned.map((item) => ({
      uri: item.uri.toString(),
      relativePath: item.relativePath,
      originalContent: item.originalContent,
      appliedContent: item.nextContent
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
    const uri = vscode.Uri.parse(snapshot.uri);
    edits.replace(uri, fullContentRange(snapshot.appliedContent), snapshot.originalContent);
  }

  const success = await vscode.workspace.applyEdit(edits);
  if (!success) {
    return { ok: false, error: "VS Code rejected the undo" };
  }

  return { ok: true };
}

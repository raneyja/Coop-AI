import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CodeHostProviderPreference } from "../chat/types";
import { readCodeHostProvider } from "../config/codeHostConfig";
import { findEditorForRepoFile } from "../context/editorFileContext";
import { parseGithubVfsUri, pathsReferToSameFile, isRemoteTabAbsolutePath } from "../context/githubVfsUri";
import { resolveLocalAbsolutePath } from "../context/localFileResolver";
import { toRepositoryRelativePath } from "../context/repoFilePath";
import { openRemoteFileInEditor } from "../workspace/repoEditorOpener";
import { findAllSearchMatches } from "./patchContent";
import { lookupPatchFileContent } from "./patchFileContents";
import {
  githubRemoteOpenFailedMessage,
  missingPatchTargetMessage,
  remoteOpenUnsupportedMessage,
  type PatchSessionRepo
} from "./patchSessionContract";

export type EditablePatchTarget = {
  uri: vscode.Uri;
  /** Live buffer text when the document is open; disk read for local files. */
  readText: () => string | undefined;
};

export type OpenRemotePatchFile = (params: {
  owner: string;
  repo: string;
  filePath: string;
  provider?: CodeHostProviderPreference;
  branch?: string;
  preserveSidebarFocus?: boolean;
  allowLocalClone?: boolean;
}) => Promise<boolean>;

export type EnsurePatchTargetOptions = {
  repo?: PatchSessionRepo;
  openRemoteFile?: OpenRemotePatchFile;
  /** Captured full-file bytes from /edit send (Zero-Clone untitled buffers have no path). */
  fileContents?: Readonly<Record<string, string>>;
  /** First SEARCH block — used to find an untitled API tab of the same file. */
  search?: string;
};

export function languageIdForPatchPath(relativePath: string): string | undefined {
  const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "py") {
    return "python";
  }
  if (ext === "ts") {
    return "typescript";
  }
  if (ext === "tsx") {
    return "typescriptreact";
  }
  if (ext === "js") {
    return "javascript";
  }
  if (ext === "jsx") {
    return "javascriptreact";
  }
  if (ext === "json") {
    return "json";
  }
  if (ext === "md") {
    return "markdown";
  }
  return undefined;
}

function normalizeCompareText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function targetFromDocument(doc: vscode.TextDocument): EditablePatchTarget {
  return {
    uri: doc.uri,
    readText: () => doc.getText()
  };
}

/**
 * Untitled API tabs (no GitHub Repositories) have no repo path on the URI.
 * Match by exact captured bytes, then by a unique SEARCH hit.
 */
export function findOpenDocumentForPatchFile(
  relativePath: string,
  options?: { capturedContent?: string; search?: string }
): vscode.TextDocument | undefined {
  const normalized = toRepositoryRelativePath(relativePath);
  const captured = options?.capturedContent
    ? normalizeCompareText(options.capturedContent)
    : undefined;
  let contentMatch: vscode.TextDocument | undefined;
  let searchMatch: vscode.TextDocument | undefined;
  let searchHits = 0;
  for (const doc of vscode.workspace.textDocuments) {
    if (normalized && documentMatchesPatchPath(doc, normalized)) {
      return doc;
    }
    const text = normalizeCompareText(doc.getText());
    if (captured && text === captured) {
      contentMatch = doc;
    }
    const search = options?.search?.trim();
    if (search && findAllSearchMatches(doc.getText(), search).length > 0) {
      searchHits += 1;
      searchMatch = doc;
    }
  }
  if (contentMatch) {
    return contentMatch;
  }
  if (searchHits === 1) {
    return searchMatch;
  }
  return undefined;
}

export type RememberedRemoteBuffer = {
  uriString: string;
  content: string;
  owner?: string;
  repo?: string;
};

const rememberedRemoteBuffers = new Map<string, RememberedRemoteBuffer>();

function normalizeBufferKey(relativePath: string): string {
  return (toRepositoryRelativePath(relativePath) ?? relativePath).replace(/\\/g, "/").replace(/^\.?\//, "");
}

function rememberedRemoteEntry(relativePath: string): RememberedRemoteBuffer | undefined {
  const key = normalizeBufferKey(relativePath);
  const direct = rememberedRemoteBuffers.get(key);
  if (direct) {
    return direct;
  }
  for (const [stored, value] of rememberedRemoteBuffers) {
    if (pathsReferToSameFile(stored, key)) {
      return value;
    }
  }
  return undefined;
}

/** Bitbucket/GitLab Zero-Clone tabs are untitled — remember path → buffer at open. */
export function rememberRemotePatchBuffer(
  relativePath: string,
  uri: vscode.Uri,
  content: string,
  identity?: { owner?: string; repo?: string }
): void {
  const key = normalizeBufferKey(relativePath);
  if (!key || !content.trim()) {
    return;
  }
  rememberedRemoteBuffers.set(key, {
    uriString: uri.toString(),
    content,
    owner: identity?.owner?.trim() || undefined,
    repo: identity?.repo?.trim() || undefined
  });
}

export function listRememberedRemoteBuffers(): Array<{ path: string } & RememberedRemoteBuffer> {
  return [...rememberedRemoteBuffers.entries()].map(([path, value]) => ({ path, ...value }));
}

export function rememberedRemoteBufferForUri(
  uriString: string
): ({ path: string } & RememberedRemoteBuffer) | undefined {
  const wanted = uriString.trim();
  if (!wanted) {
    return undefined;
  }
  for (const [path, value] of rememberedRemoteBuffers) {
    if (value.uriString === wanted) {
      return { path, ...value };
    }
  }
  return undefined;
}

export function clearRemotePatchBuffersForTests(): void {
  rememberedRemoteBuffers.clear();
}

function liveDocumentForUriString(uriString: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uriString);
}

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
    if (pathsReferToSameFile(parsed.file, normalized)) {
      return true;
    }
  }

  const pathPart = doc.uri.path.replace(/^\/+/, "").split("?")[0] ?? "";
  if (pathPart && (pathsReferToSameFile(pathPart, normalized) || pathPart.endsWith(`/${normalized}`))) {
    return true;
  }
  return false;
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

  const remembered = rememberedRemoteEntry(normalized);
  if (remembered) {
    const live = liveDocumentForUriString(remembered.uriString);
    if (live) {
      return targetFromDocument(live);
    }
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

/** Use-repo from Coop settings — same keys as the chat Use-repo picker. */
export function readPatchApplyRepoFromConfig(): PatchSessionRepo | undefined {
  const config = vscode.workspace.getConfiguration("coopAI");
  const owner = (config.get<string>("defaultOwner", "") ?? "").trim();
  const repo = (config.get<string>("defaultRepo", "") ?? "").trim();
  if (!owner || !repo) {
    return undefined;
  }
  const provider = readCodeHostProvider(config.get<string>("defaultCodeHost", "github") ?? "github");
  const branch = (config.get<string>("defaultBranch", "") ?? "").trim() || undefined;
  return { owner, repo, provider, branch };
}

/**
 * Resolve a patch target, auto-opening GitHub VFS files that are not already in an editor.
 * GitLab/Bitbucket: honest error — do not fake VFS success.
 */
export async function ensureEditablePatchTarget(
  relativePath: string,
  options?: EnsurePatchTargetOptions
): Promise<
  | { ok: true; target: EditablePatchTarget; usedRemoteOpen: boolean }
  | { ok: false; error: string }
> {
  const existing = resolveEditablePatchTarget(relativePath);
  if (existing) {
    return { ok: true, target: existing, usedRemoteOpen: false };
  }

  const captured = lookupPatchFileContent(relativePath, options?.fileContents);
  const openDoc = findOpenDocumentForPatchFile(relativePath, {
    capturedContent: captured,
    search: options?.search
  });
  if (openDoc) {
    return { ok: true, target: targetFromDocument(openDoc), usedRemoteOpen: false };
  }

  const repo = options?.repo ?? readPatchApplyRepoFromConfig();
  if (!repo) {
    if (captured?.trim()) {
      return openCapturedAsUntitled(relativePath, captured);
    }
    return { ok: false, error: missingPatchTargetMessage(relativePath) };
  }

  const provider = repo.provider ?? "github";
  if (provider === "github") {
    const opener: OpenRemotePatchFile =
      options?.openRemoteFile ??
      ((params) =>
        openRemoteFileInEditor({
          owner: params.owner,
          repo: params.repo,
          filePath: params.filePath,
          provider: "github",
          branch: params.branch,
          preserveSidebarFocus: true,
          allowLocalClone: false
        }));

    let opened = false;
    try {
      opened = await opener({
        owner: repo.owner,
        repo: repo.repo,
        filePath: relativePath,
        provider: "github",
        branch: repo.branch,
        preserveSidebarFocus: true,
        allowLocalClone: false
      });
    } catch {
      opened = false;
    }

    if (opened) {
      const after = resolveEditablePatchTarget(relativePath);
      if (after) {
        return { ok: true, target: after, usedRemoteOpen: true };
      }
    }
  } else if (!captured?.trim()) {
    return { ok: false, error: remoteOpenUnsupportedMessage(relativePath, provider) };
  }

  if (captured?.trim()) {
    return openCapturedAsUntitled(relativePath, captured);
  }

  if (provider !== "github") {
    return { ok: false, error: remoteOpenUnsupportedMessage(relativePath, provider) };
  }
  return { ok: false, error: githubRemoteOpenFailedMessage(relativePath) };
}

async function openCapturedAsUntitled(
  relativePath: string,
  captured: string
): Promise<{ ok: true; target: EditablePatchTarget; usedRemoteOpen: boolean }> {
  const doc = await vscode.workspace.openTextDocument({
    content: captured,
    language: languageIdForPatchPath(relativePath)
  });
  await vscode.window.showTextDocument(doc, {
    preview: false,
    preserveFocus: true
  });
  return { ok: true, target: targetFromDocument(doc), usedRemoteOpen: true };
}

export function uriFromUndoSnapshotPath(absolutePath: string): vscode.Uri {
  if (isRemoteTabAbsolutePath(absolutePath) || /^untitled:/i.test(absolutePath)) {
    return vscode.Uri.parse(absolutePath);
  }
  return vscode.Uri.file(absolutePath);
}

export function undoSnapshotPathForUri(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

/** Read bytes from any open tab (including hidden GitHub VFS docs), not only the visible editor. */
export function collectOpenPatchFileBytes(
  relativePath: string,
  options?: { search?: string }
): string | undefined {
  const normalized = toRepositoryRelativePath(relativePath);
  if (!normalized) {
    return undefined;
  }
  for (const doc of vscode.workspace.textDocuments) {
    if (!documentMatchesPatchPath(doc, normalized)) {
      continue;
    }
    const text = doc.getText();
    if (text.trim()) {
      return text;
    }
  }

  const remembered = rememberedRemoteEntry(normalized);
  if (remembered) {
    const live = liveDocumentForUriString(remembered.uriString);
    const liveText = live?.getText();
    if (liveText?.trim()) {
      return liveText;
    }
  }

  const openDoc = findOpenDocumentForPatchFile(normalized, {
    capturedContent: remembered?.content,
    search: options?.search
  });
  if (openDoc?.getText().trim()) {
    return openDoc.getText();
  }

  if (remembered?.content.trim()) {
    return remembered.content;
  }

  return resolveEditablePatchTarget(normalized)?.readText();
}

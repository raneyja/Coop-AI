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

  const repo = options?.repo ?? readPatchApplyRepoFromConfig();
  if (!repo) {
    return { ok: false, error: missingPatchTargetMessage(relativePath) };
  }

  const provider = repo.provider ?? "github";
  if (provider !== "github") {
    return { ok: false, error: remoteOpenUnsupportedMessage(relativePath, provider) };
  }

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

  if (!opened) {
    return { ok: false, error: githubRemoteOpenFailedMessage(relativePath) };
  }

  const after = resolveEditablePatchTarget(relativePath);
  if (!after) {
    return {
      ok: false,
      error: `Opened ${relativePath} but could not read it. Try Apply again.`
    };
  }
  return { ok: true, target: after, usedRemoteOpen: true };
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

/** Read bytes from any open tab (including hidden GitHub VFS docs), not only the visible editor. */
export function collectOpenPatchFileBytes(relativePath: string): string | undefined {
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
  return resolveEditablePatchTarget(normalized)?.readText();
}

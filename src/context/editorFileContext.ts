import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { RepoContext } from "../chat/types";
import {
  isLocalDiskFileSource,
  normalizeRelativePath,
  sliceFileContent,
  type LocalFileContextPayload
} from "./localFileContext";
import { resolveLocalAbsolutePath } from "./localFileResolver";
import { parseGithubRemoteFromGitConfig } from "./gitRemoteConfig";
import { toRepositoryRelativePath } from "./repoFilePath";

export type EditorFileSource = "workspace" | "git" | "remote" | "external";

export type ResolvedEditorFile = {
  file?: string;
  fileSource: EditorFileSource;
  gitRoot?: string;
  owner?: string;
  repo?: string;
  warning?: string;
};

/**
 * Map the active editor file to a GitHub-friendly repo-relative path.
 * Cmd+O can open files outside the VS Code workspace; those must not be sent as absolute paths.
 */
export function resolveEditorFile(editor: vscode.TextEditor): ResolvedEditorFile {
  const uri = editor.document.uri;
  if (uri.scheme === "vscode-vfs" || uri.scheme === "github") {
    const remote = parseVfsGithubFile(uri);
    if (remote) {
      return {
        file: toRepositoryRelativePath(remote.file),
        fileSource: "remote",
        owner: remote.owner,
        repo: remote.repo
      };
    }
  }
  if (uri.scheme !== "file") {
    return {
      fileSource: "external",
      warning: "Only files on disk can be linked to GitHub. Open a local clone with File → Open Folder."
    };
  }

  const fsPath = uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    const relative = path.relative(workspaceFolder.uri.fsPath, fsPath).replace(/\\/g, "/");
    return {
      file: toRepositoryRelativePath(relative),
      fileSource: "workspace",
      gitRoot: workspaceFolder.uri.fsPath
    };
  }

  const gitRoot = findGitRoot(fsPath);
  if (gitRoot) {
    const relative = path.relative(gitRoot, fsPath).replace(/\\/g, "/");
    const remote = readGithubRemote(gitRoot);
    return {
      file: toRepositoryRelativePath(relative),
      fileSource: "git",
      gitRoot,
      owner: remote?.owner,
      repo: remote?.repo,
      warning:
        "This file was opened outside the workspace folder (e.g. Cmd+O). CoopAI is using the git repo on disk for the file path" +
        (remote ? ` (${remote.owner}/${remote.repo}).` : ". Set Owner/Repo in settings if Trace Decision targets GitHub.")
    };
  }

  return {
    file: fsPath.replace(/\\/g, "/"),
    fileSource: "external"
  };
}

function parseVfsGithubFile(uri: vscode.Uri): { owner: string; repo: string; file: string } | undefined {
  const candidates = [uri.path, uri.fsPath, uri.toString()];
  for (const candidate of candidates) {
    const parsed = parseVfsGithubPath(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function parseVfsGithubPath(raw: string): { owner: string; repo: string; file: string } | undefined {
  const normalized = raw
    .replace(/^vscode-vfs:\/\/github/i, "")
    .replace(/^github:\/\//i, "")
    .replace(/^\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() === "github") {
    segments.shift();
  }
  if (segments.length < 3) {
    return undefined;
  }
  const [owner, repo, ...rest] = segments;
  if (!owner || !repo || rest.length === 0) {
    return undefined;
  }
  return { owner, repo, file: rest.join("/") };
}

function findGitRoot(filePath: string): string | undefined {
  let dir = path.dirname(filePath);
  const { root } = path.parse(dir);
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

function readGithubRemote(gitRoot: string): { owner: string; repo: string } | undefined {
  const configPath = path.join(gitRoot, ".git", "config");
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  try {
    const text = fs.readFileSync(configPath, "utf8");
    const remote = parseGithubRemoteFromGitConfig(text);
    if (remote) {
      return remote;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function findEditorForRepoFile(
  relativePath: string,
  options?: { includeRemote?: boolean; includeExternal?: boolean }
): vscode.TextEditor | undefined {
  const preferred = relativePath.trim().replace(/\\/g, "/");
  const normalized = preferred.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(preferred)
    ? preferred
    : normalizeRelativePath(preferred);
  const matchesPath = (resolved: ResolvedEditorFile): boolean => {
    if (!resolved.file?.trim()) {
      return false;
    }
    const fileNorm = resolved.file.replace(/\\/g, "/");
    const fileCmp =
      fileNorm.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(fileNorm)
        ? fileNorm
        : normalizeRelativePath(fileNorm);
    if (
      fileCmp === normalized ||
      fileCmp.endsWith(`/${normalized}`) ||
      normalized.endsWith(`/${fileCmp}`) ||
      fileNorm === preferred
    ) {
      if (resolved.fileSource === "external") {
        return options?.includeExternal === true || options?.includeRemote === true;
      }
      if (options?.includeRemote) {
        return true;
      }
      return isLocalDiskFileSource(resolved.fileSource);
    }
    return false;
  };

  for (const editor of vscode.window.visibleTextEditors) {
    if (matchesPath(resolveEditorFile(editor))) {
      return editor;
    }
  }
  const active = vscode.window.activeTextEditor;
  if (active && matchesPath(resolveEditorFile(active))) {
    return active;
  }
  return undefined;
}

export function findEditorForRemoteFile(
  owner: string,
  repo: string,
  relativePath: string
): vscode.TextEditor | undefined {
  const normalized = normalizeRelativePath(relativePath.replace(/^\/+/, ""));

  for (const editor of vscode.window.visibleTextEditors) {
    const resolved = resolveEditorFile(editor);
    if (!resolved.file?.trim()) {
      continue;
    }
    const ownerMatch =
      !resolved.owner ||
      resolved.owner.localeCompare(owner, undefined, { sensitivity: "accent" }) === 0;
    const repoMatch =
      !resolved.repo || resolved.repo.localeCompare(repo, undefined, { sensitivity: "accent" }) === 0;
    if (!ownerMatch || !repoMatch) {
      continue;
    }
    const fileNorm = normalizeRelativePath(resolved.file);
    if (
      fileNorm === normalized ||
      fileNorm.endsWith(`/${normalized}`) ||
      normalized.endsWith(`/${fileNorm}`)
    ) {
      return editor;
    }
  }

  return undefined;
}

function editorHasReadableFile(editor: vscode.TextEditor): boolean {
  return Boolean(resolveEditorFile(editor).file?.trim());
}

function pathsMatchPreferred(resolvedFile: string, preferredPath?: string): boolean {
  if (!preferredPath?.trim()) {
    return true;
  }
  const preferred = preferredPath.trim().replace(/\\/g, "/");
  const fileNorm = resolvedFile.replace(/\\/g, "/");
  // Absolute OS paths (Downloads / Cmd+O): exact match only — basename endsWith grabbed wrong tabs.
  if (
    preferred.startsWith("/Users/") ||
    preferred.startsWith("/home/") ||
    preferred.startsWith("/tmp/") ||
    preferred.startsWith("/var/") ||
    preferred.startsWith("/private/") ||
    /^[a-zA-Z]:[\\/]/.test(preferred) ||
    /^Users\/[^/]+\//i.test(preferred) ||
    /^home\/[^/]+\//i.test(preferred)
  ) {
    const preferredAbs = preferred.startsWith("Users/") || preferred.startsWith("home/")
      ? `/${preferred}`
      : preferred;
    return fileNorm === preferredAbs || fileNorm === preferred;
  }
  const normalized = normalizeRelativePath(preferred);
  const fileRel = normalizeRelativePath(fileNorm);
  return (
    fileRel === normalized ||
    fileRel.endsWith(`/${normalized}`) ||
    normalized.endsWith(`/${fileRel}`) ||
    fileNorm === preferred
  );
}

/** Prefer matching path, then any visible editor with readable content (including external). */
export function pickEditorForContext(preferredPath?: string): vscode.TextEditor | undefined {
  if (preferredPath?.trim()) {
    // When a specific path is requested, never fall back to an unrelated active tab —
    // that made the file picker "open" CoopSettingsPanel instead of the picked file.
    return findMatchingEditorForPreferredPath(preferredPath, { includeRemote: true });
  }

  const active = vscode.window.activeTextEditor;
  if (active && editorHasReadableFile(active)) {
    return active;
  }

  for (const editor of vscode.window.visibleTextEditors) {
    if (editorHasReadableFile(editor)) {
      return editor;
    }
  }

  return undefined;
}

/**
 * Prefer matching path, then any visible on-disk editor (workspace / git / external).
 * Chat webview steals editor focus — visible tabs still count.
 */
export function pickLocalEditorForContext(preferredPath?: string): vscode.TextEditor | undefined {
  if (preferredPath?.trim()) {
    return findMatchingEditorForPreferredPath(preferredPath, { includeRemote: false });
  }

  const active = vscode.window.activeTextEditor;
  if (active?.document.uri.scheme === "file") {
    const resolved = resolveEditorFile(active);
    if (resolved.file?.trim() && (isLocalDiskFileSource(resolved.fileSource) || resolved.fileSource === "external")) {
      return active;
    }
  }

  return vscode.window.visibleTextEditors.find((editor) => {
    if (editor.document.uri.scheme !== "file") {
      return false;
    }
    const resolved = resolveEditorFile(editor);
    return Boolean(
      resolved.file?.trim() &&
        (isLocalDiskFileSource(resolved.fileSource) || resolved.fileSource === "external")
    );
  });
}

/** Match preferred path only — no fallback to a different open file. */
function findMatchingEditorForPreferredPath(
  preferredPath: string,
  options: { includeRemote: boolean }
): vscode.TextEditor | undefined {
  const matched = findEditorForRepoFile(preferredPath, {
    includeRemote: options.includeRemote,
    includeExternal: true
  });
  if (matched) {
    return matched;
  }
  for (const editor of [
    vscode.window.activeTextEditor,
    ...vscode.window.visibleTextEditors
  ].filter(Boolean) as vscode.TextEditor[]) {
    if (!options.includeRemote && editor.document.uri.scheme !== "file") {
      continue;
    }
    const resolved = resolveEditorFile(editor);
    if (resolved.file?.trim() && pathsMatchPreferred(resolved.file, preferredPath)) {
      return editor;
    }
  }
  return undefined;
}

/**
 * Attach an outside-workspace / Cmd+O buffer for plain chat (ChatGPT-style file attach).
 * Does not invent a repo-relative path — callers must keep fileSource "external".
 */
export function readExternalOpenFileForChat(options?: {
  selectedLines?: [number, number];
  fullFile?: boolean;
  /** Prefer this absolute path when multiple external tabs are open. */
  preferredPath?: string;
}): LocalFileContextPayload | undefined {
  const candidates: vscode.TextEditor[] = [];
  const active = vscode.window.activeTextEditor;
  if (active) {
    candidates.push(active);
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor !== active) {
      candidates.push(editor);
    }
  }

  const preferred = options?.preferredPath?.trim().replace(/\\/g, "/");
  if (preferred) {
    const preferredIdx = candidates.findIndex((editor) => {
      if (editor.document.uri.scheme !== "file") {
        return false;
      }
      const resolved = resolveEditorFile(editor);
      return (
        resolved.fileSource === "external" &&
        Boolean(resolved.file?.trim()) &&
        pathsMatchPreferred(resolved.file!, preferred)
      );
    });
    if (preferredIdx > 0) {
      const [match] = candidates.splice(preferredIdx, 1);
      candidates.unshift(match);
    }
  }

  for (const editor of candidates) {
    if (editor.document.uri.scheme !== "file") {
      continue;
    }
    const resolved = resolveEditorFile(editor);
    if (resolved.fileSource !== "external") {
      continue;
    }
    const raw = editor.document.getText();
    if (!raw.trim()) {
      continue;
    }
    const absolutePath = editor.document.uri.fsPath.replace(/\\/g, "/");
    const lines =
      options?.fullFile || !options?.selectedLines
        ? undefined
        : { start: options.selectedLines[0], end: options.selectedLines[1] };
    const sliced = sliceFileContent(raw, lines);
    return {
      source: "local-workspace",
      activeFile: absolutePath,
      files: [
        {
          path: absolutePath,
          content: sliced.content,
          encoding: "utf8",
          ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
        }
      ],
      fallbackLevel: "partial"
    };
  }
  return undefined;
}

/** Read live editor buffer content for chat (includes unsaved edits; local, remote, or external). */
export function readActiveEditorFileForChat(
  ctx: Pick<RepoContext, "file" | "fileSource" | "selectedLines">
): LocalFileContextPayload | undefined {
  const editor = pickEditorForContext(ctx.file);
  if (!editor) {
    return undefined;
  }

  const resolved = resolveEditorFile(editor);
  if (!resolved.file?.trim()) {
    return undefined;
  }

  // Outside-workspace: keep absolute path; do not strip to a fake repo-relative path.
  const pathForChat =
    resolved.fileSource === "external"
      ? resolved.file.replace(/\\/g, "/")
      : normalizeRelativePath(resolved.file);
  const sliced = sliceFileContent(
    editor.document.getText(),
    ctx.selectedLines ? { start: ctx.selectedLines[0], end: ctx.selectedLines[1] } : undefined
  );

  return {
    source: "local-workspace",
    activeFile: pathForChat,
    files: [
      {
        path: pathForChat,
        content: sliced.content,
        encoding: "utf8",
        ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
      }
    ],
    fallbackLevel: "partial"
  };
}

function revealLineInEditor(editor: vscode.TextEditor, line?: number): void {
  if (!line) {
    return;
  }
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/** Focus an open tab or open a workspace file in the main editor (user-initiated navigation). */
export async function focusRepoFileInEditor(path: string, line?: number): Promise<boolean> {
  // Must match `path` — pickEditorForContext(path) no longer returns unrelated tabs.
  const existing = pickEditorForContext(path);
  if (existing) {
    const resolved = resolveEditorFile(existing);
    if (resolved.file?.trim() && pathsMatchPreferred(resolved.file, path)) {
      const editor = await vscode.window.showTextDocument(existing.document, {
        viewColumn: existing.viewColumn ?? vscode.ViewColumn.One,
        preview: false,
        preserveFocus: false
      });
      revealLineInEditor(editor, line);
      return true;
    }
  }

  const absolute = resolveLocalAbsolutePath(path);
  if (absolute) {
    try {
      const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolute), {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
        preserveFocus: false
      });
      revealLineInEditor(editor, line);
      return true;
    } catch {
      try {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(absolute));
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}
export { parseGithubRemoteFromGitConfig } from "./gitRemoteConfig";

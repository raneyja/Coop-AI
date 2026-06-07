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
    fileSource: "external",
    warning:
      "This file is not in your opened workspace or a git repo. Use File → Open Folder on the project clone, or pick a file from the remote tree in chat."
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
  options?: { includeRemote?: boolean }
): vscode.TextEditor | undefined {
  const normalized = normalizeRelativePath(relativePath);
  const matchesPath = (resolved: ResolvedEditorFile): boolean => {
    if (!resolved.file?.trim()) {
      return false;
    }
    const fileNorm = normalizeRelativePath(resolved.file);
    if (fileNorm === normalized || fileNorm.endsWith(`/${normalized}`) || normalized.endsWith(`/${fileNorm}`)) {
      if (options?.includeRemote) {
        return resolved.fileSource !== "external";
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

/** Prefer matching path, then any visible editor with readable content (local or GitHub remote). */
export function pickEditorForContext(preferredPath?: string): vscode.TextEditor | undefined {
  const normalized = preferredPath?.trim() ? normalizeRelativePath(preferredPath) : undefined;
  if (normalized) {
    return findEditorForRepoFile(normalized, { includeRemote: true });
  }

  for (const editor of vscode.window.visibleTextEditors) {
    const resolved = resolveEditorFile(editor);
    if (resolved.file?.trim() && resolved.fileSource !== "external") {
      return editor;
    }
  }

  const active = vscode.window.activeTextEditor;
  if (active) {
    const resolved = resolveEditorFile(active);
    if (resolved.file?.trim() && resolved.fileSource !== "external") {
      return active;
    }
  }

  return undefined;
}

/** Prefer matching path, then any visible on-disk editor (chat webview steals editor focus). */
export function pickLocalEditorForContext(preferredPath?: string): vscode.TextEditor | undefined {
  const normalized = preferredPath?.trim() ? normalizeRelativePath(preferredPath) : undefined;
  if (normalized) {
    const matched = findEditorForRepoFile(normalized);
    if (matched) {
      return matched;
    }
  }

  const active = vscode.window.activeTextEditor;
  if (active?.document.uri.scheme === "file") {
    const resolved = resolveEditorFile(active);
    if (isLocalDiskFileSource(resolved.fileSource)) {
      return active;
    }
  }

  return vscode.window.visibleTextEditors.find((editor) => {
    if (editor.document.uri.scheme !== "file") {
      return false;
    }
    return isLocalDiskFileSource(resolveEditorFile(editor).fileSource);
  });
}

/** Read live editor buffer content for chat (includes unsaved edits; local or remote tab). */
export function readActiveEditorFileForChat(
  ctx: Pick<RepoContext, "file" | "fileSource" | "selectedLines">
): LocalFileContextPayload | undefined {
  const editor = pickEditorForContext(ctx.file);
  if (!editor) {
    return undefined;
  }

  const resolved = resolveEditorFile(editor);
  if (!resolved.file?.trim() || resolved.fileSource === "external") {
    return undefined;
  }

  const normalized = normalizeRelativePath(resolved.file);
  const sliced = sliceFileContent(
    editor.document.getText(),
    ctx.selectedLines ? { start: ctx.selectedLines[0], end: ctx.selectedLines[1] } : undefined
  );

  return {
    source: "local-workspace",
    activeFile: normalized,
    files: [
      {
        path: normalized,
        content: sliced.content,
        encoding: "utf8",
        ...(sliced.lineRange ? { lineRange: sliced.lineRange } : {})
      }
    ],
    fallbackLevel: "partial"
  };
}

export function parseGithubRemoteFromGitConfig(config: string): { owner: string; repo: string } | undefined {
  const originBlock = config.match(/\[remote "origin"\][\s\S]*?(?=\[|$)/i);
  const searchText = originBlock?.[0] ?? config;
  const urlMatch = searchText.match(/url\s*=\s*(.+)/i);
  if (!urlMatch) {
    return undefined;
  }
  const url = urlMatch[1].trim();
  const ssh = url.match(/git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?/i);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2] };
  }
  const https = url.match(/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?/i);
  if (https) {
    return { owner: https[1], repo: https[2] };
  }
  return undefined;
}

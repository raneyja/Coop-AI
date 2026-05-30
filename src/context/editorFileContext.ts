import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { toRepositoryRelativePath } from "./repoFilePath";

export type EditorFileSource = "workspace" | "git" | "external";

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

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CodeHostProviderPreference } from "../chat/types";
import { parseGithubRemoteFromGitConfig } from "../context/editorFileContext";

export type OpenRepoInEditorMode = "preferLocal" | "remote" | "ask" | "off";

export type OpenRepoInEditorResult =
  | { status: "skipped" }
  | { status: "already-open"; localPath: string }
  | { status: "opened-local"; localPath: string }
  | { status: "opened-remote" }
  | { status: "unavailable"; reason: string };

const GITHUB_REMOTEHUB_EXTENSION_IDS = [
  "GitHub.remotehub",
  "ms-vscode.remote-repositories",
  "github.remotehub"
] as const;

const COMMON_CLONE_ROOT_SEGMENTS = ["Desktop", "Projects", "Developer", "dev", "src", "repos", "code", "work"];

export function readOpenRepoInEditorMode(): OpenRepoInEditorMode {
  const value = vscode.workspace.getConfiguration("coopAI").get<string>("openRepoInEditor", "preferLocal");
  if (value === "preferLocal" || value === "remote" || value === "ask" || value === "off") {
    return value;
  }
  return "preferLocal";
}

/** When true, open the repository in a separate editor window (CoopAI stays in this one). */
export function readOpenRepoInNewWindow(): boolean {
  return vscode.workspace.getConfiguration("coopAI").get<boolean>("openRepoInNewWindow", false);
}

const EDITOR_OPEN_OPTIONS: vscode.TextDocumentShowOptions = {
  viewColumn: vscode.ViewColumn.One,
  preview: false,
  preserveFocus: true
};

export function repoMatchesRemote(
  owner: string,
  repo: string,
  provider: CodeHostProviderPreference | undefined,
  gitRoot: string
): boolean {
  const configPath = path.join(gitRoot, ".git", "config");
  if (!fs.existsSync(configPath)) {
    return false;
  }
  try {
    const text = fs.readFileSync(configPath, "utf8");
    const host = provider ?? "github";
    const parsed =
      host === "github"
        ? parseGithubRemoteFromGitConfig(text)
        : host === "gitlab"
          ? parseGitlabRemoteFromGitConfig(text)
          : parseBitbucketRemoteFromGitConfig(text);
    if (!parsed) {
      return false;
    }
    return (
      parsed.owner.localeCompare(owner, undefined, { sensitivity: "accent" }) === 0 &&
      parsed.repo.localeCompare(repo, undefined, { sensitivity: "accent" }) === 0
    );
  } catch {
    return false;
  }
}

export async function findLocalClone(
  owner: string,
  repo: string,
  provider?: CodeHostProviderPreference
): Promise<string | undefined> {
  const seen = new Set<string>();
  for (const root of [...(await collectCandidateGitRoots()), ...collectCommonCloneRoots()]) {
    const normalized = path.normalize(root);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (repoMatchesRemote(owner, repo, provider, normalized)) {
      return normalized;
    }
  }
  return undefined;
}

export function isRepoOpenInWorkspace(localPath: string): boolean {
  const normalized = path.normalize(localPath);
  return (vscode.workspace.workspaceFolders ?? []).some(
    (folder) => path.normalize(folder.uri.fsPath) === normalized
  );
}

export function isRepoOpenInEditorWorkspace(
  owner: string,
  repo: string,
  provider: CodeHostProviderPreference = "github"
): boolean {
  const slug = `${owner}/${repo}`.toLowerCase();
  return (vscode.workspace.workspaceFolders ?? []).some((folder) => {
    if (folder.uri.scheme === "vscode-vfs") {
      const vfsPath = folder.uri.path.replace(/^\//, "").toLowerCase();
      return vfsPath === slug || vfsPath.startsWith(`${slug}/`);
    }
    const gitRoot = findGitRoot(folder.uri.fsPath) ?? folder.uri.fsPath;
    return repoMatchesRemote(owner, repo, provider, gitRoot);
  });
}

export function buildGithubRepoWebUrl(owner: string, repo: string, branch?: string): string {
  const base = `https://github.com/${owner}/${repo}`;
  const trimmed = branch?.trim();
  if (!trimmed) {
    return base;
  }
  return `${base}/tree/${encodeURIComponent(trimmed)}`;
}

export function isGithubRemoteHubInstalled(): boolean {
  return GITHUB_REMOTEHUB_EXTENSION_IDS.some((id) => Boolean(vscode.extensions.getExtension(id)));
}

export function githubRepoVfsUri(owner: string, repo: string): vscode.Uri {
  return vscode.Uri.parse(`vscode-vfs://github/${owner}/${repo}`);
}

export function githubRepoFileVfsUri(owner: string, repo: string, filePath: string): vscode.Uri {
  const relative = filePath.replace(/^\/+/, "");
  return vscode.Uri.parse(`vscode-vfs://github/${owner}/${repo}/${relative}`);
}

export async function openRemoteFileInEditor(params: {
  owner: string;
  repo: string;
  filePath: string;
  line?: number;
  provider?: CodeHostProviderPreference;
  branch?: string;
}): Promise<void> {
  if (!params.owner || !params.repo || !params.filePath) {
    return;
  }

  const provider = params.provider ?? "github";
  const relative = params.filePath.replace(/^\/+/, "");

  await openRepoInEditor({
    owner: params.owner,
    repo: params.repo,
    provider: params.provider,
    branch: params.branch
  });

  if (readOpenRepoInNewWindow()) {
    void vscode.window.showInformationMessage(
      `CoopAI added ${relative} to context. The repo is in another window — use ⌘\` to switch, then pick the file in Explorer.`
    );
    return;
  }

  const ready = await waitForRepoInWorkspace(params.owner, params.repo, provider, 8000);
  const localPath = await findLocalClone(params.owner, params.repo, provider);

  if (localPath && (ready || isRepoOpenInWorkspace(localPath))) {
    const fileUri = vscode.Uri.file(path.join(localPath, relative));
    if (fs.existsSync(fileUri.fsPath)) {
      const editor = await vscode.window.showTextDocument(fileUri, EDITOR_OPEN_OPTIONS);
      if (params.line) {
        const position = new vscode.Position(Math.max(0, params.line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
      await restoreCoopSidebar();
      return;
    }
  }

  if (ready && provider === "github") {
    try {
      const fileUri = githubRepoFileVfsUri(params.owner, params.repo, relative);
      const editor = await vscode.window.showTextDocument(fileUri, EDITOR_OPEN_OPTIONS);
      if (params.line) {
        const position = new vscode.Position(Math.max(0, params.line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
      await restoreCoopSidebar();
      return;
    } catch (error) {
      void vscode.window.showWarningMessage(
        `CoopAI added ${relative} to chat context. Could not open the file in the editor: ${formatError(error)}`
      );
      await restoreCoopSidebar();
      return;
    }
  }

  void vscode.window.showWarningMessage(
    `CoopAI added ${relative} to context, but the editor is not ready yet. Wait a moment and click the file again.`
  );
  await restoreCoopSidebar();
}

export async function openRepoInEditor(params: {
  owner: string;
  repo: string;
  provider?: CodeHostProviderPreference;
  branch?: string;
  mode?: OpenRepoInEditorMode;
}): Promise<OpenRepoInEditorResult> {
  const mode = params.mode ?? readOpenRepoInEditorMode();
  if (mode === "off") {
    return { status: "skipped" };
  }

  const provider = params.provider ?? "github";
  if (!readOpenRepoInNewWindow() && isRepoOpenInEditorWorkspace(params.owner, params.repo, provider)) {
    const result: OpenRepoInEditorResult = {
      status: "already-open",
      localPath: `${params.owner}/${params.repo}`
    };
    await restoreCoopSidebar();
    await notifyOpenRepoResult(params.owner, params.repo, result);
    return result;
  }

  const localPath = await findLocalClone(params.owner, params.repo, provider);

  if (mode === "preferLocal") {
    if (localPath) {
      return finishOpen(params.owner, params.repo, await openLocalClone(localPath));
    }
    if (provider === "github") {
      return finishOpen(params.owner, params.repo, await openGithubRemoteHub(params.owner, params.repo, params.branch));
    }
    return finishOpen(params.owner, params.repo, {
      status: "unavailable",
      reason: "No local clone found. Open the repository folder with File → Open Folder."
    });
  }

  if (mode === "remote") {
    if (provider !== "github") {
      return finishOpen(
        params.owner,
        params.repo,
        localPath
          ? await openLocalClone(localPath)
          : {
              status: "unavailable",
              reason: "Remote editing without a clone is only supported for GitHub."
            }
      );
    }
    return finishOpen(params.owner, params.repo, await openGithubRemoteHub(params.owner, params.repo, params.branch));
  }

  const items: Array<{ label: string; description?: string; action: "local" | "remote" | "skip" }> = [
    {
      label: "Open local clone",
      description: localPath ?? "Not found on this machine",
      action: "local"
    }
  ];
  if (provider === "github") {
    items.push({
      label: "Open in GitHub Repositories",
      description: "Edit on GitHub without cloning",
      action: "remote"
    });
  }
  items.push({
    label: "Keep CoopAI context only",
    description: "Do not open the editor workspace",
    action: "skip"
  });

  const choice = await vscode.window.showQuickPick(items, {
    title: `${params.owner}/${params.repo}`,
    placeHolder: "How should VS Code open this repository?"
  });

  if (!choice || choice.action === "skip") {
    const result = { status: "skipped" as const };
    await notifyOpenRepoResult(params.owner, params.repo, result);
    return result;
  }
  if (choice.action === "local" && localPath) {
    const result = await openLocalClone(localPath);
    await notifyOpenRepoResult(params.owner, params.repo, result);
    return result;
  }
  if (choice.action === "remote" && provider === "github") {
    const result = await openGithubRemoteHub(params.owner, params.repo, params.branch);
    await notifyOpenRepoResult(params.owner, params.repo, result);
    return result;
  }
  const result = { status: "skipped" as const };
  await notifyOpenRepoResult(params.owner, params.repo, result);
  return result;
}

async function finishOpen(
  owner: string,
  repo: string,
  result: OpenRepoInEditorResult
): Promise<OpenRepoInEditorResult> {
  await notifyOpenRepoResult(owner, repo, result);
  return result;
}

async function openLocalClone(localPath: string): Promise<OpenRepoInEditorResult> {
  const newWindow = readOpenRepoInNewWindow();
  if (!newWindow && isRepoOpenInWorkspace(localPath)) {
    await restoreCoopSidebar();
    return { status: "already-open", localPath };
  }
  const uri = vscode.Uri.file(localPath);
  await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: newWindow });
  await afterRepoOpened(newWindow);
  return { status: "opened-local", localPath };
}

async function openGithubRemoteHub(
  owner: string,
  repo: string,
  branch?: string
): Promise<OpenRepoInEditorResult> {
  if (!isGithubRemoteHubInstalled()) {
    const install = await vscode.window.showInformationMessage(
      "CoopAI: no local clone found. Install GitHub Repositories to edit this repo in VS Code without cloning.",
      "Install extension"
    );
    if (install === "Install extension") {
      await vscode.commands.executeCommand("workbench.extensions.search", "@id:GitHub.remotehub");
    }
    return {
      status: "unavailable",
      reason: "GitHub Repositories extension is not installed."
    };
  }

  const repoUrl = buildGithubRepoWebUrl(owner, repo, branch);
  const vfsUri = githubRepoVfsUri(owner, repo);
  const errors: string[] = [];

  for (const extensionId of GITHUB_REMOTEHUB_EXTENSION_IDS) {
    try {
      await vscode.extensions.getExtension(extensionId)?.activate();
    } catch {
      // optional activation
    }
  }

  const newWindow = readOpenRepoInNewWindow();
  try {
    await vscode.commands.executeCommand("vscode.openFolder", vfsUri, { forceNewWindow: newWindow });
    if (newWindow) {
      return { status: "opened-remote" };
    }
    const ready = await waitForRepoInWorkspace(owner, repo, "github", 8000);
    if (ready) {
      await afterRepoOpened(false);
      return { status: "opened-remote" };
    }
    errors.push("Workspace did not switch to the GitHub repository.");
  } catch (error) {
    errors.push(formatError(error));
  }

  for (const command of ["remoteHub.openRepository", "github.openRepository"] as const) {
    try {
      await vscode.commands.executeCommand(command, repoUrl);
      if (!newWindow) {
        const ready = await waitForRepoInWorkspace(owner, repo, "github", 8000);
        if (ready) {
          await afterRepoOpened(false);
        }
      }
      return { status: "opened-remote" };
    } catch (error) {
      errors.push(`${command}: ${formatError(error)}`);
    }
  }

  for (const extensionId of GITHUB_REMOTEHUB_EXTENSION_IDS) {
    if (!vscode.extensions.getExtension(extensionId)) {
      continue;
    }
    try {
      const uri = vscode.Uri.parse(
        `vscode://${extensionId}/open?url=${encodeURIComponent(repoUrl)}`
      );
      await vscode.env.openExternal(uri);
      if (!newWindow) {
        const ready = await waitForRepoInWorkspace(owner, repo, "github", 8000);
        if (ready) {
          await afterRepoOpened(false);
        }
      }
      return { status: "opened-remote" };
    } catch (error) {
      errors.push(`${extensionId} URI: ${formatError(error)}`);
    }
  }

  return {
    status: "unavailable",
    reason:
      "Could not open the GitHub repository in the editor. Install or enable GitHub Repositories, then use Command Palette → Open Remote Repository."
  };
}

async function notifyOpenRepoResult(
  owner: string,
  repo: string,
  result: OpenRepoInEditorResult
): Promise<void> {
  const slug = `${owner}/${repo}`;
  switch (result.status) {
    case "opened-local":
      void vscode.window.showInformationMessage(
        readOpenRepoInNewWindow()
          ? `CoopAI opened ${result.localPath} in another window (⌘\` to switch). CoopAI stays in this sidebar.`
          : `CoopAI opened ${result.localPath}. Click a file in the CoopAI tree to view it in the editor.`
      );
      return;
    case "opened-remote":
      void vscode.window.showInformationMessage(
        readOpenRepoInNewWindow()
          ? `CoopAI opened ${slug} in another window (⌘\` to switch). CoopAI stays in this sidebar.`
          : `CoopAI opened ${slug}. Click a file in the CoopAI tree to view it in the editor.`
      );
      return;
    case "already-open":
      void vscode.window.showInformationMessage(
        `CoopAI: ${slug} is ready. Click a file in the CoopAI folder tree to open it in the editor.`
      );
      return;
    case "unavailable":
      void vscode.window.showWarningMessage(`CoopAI could not open ${slug} in the editor. ${result.reason}`);
      return;
    case "skipped":
      return;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForRepoInWorkspace(
  owner: string,
  repo: string,
  provider: CodeHostProviderPreference,
  timeoutMs: number
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isRepoOpenInEditorWorkspace(owner, repo, provider)) {
      return true;
    }
    await delay(200);
  }
  return isRepoOpenInEditorWorkspace(owner, repo, provider);
}

async function afterRepoOpened(openedInNewWindow: boolean): Promise<void> {
  if (openedInNewWindow) {
    return;
  }
  await restoreCoopSidebar();
}

async function restoreCoopSidebar(): Promise<void> {
  await delay(300);
  try {
    await vscode.commands.executeCommand("workbench.view.extension.coopAI");
  } catch {
    // non-fatal
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectCommonCloneRoots(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    return [];
  }
  const roots: string[] = [];
  for (const segment of COMMON_CLONE_ROOT_SEGMENTS) {
    const base = path.join(home, segment);
    if (!fs.existsSync(base)) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      roots.push(path.join(base, entry.name));
    }
  }
  return roots;
}

async function collectCandidateGitRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const gitRoot = findGitRoot(folder.uri.fsPath) ?? folder.uri.fsPath;
    roots.push(gitRoot);
  }
  for (const repoPath of await getGitExtensionRepositoryRoots()) {
    roots.push(repoPath);
  }
  return roots;
}

async function getGitExtensionRepositoryRoots(): Promise<string[]> {
  const extension = vscode.extensions.getExtension<{
    getAPI(version: 1): { repositories: Array<{ rootUri: vscode.Uri }> };
  }>("vscode.git");
  if (!extension) {
    return [];
  }
  try {
    const git = extension.isActive ? extension.exports : await extension.activate();
    return git.getAPI(1).repositories.map((repo) => repo.rootUri.fsPath);
  } catch {
    return [];
  }
}

function findGitRoot(startPath: string): string | undefined {
  let dir = path.resolve(startPath);
  if (fs.existsSync(path.join(dir, ".git"))) {
    return dir;
  }
  const { root } = path.parse(dir);
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

export function parseGitlabRemoteFromGitConfig(
  config: string
): { owner: string; repo: string } | undefined {
  const originBlock = config.match(/\[remote "origin"\][\s\S]*?(?=\[|$)/i);
  const searchText = originBlock?.[0] ?? config;
  const urlMatch = searchText.match(/url\s*=\s*(.+)/i);
  if (!urlMatch) {
    return undefined;
  }
  const url = urlMatch[1].trim();
  const ssh = url.match(/git@([^:]+):(.+?)(?:\.git)?$/i);
  if (ssh) {
    const segments = ssh[2].split("/").filter(Boolean);
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[segments.length - 1] };
    }
  }
  const https = url.match(/gitlab[^/]*\/(.+?)(?:\.git)?$/i);
  if (https) {
    const segments = https[1].split("/").filter(Boolean);
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[segments.length - 1] };
    }
  }
  return undefined;
}

export function parseBitbucketRemoteFromGitConfig(
  config: string
): { owner: string; repo: string } | undefined {
  const originBlock = config.match(/\[remote "origin"\][\s\S]*?(?=\[|$)/i);
  const searchText = originBlock?.[0] ?? config;
  const urlMatch = searchText.match(/url\s*=\s*(.+)/i);
  if (!urlMatch) {
    return undefined;
  }
  const url = urlMatch[1].trim();
  const ssh = url.match(/git@bitbucket\.org:([^/]+)\/([^/\s]+?)(?:\.git)?/i);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2] };
  }
  const https = url.match(/bitbucket\.org\/([^/]+)\/([^/\s]+?)(?:\.git)?/i);
  if (https) {
    return { owner: https[1], repo: https[2] };
  }
  return undefined;
}

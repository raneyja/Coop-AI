import * as vscode from "vscode";

export type WorkspacePromptEntry = {
  id: string;
  title: string;
  template: string;
  actionId?: string;
  scope?: "workspace";
};

export type WorkspacePromptFile = {
  version: number;
  prompts: WorkspacePromptEntry[];
};

const PROMPT_RELATIVE_PATH = ".coop/prompts.json";

export async function loadWorkspacePrompts(): Promise<WorkspacePromptEntry[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  const uri = vscode.Uri.joinPath(folder.uri, PROMPT_RELATIVE_PATH);
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as WorkspacePromptFile;
    if (!parsed || !Array.isArray(parsed.prompts)) {
      return [];
    }
    return parsed.prompts.filter((entry) => entry.id && entry.title && entry.template);
  } catch {
    return [];
  }
}

export async function saveWorkspacePrompt(entry: WorkspacePromptEntry): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a workspace folder to save prompts.");
  }
  const coopDir = vscode.Uri.joinPath(folder.uri, ".coop");
  const promptsUri = vscode.Uri.joinPath(folder.uri, PROMPT_RELATIVE_PATH);
  const existing = await loadWorkspacePrompts();
  const merged = [...existing.filter((item) => item.id !== entry.id), { ...entry, scope: "workspace" as const }];
  const payload: WorkspacePromptFile = { version: 1, prompts: merged };
  try {
    await vscode.workspace.fs.createDirectory(coopDir);
  } catch {
    // directory may already exist
  }
  await vscode.workspace.fs.writeFile(promptsUri, Buffer.from(JSON.stringify(payload, null, 2), "utf8"));
}

export function applyPromptTemplate(
  template: string,
  variables: Record<string, string | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? "");
}

export function promptVariablesFromContext(context: {
  file?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  selectedLines?: [number, number];
}): Record<string, string | undefined> {
  const lines =
    context.selectedLines && context.selectedLines.length === 2
      ? `${context.selectedLines[0]}-${context.selectedLines[1]}`
      : undefined;
  return {
    file: context.file,
    lines,
    owner: context.owner,
    repo: context.repo,
    branch: context.branch
  };
}

export function watchWorkspacePrompts(onChange: () => void): vscode.Disposable {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return new vscode.Disposable(() => undefined);
  }
  const pattern = new vscode.RelativePattern(folder, PROMPT_RELATIVE_PATH);
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidChange(() => onChange());
  watcher.onDidCreate(() => onChange());
  watcher.onDidDelete(() => onChange());
  return watcher;
}

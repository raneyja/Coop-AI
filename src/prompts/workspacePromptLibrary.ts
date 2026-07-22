import * as vscode from "vscode";
import { sanitizeWorkspacePromptEntries } from "./promptLibraryRun";

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
    return sanitizeWorkspacePromptEntries(parsed.prompts);
  } catch {
    return [];
  }
}

async function writeWorkspacePrompts(prompts: WorkspacePromptEntry[]): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a workspace folder to save prompts.");
  }
  const coopDir = vscode.Uri.joinPath(folder.uri, ".coop");
  const promptsUri = vscode.Uri.joinPath(folder.uri, PROMPT_RELATIVE_PATH);
  const payload: WorkspacePromptFile = {
    version: 1,
    prompts: sanitizeWorkspacePromptEntries(
      prompts.map((entry) => ({ ...entry, scope: "workspace" as const }))
    )
  };
  try {
    await vscode.workspace.fs.createDirectory(coopDir);
  } catch {
    // directory may already exist
  }
  await vscode.workspace.fs.writeFile(promptsUri, Buffer.from(JSON.stringify(payload, null, 2), "utf8"));
}

export async function saveWorkspacePrompt(entry: WorkspacePromptEntry): Promise<void> {
  const existing = await loadWorkspacePrompts();
  const merged = [...existing.filter((item) => item.id !== entry.id), entry];
  await writeWorkspacePrompts(merged);
}

export async function updateWorkspacePrompt(entry: WorkspacePromptEntry): Promise<void> {
  const existing = await loadWorkspacePrompts();
  if (!existing.some((item) => item.id === entry.id)) {
    throw new Error("Prompt not found.");
  }
  const merged = existing.map((item) => (item.id === entry.id ? entry : item));
  await writeWorkspacePrompts(merged);
}

export async function replaceWorkspacePrompts(prompts: WorkspacePromptEntry[]): Promise<void> {
  await writeWorkspacePrompts(prompts);
}

export async function deleteWorkspacePrompt(id: string): Promise<void> {
  const existing = await loadWorkspacePrompts();
  const merged = existing.filter((item) => item.id !== id);
  if (merged.length === existing.length) {
    throw new Error("Prompt not found.");
  }
  await writeWorkspacePrompts(merged);
}

export function hasWorkspaceFolder(): boolean {
  return Boolean(vscode.workspace.workspaceFolders?.[0]);
}

export { applyPromptTemplate, promptVariablesFromContext } from "./promptLibraryRun";

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

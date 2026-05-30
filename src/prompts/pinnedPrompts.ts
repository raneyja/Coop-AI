import * as vscode from "vscode";

const GLOBAL_STATE_KEY = "coopAI.promptLibrary.pinnedIds";
export const MAX_PINNED_PROMPTS = 5;

export async function loadPinnedPromptIds(context: vscode.ExtensionContext): Promise<string[]> {
  const raw = context.globalState.get<string[]>(GLOBAL_STATE_KEY, []);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((id): id is string => typeof id === "string").slice(0, MAX_PINNED_PROMPTS);
}

export async function savePinnedPromptIds(
  context: vscode.ExtensionContext,
  ids: string[]
): Promise<string[]> {
  const normalized = [...new Set(ids.filter(Boolean))].slice(0, MAX_PINNED_PROMPTS);
  await context.globalState.update(GLOBAL_STATE_KEY, normalized);
  return normalized;
}

export function prunePinnedPromptIds(pinnedIds: string[], validIds: Set<string>): string[] {
  return pinnedIds.filter((id) => validIds.has(id));
}

export async function updatePinnedPromptIds(
  context: vscode.ExtensionContext,
  ids: string[],
  validIds: Set<string>
): Promise<string[]> {
  const pruned = prunePinnedPromptIds(ids, validIds);
  return savePinnedPromptIds(context, pruned);
}

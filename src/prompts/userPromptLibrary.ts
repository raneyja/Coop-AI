import { MAX_PINNED_PROMPTS } from "./pinnedPrompts";
import { sanitizeWorkspacePromptEntries } from "./promptLibraryRun";
import type { WorkspacePromptEntry } from "./workspacePromptLibrary";

const LIBRARY_PREFIX = "coopAI.promptLibrary.v1.";
const PINNED_PREFIX = "coopAI.promptLibrary.pinnedIds.v1.";

export const SIGNED_OUT_PROMPT_LIBRARY_ERROR = "Sign in to save prompts to your library.";

type PromptMemento = {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
};

export function promptLibraryStorageKey(identity: string): string | undefined {
  const key = identity.trim().toLowerCase();
  if (!key) {
    return undefined;
  }
  return `${LIBRARY_PREFIX}${key}`;
}

export function promptLibraryPinnedStorageKey(identity: string): string | undefined {
  const key = identity.trim().toLowerCase();
  if (!key) {
    return undefined;
  }
  return `${PINNED_PREFIX}${key}`;
}

export function readStoredPrompts(raw: unknown): WorkspacePromptEntry[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const prompts = (raw as { prompts?: unknown }).prompts;
  if (!Array.isArray(prompts)) {
    return [];
  }
  return sanitizeWorkspacePromptEntries(prompts);
}

export async function loadUserPrompts(
  globalState: PromptMemento,
  identity: string
): Promise<WorkspacePromptEntry[]> {
  const storageKey = promptLibraryStorageKey(identity);
  if (!storageKey) {
    return [];
  }
  return readStoredPrompts(globalState.get(storageKey));
}

export async function writeUserPrompts(
  globalState: PromptMemento,
  identity: string,
  prompts: WorkspacePromptEntry[]
): Promise<WorkspacePromptEntry[]> {
  const storageKey = promptLibraryStorageKey(identity);
  if (!storageKey) {
    throw new Error(SIGNED_OUT_PROMPT_LIBRARY_ERROR);
  }
  const sanitized = sanitizeWorkspacePromptEntries(prompts);
  await globalState.update(storageKey, { version: 1, prompts: sanitized });
  return sanitized;
}

export async function saveUserPrompt(
  globalState: PromptMemento,
  identity: string,
  entry: WorkspacePromptEntry
): Promise<WorkspacePromptEntry[]> {
  const existing = await loadUserPrompts(globalState, identity);
  const merged = [...existing.filter((item) => item.id !== entry.id), entry];
  return writeUserPrompts(globalState, identity, merged);
}

export async function updateUserPrompt(
  globalState: PromptMemento,
  identity: string,
  entry: WorkspacePromptEntry
): Promise<WorkspacePromptEntry[]> {
  const existing = await loadUserPrompts(globalState, identity);
  if (!existing.some((item) => item.id === entry.id)) {
    throw new Error("Prompt not found.");
  }
  const merged = existing.map((item) => (item.id === entry.id ? entry : item));
  return writeUserPrompts(globalState, identity, merged);
}

export async function deleteUserPrompt(
  globalState: PromptMemento,
  identity: string,
  id: string
): Promise<WorkspacePromptEntry[]> {
  const existing = await loadUserPrompts(globalState, identity);
  const merged = existing.filter((item) => item.id !== id);
  if (merged.length === existing.length) {
    throw new Error("Prompt not found.");
  }
  return writeUserPrompts(globalState, identity, merged);
}

export async function loadUserPinnedPromptIds(
  globalState: PromptMemento,
  identity: string
): Promise<string[]> {
  const storageKey = promptLibraryPinnedStorageKey(identity);
  if (!storageKey) {
    return [];
  }
  const raw = globalState.get<string[]>(storageKey, []);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((id): id is string => typeof id === "string");
}

export async function saveUserPinnedPromptIds(
  globalState: PromptMemento,
  identity: string,
  ids: string[]
): Promise<string[]> {
  const storageKey = promptLibraryPinnedStorageKey(identity);
  if (!storageKey) {
    return [];
  }
  const normalized = [...new Set(ids.filter(Boolean))].slice(0, MAX_PINNED_PROMPTS);
  await globalState.update(storageKey, normalized);
  return normalized;
}

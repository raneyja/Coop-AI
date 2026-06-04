export const MAX_PINNED_PROMPTS = 5;

export type PromptLibraryItem = {
  id: string;
  title: string;
  template?: string;
  actionId?: string;
};

export type PromptLibraryState = {
  prompts: PromptLibraryItem[];
  pinnedIds: string[];
  hasWorkspace: boolean;
};

export function resolveTopPrompts(
  prompts: PromptLibraryItem[],
  pinnedIds: string[]
): PromptLibraryItem[] {
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return pinnedIds.map((id) => byId.get(id)).filter((prompt): prompt is PromptLibraryItem => Boolean(prompt));
}

function filterPromptsByQuery(prompts: PromptLibraryItem[], query?: string): PromptLibraryItem[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) {
    return prompts;
  }
  return prompts.filter((prompt) => prompt.title.toLowerCase().includes(normalized));
}

export function partitionPrompts(
  prompts: PromptLibraryItem[],
  pinnedIds: string[],
  query?: string
): { pinned: PromptLibraryItem[]; unpinned: PromptLibraryItem[] } {
  const filtered = filterPromptsByQuery(prompts, query);
  const filteredIds = new Set(filtered.map((prompt) => prompt.id));
  const pinnedSet = new Set(pinnedIds);

  const pinned = resolveTopPrompts(filtered, pinnedIds.filter((id) => filteredIds.has(id)));
  const unpinned = filtered
    .filter((prompt) => !pinnedSet.has(prompt.id))
    .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" }));

  return { pinned, unpinned };
}

function promptEntryEqual(left: PromptLibraryItem, right: PromptLibraryItem): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    (left.template ?? "") === (right.template ?? "") &&
    left.actionId === right.actionId
  );
}

export function promptLibrarySnapshotsEqual(
  left: { prompts: PromptLibraryItem[]; pinnedIds: string[] },
  right: { prompts: PromptLibraryItem[]; pinnedIds: string[] }
): boolean {
  if (left.pinnedIds.length !== right.pinnedIds.length) {
    return false;
  }
  if (!left.pinnedIds.every((id, index) => id === right.pinnedIds[index])) {
    return false;
  }
  if (left.prompts.length !== right.prompts.length) {
    return false;
  }
  const rightById = new Map(right.prompts.map((prompt) => [prompt.id, prompt]));
  return left.prompts.every((prompt) => {
    const other = rightById.get(prompt.id);
    return other !== undefined && promptEntryEqual(prompt, other);
  });
}

export function createDraftPromptId(): string {
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

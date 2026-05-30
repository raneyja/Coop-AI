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

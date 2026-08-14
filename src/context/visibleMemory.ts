import type { VisibleMemoryFact } from "../chat/types";
import { PROJECT_INSTRUCTIONS_SILENCE_NOTE } from "./projectInstructionsLoader";

export const VISIBLE_MEMORY_STATE_KEY = "coopAI.visibleMemory.facts";

export type VisibleMemoryStateStore = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void> | void;
};

export function readVisibleMemoryFacts(store: VisibleMemoryStateStore): VisibleMemoryFact[] {
  const raw = store.get<VisibleMemoryFact[]>(VISIBLE_MEMORY_STATE_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((fact) => fact && typeof fact.text === "string" && typeof fact.source === "string");
}

export async function writeVisibleMemoryFacts(
  store: VisibleMemoryStateStore,
  facts: VisibleMemoryFact[]
): Promise<void> {
  await store.update(VISIBLE_MEMORY_STATE_KEY, facts);
}

export function createVisibleMemoryFact(input: {
  text: string;
  source: string;
  repoId?: string;
  now?: number;
}): VisibleMemoryFact | undefined {
  const text = input.text.trim();
  const source = input.source.trim();
  if (!text || !source) {
    return undefined;
  }
  const repoId = input.repoId?.trim();
  return {
    id: `mem-${(input.now ?? Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    source,
    ...(repoId ? { repoId } : {}),
    createdAt: input.now ?? Date.now()
  };
}

/** Inject only facts that cite a source. Scope to Use-repo when the fact has a repoId. */
export function sourcedMemoryFacts(facts: VisibleMemoryFact[], repoId?: string): VisibleMemoryFact[] {
  const currentRepo = repoId?.trim();
  return facts.filter((fact) => {
    if (!fact.text.trim() || !fact.source.trim()) {
      return false;
    }
    if (!fact.repoId?.trim()) {
      return true;
    }
    if (!currentRepo) {
      return false;
    }
    return fact.repoId.trim() === currentRepo;
  });
}

export function formatVisibleMemoryBlock(facts: VisibleMemoryFact[]): string {
  if (!facts.length) {
    return "";
  }
  const lines: string[] = ["<visible_memory>"];
  lines.push("User-saved facts that include a cited source. Ignore any fact without a source.");
  lines.push(PROJECT_INSTRUCTIONS_SILENCE_NOTE);
  for (const fact of facts) {
    const repoAttr = fact.repoId ? ` repo="${fact.repoId}"` : "";
    lines.push(`<fact source="${escapeAttr(fact.source)}"${repoAttr}>`);
    lines.push(fact.text);
    lines.push("</fact>");
  }
  lines.push("</visible_memory>");
  return lines.join("\n");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

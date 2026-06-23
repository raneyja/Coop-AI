/** Varied verbs for thinking-state rotation — shuffled per request so cycles feel fresh. */
export const THINKING_PROCESSING_TERMS = [
  "processing",
  "configuring",
  "synthesizing",
  "assembling",
  "correlating",
  "indexing",
  "reconciling",
  "organizing",
  "validating",
  "compiling",
  "aggregating",
  "aligning",
  "mapping",
  "refining",
  "scanning",
  "distilling",
  "integrating",
  "harmonizing",
  "structuring",
  "calibrating",
  "normalizing",
  "prioritizing",
  "resolving",
  "unpacking"
] as const;

const THINKING_PROCESSING_OBJECTS = [
  "context",
  "evidence",
  "integrations",
  "sources",
  "signals",
  "integrations",
  "workspace data",
  "your answer"
] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function capitalize(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function shuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = mulberry32(hashSeed(seed));
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Build varied "Processing context…" style lines for thinking-state rotation. */
export function buildProcessingTermMessages(seed: string, count = 6): string[] {
  const terms = shuffle(THINKING_PROCESSING_TERMS, `${seed}:terms`);
  const objects = shuffle(THINKING_PROCESSING_OBJECTS, `${seed}:objects`);
  const messages: string[] = [];
  const limit = Math.min(count, terms.length, objects.length);

  for (let i = 0; i < limit; i += 1) {
    messages.push(`${capitalize(terms[i])} ${objects[i]}…`);
  }

  return messages;
}

export function appendThinkingProcessingTerms(
  messages: string[],
  seed: string,
  count = 5
): string[] {
  const seen = new Set(messages);
  const enriched = [...messages];
  for (const message of buildProcessingTermMessages(seed, count)) {
    if (!seen.has(message)) {
      seen.add(message);
      enriched.push(message);
    }
  }
  return enriched;
}

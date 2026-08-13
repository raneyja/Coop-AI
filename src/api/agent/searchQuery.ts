const STOP = new Set(
  [
    "where",
    "what",
    "which",
    "who",
    "how",
    "does",
    "is",
    "are",
    "the",
    "this",
    "that",
    "in",
    "on",
    "of",
    "or",
    "and",
    "a",
    "an",
    "to",
    "for",
    "repo",
    "repository",
    "codebase",
    "file",
    "files",
    "defined",
    "define",
    "please",
    "find"
  ].map((w) => w.toLowerCase())
);

const IDENTIFIER =
  /\b(?:[a-z][a-zA-Z]*[A-Z][a-zA-Z0-9]*|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
const MAX_SEARCH_CHARS = 48;

export type RankedSearchHit = {
  fileName: string;
  lineNumber: number;
  score?: number;
};

/** Short index query — never the whole user sentence. */
export function extractAgentSearchQuery(userMessage: string): string {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return trimmed;
  }

  const identifiers = [...trimmed.matchAll(IDENTIFIER)]
    .map((m) => m[0])
    .filter((id) => !STOP.has(id.toLowerCase()));
  const prefer = identifiers.find((id) => /auth|middleware|require/i.test(id));
  if (prefer) {
    return clip(prefer);
  }
  if (identifiers[0]) {
    return clip(identifiers[0]);
  }

  const phrase = trimmed.match(/\b(authentication|auth)\s+middleware\b/i);
  if (phrase) {
    return clip(phrase[0]);
  }

  const tokens = trimmed
    .replace(/[^\w\s./-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t.toLowerCase()));
  if (tokens.length === 0) {
    return clip(trimmed);
  }
  return clip(tokens.slice(0, 4).join(" "));
}

export function sanitizeAgentSearchQuery(query: string, userMessage: string): string {
  const q = query.trim();
  if (!q) {
    return extractAgentSearchQuery(userMessage);
  }
  if (q.length > MAX_SEARCH_CHARS || q === userMessage.trim() || looksLikeFullQuestion(q)) {
    return extractAgentSearchQuery(userMessage);
  }
  return clip(q);
}

export function isBarrelPath(fileName: string): boolean {
  const n = fileName.replace(/\\/g, "/").toLowerCase();
  return /\/index\.(ts|tsx|js|jsx)$/.test(`/${n}`) || /(^|\/)index\.(ts|tsx|js|jsx)$/.test(n);
}

export function isFrontendAuthFormPath(fileName: string): boolean {
  const n = fileName.replace(/\\/g, "/").toLowerCase();
  return (
    /\/components\/.*auth/.test(n) ||
    /auth-forms/.test(n) ||
    /\/account\/auth/.test(n)
  );
}

export function looksLikeApiAuthPath(fileName: string): boolean {
  const n = fileName.replace(/\\/g, "/").toLowerCase();
  return (
    /(^|\/)(api|server|backend|middleware)\//.test(n) ||
    /middleware/.test(n) ||
    /authentication/.test(n)
  );
}

/** Prefer API/middleware files; demote frontend barrels and auth-form UI. */
export function rankSearchHits<T extends RankedSearchHit>(hits: T[]): T[] {
  return [...hits].sort((a, b) => rankHit(b) - rankHit(a) || (b.score ?? 0) - (a.score ?? 0));
}

export function pickTopSearchHit<T extends RankedSearchHit>(hits: T[]): T | undefined {
  return rankSearchHits(hits)[0];
}

export function pickSearchHitsToRead<T extends RankedSearchHit>(hits: T[], max = 2): T[] {
  const ranked = rankSearchHits(hits);
  const picked: T[] = [];
  for (const hit of ranked) {
    if (picked.some((p) => p.fileName === hit.fileName)) {
      continue;
    }
    if (isBarrelPath(hit.fileName) || isFrontendAuthFormPath(hit.fileName)) {
      continue;
    }
    picked.push(hit);
    if (picked.length >= max) {
      break;
    }
  }
  if (picked.length === 0 && ranked[0]) {
    return [ranked[0]];
  }
  return picked;
}

function rankHit(hit: RankedSearchHit): number {
  let rank = hit.score ?? 0;
  if (looksLikeApiAuthPath(hit.fileName)) {
    rank += 5;
  }
  if (isFrontendAuthFormPath(hit.fileName)) {
    rank -= 4;
  }
  if (isBarrelPath(hit.fileName)) {
    rank -= 3;
  }
  return rank;
}

function looksLikeFullQuestion(q: string): boolean {
  return /\b(where|what|how|which)\b/i.test(q) && q.split(/\s+/).length >= 8;
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_SEARCH_CHARS ? `${t.slice(0, MAX_SEARCH_CHARS).trim()}` : t;
}

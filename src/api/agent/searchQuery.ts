import {
  isBarrelPath,
  isGeneratedOrVendorPath,
  normalizePath
} from "../../indexing/evidencePathNoise";

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
const MAX_FALLBACK_QUERIES = 4;

export {
  isBarrelPath,
  isGeneratedOrVendorPath
} from "../../indexing/evidencePathNoise";

/**
 * Common code-role nouns. `<word> <role>` is a better index query than a whole
 * sentence. Deliberately repo-agnostic — no product, folder, or framework names.
 */
const ROLE_NOUN =
  /\b([a-z][a-z0-9]+\s+(?:middleware|service|controller|provider|handler|adapter|repository|resolver|guard|interceptor|client|store|queue|worker|migration|schema))\b/i;

export type RankedSearchHit = {
  fileName: string;
  lineNumber: number;
  score?: number;
};

/**
 * Short index query — never the whole user sentence.
 * An explicit identifier (`requireAuth`, `parse_token`) beats a prose phrase:
 * it is the symbol the user actually named.
 */
export function extractAgentSearchQuery(userMessage: string): string {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return trimmed;
  }

  const identifier = firstIdentifier(trimmed);
  if (identifier) {
    return clip(identifier);
  }

  const role = trimmed.match(ROLE_NOUN);
  if (role) {
    return clip(role[0]);
  }

  const tokens = significantTokens(trimmed);
  if (tokens.length === 0) {
    return clip(trimmed);
  }
  return clip(tokens.slice(0, 4).join(" "));
}

export function sanitizeAgentSearchQuery(query: string, userMessage: string): string {
  const q = query.trim();
  const extracted = extractAgentSearchQuery(userMessage);
  if (!q) {
    return extracted;
  }
  if (q.length > MAX_SEARCH_CHARS || q === userMessage.trim() || looksLikeFullQuestion(q)) {
    return extracted;
  }
  return clip(q);
}

/** Use a short index query for questions and hunts; pass short asks through. */
export function shouldFocusIndexQuery(userQuery: string): boolean {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    return false;
  }
  if (looksLikeFullQuestion(trimmed)) {
    return true;
  }
  return /^(where|what|which|how|find|who)\b/i.test(trimmed) && trimmed.length >= 20;
}

export function indexQueryForRetrieval(userQuery: string): string {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    return trimmed;
  }
  return shouldFocusIndexQuery(trimmed) ? extractAgentSearchQuery(trimmed) : trimmed;
}

/**
 * True when a path is structural noise rather than evidence.
 * Repo-agnostic: only barrels, build output, and vendored code. If the user
 * named the path themselves, it is never noise.
 */
export function shouldSkipEvidencePath(fileName: string, userMessage?: string): boolean {
  if (userMessage && userNamedPath(fileName, userMessage)) {
    return false;
  }
  return isBarrelPath(fileName) || isGeneratedOrVendorPath(fileName);
}

/**
 * Progressively broader index queries, tried in order when the first search
 * returns nothing readable. Derived from the question's own words only.
 */
export function fallbackAgentSearchQueries(userMessage: string): string[] {
  const primary = extractAgentSearchQuery(userMessage);
  const identifiers = allIdentifiers(userMessage);
  const role = userMessage.match(ROLE_NOUN)?.[0];
  const tokens = significantTokens(userMessage).sort((a, b) => b.length - a.length);

  const unique: string[] = [];
  for (const candidate of [primary, ...identifiers, role, ...tokens]) {
    const clipped = clip(candidate ?? "");
    if (clipped && !unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      unique.push(clipped);
    }
    if (unique.length >= MAX_FALLBACK_QUERIES) {
      break;
    }
  }
  return unique;
}

export function rankSearchHits<T extends RankedSearchHit>(hits: T[], userMessage?: string): T[] {
  const terms = userMessage ? queryTerms(userMessage) : [];
  return [...hits].sort(
    (a, b) => rankHit(b, terms) - rankHit(a, terms) || (b.score ?? 0) - (a.score ?? 0)
  );
}

export function pickTopSearchHit<T extends RankedSearchHit>(
  hits: T[],
  userMessage?: string
): T | undefined {
  return rankSearchHits(hits, userMessage)[0];
}

export function pickSearchHitsToRead<T extends RankedSearchHit>(
  hits: T[],
  max = 2,
  userMessage?: string
): T[] {
  const ranked = rankSearchHits(hits, userMessage);
  const picked: T[] = [];
  for (const hit of ranked) {
    if (picked.some((p) => p.fileName === hit.fileName)) {
      continue;
    }
    if (shouldSkipEvidencePath(hit.fileName, userMessage)) {
      continue;
    }
    picked.push(hit);
    if (picked.length >= max) {
      break;
    }
  }
  return picked;
}

/**
 * A definition site from the symbol index. Unlike a text hit, `line` is where the
 * thing is actually declared — the answer to "where is this defined".
 */
export type RankedSymbolHit = {
  file: string;
  line: number;
  symbol?: string;
  displayName?: string;
  kind?: string;
};

/**
 * Definitions worth reading, best match first. A symbol only qualifies if its
 * name relates to the question — the index returns near misses too.
 */
export function pickSymbolHitsToRead<T extends RankedSymbolHit>(
  symbols: T[],
  max = 2,
  userMessage?: string
): T[] {
  if (!userMessage) {
    return [];
  }
  const ident = normalizeSymbol(extractAgentSearchQuery(userMessage));
  const terms = queryTerms(userMessage);
  const scored = symbols
    .map((symbol) => ({ symbol, score: symbolNameScore(symbol, ident, terms) }))
    .filter((entry) => entry.score > 0 && !shouldSkipEvidencePath(entry.symbol.file, userMessage))
    .sort((a, b) => b.score - a.score);

  const picked: T[] = [];
  for (const entry of scored) {
    if (picked.some((seen) => seen.file === entry.symbol.file)) {
      continue;
    }
    picked.push(entry.symbol);
    if (picked.length >= max) {
      break;
    }
  }
  return picked;
}

function symbolNameScore(symbol: RankedSymbolHit, ident: string, terms: string[]): number {
  const name = normalizeSymbol(symbol.displayName ?? symbol.symbol ?? "");
  if (!name) {
    return 0;
  }
  if (ident && name === ident) {
    return 100;
  }
  if (ident && (name.startsWith(ident) || name.endsWith(ident))) {
    return 80;
  }
  if (ident && (name.includes(ident) || ident.includes(name))) {
    return 60;
  }
  const matched = terms.filter((term) => name.includes(term)).length;
  return matched > 0 ? Math.min(50, matched * 20) : 0;
}

function normalizeSymbol(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Retrieval sample for chat, hunts, quick actions, and /edit — one shared rule. */
export function selectChatEvidencePaths(paths: string[], userQuery: string, max = 3): string[] {
  const hits = paths.map((fileName, index) => ({
    fileName,
    lineNumber: 1,
    score: 1 - index * 0.01
  }));
  return pickSearchHitsToRead(hits, max, userQuery).map((hit) => hit.fileName);
}

function rankHit(hit: RankedSearchHit, terms: string[]): number {
  let rank = hit.score ?? 0;
  const path = normalizePath(hit.fileName);
  for (const term of terms) {
    if (path.includes(term)) {
      rank += 3;
    }
  }
  if (isBarrelPath(hit.fileName)) {
    rank -= 3;
  }
  if (isGeneratedOrVendorPath(hit.fileName)) {
    rank -= 6;
  }
  return rank;
}

/** Lowercased words from the question, with camelCase and snake_case split apart. */
function queryTerms(userMessage: string): string[] {
  const terms = new Set<string>();
  for (const token of significantTokens(userMessage)) {
    const lower = token.toLowerCase();
    terms.add(lower);
    for (const part of token
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/\s+/)) {
      if (part.length > 2 && !STOP.has(part.toLowerCase())) {
        terms.add(part.toLowerCase());
      }
    }
  }
  return [...terms];
}

function userNamedPath(fileName: string, userMessage: string): boolean {
  const path = normalizePath(fileName);
  const message = userMessage.toLowerCase();
  if (message.includes(path)) {
    return true;
  }
  const base = path.split("/").pop();
  return Boolean(base && base.length > 3 && message.includes(base));
}

function firstIdentifier(text: string): string | undefined {
  return allIdentifiers(text)[0];
}

function allIdentifiers(text: string): string[] {
  return [...text.matchAll(IDENTIFIER)].map((m) => m[0]).filter((id) => !STOP.has(id.toLowerCase()));
}

function significantTokens(text: string): string[] {
  return text
    .replace(/[^\w\s./-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t.toLowerCase()));
}

function looksLikeFullQuestion(q: string): boolean {
  return /\b(where|what|how|which)\b/i.test(q) && q.split(/\s+/).length >= 8;
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_SEARCH_CHARS ? `${t.slice(0, MAX_SEARCH_CHARS).trim()}` : t;
}

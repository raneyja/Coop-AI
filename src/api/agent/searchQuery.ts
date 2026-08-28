import {
  isBarrelPath,
  isGeneratedOrVendorPath,
  isTestPath,
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
const MAX_FALLBACK_QUERIES = 5;
const SOURCE_FILE_EXT =
  "ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|md|json|yml|yaml|css|html|vue|svelte|c|h|cpp|cc|kt|swift";
const NAMED_SOURCE_FILE = new RegExp(
  `(?:^|[\\s\`'"(\\[]|/)((?:[\\w.-]+/)*[\\w.-]+\\.(?:${SOURCE_FILE_EXT}))(?=$|[\\s\`'")\\],:;!?])`,
  "gi"
);

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

/** Specific enough that a read must mention them — not generic “service/api”. */
const ROLE_HINTS = [
  "middleware",
  "controller",
  "handler",
  "adapter",
  "resolver",
  "guard",
  "interceptor",
  "validator"
] as const;

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

  // "Where is the Button component" — prefer Button over the role phrase.
  const deniedPascal = /^(Where|What|Which|How|Why|Show|Find|Please|Define|Explain|This|That|When|After|Before)$/i;
  const pascalName = [...trimmed.matchAll(/\b([A-Z][a-z][a-zA-Z0-9]+)\b/g)]
    .map((match) => match[1]!)
    .find((word) => !deniedPascal.test(word));
  if (pascalName) {
    return clip(pascalName);
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
  if (!shouldFocusIndexQuery(trimmed)) {
    return trimmed;
  }
  const primary = extractAgentSearchQuery(trimmed);
  const alias = identifierSearchAliases(primary)[0];
  // One retrieval covers both casings (requireAuth ↔ require_auth).
  return alias ? `${primary} or ${alias}` : primary;
}

/**
 * True when a path is structural noise rather than evidence.
 * Repo-agnostic: barrels, build/vendor, and (for named-symbol hunts) tests.
 * If the user named the path themselves, it is never noise.
 */
export function shouldSkipEvidencePath(fileName: string, userMessage?: string): boolean {
  if (userMessage && userNamedPath(fileName, userMessage)) {
    return false;
  }
  if (isBarrelPath(fileName) || isGeneratedOrVendorPath(fileName)) {
    return true;
  }
  // Named symbol + change/locate: skip tests unless the user asked about tests.
  // Otherwise contract tests that say "require_authentication" steal requireAuth.
  if (
    userMessage &&
    namedSymbolKeys(userMessage).length > 0 &&
    isTestPath(fileName) &&
    !userAskedAboutTests(userMessage)
  ) {
    return true;
  }
  return false;
}

/**
 * Progressively broader index queries, tried in order when the first search
 * returns nothing readable. Derived from the question's own words only.
 *
 * Identifier aliases matter: users often write `requireAuth` while the repo
 * defines `require_auth` (or the reverse). A single casing miss returns empty
 * and the model claims the middleware does not exist.
 */
export function fallbackAgentSearchQueries(userMessage: string): string[] {
  const primary = extractAgentSearchQuery(userMessage);
  const identifiers = allIdentifiers(userMessage);
  const role = userMessage.match(ROLE_NOUN)?.[0];
  const tokens = significantTokens(userMessage).sort((a, b) => b.length - a.length);

  const unique: string[] = [];
  const push = (candidate: string | undefined) => {
    const clipped = clip(candidate ?? "");
    if (!clipped) {
      return;
    }
    if (unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      return;
    }
    unique.push(clipped);
  };

  for (const file of extractNamedSourceFiles(userMessage)) {
    push(file);
    const base = file.split("/").pop();
    if (base && base !== file) {
      push(base);
    }
  }
  push(primary);
  for (const id of identifiers) {
    push(id);
    for (const alias of identifierSearchAliases(id)) {
      push(alias);
    }
  }
  for (const alias of identifierSearchAliases(primary)) {
    push(alias);
  }
  push(role);
  for (const token of tokens) {
    push(token);
    if (unique.length >= MAX_FALLBACK_QUERIES) {
      break;
    }
  }
  return unique.slice(0, MAX_FALLBACK_QUERIES);
}

/**
 * camelCase ↔ snake_case forms of the same identifier.
 * Repo-agnostic: only transforms characters the user already typed.
 */
export function identifierSearchAliases(identifier: string): string[] {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return [];
  }
  const aliases: string[] = [];
  if (/[A-Z]/.test(trimmed) && !trimmed.includes("_")) {
    const snake = trimmed
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase();
    if (snake !== trimmed.toLowerCase()) {
      aliases.push(snake);
    }
  }
  if (trimmed.includes("_")) {
    const camel = trimmed
      .toLowerCase()
      .replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
    if (camel !== trimmed) {
      aliases.push(camel);
    }
  }
  return aliases;
}

export function rankSearchHits<T extends RankedSearchHit>(hits: T[], userMessage?: string): T[] {
  const terms = userMessage ? queryTerms(userMessage) : [];
  return [...hits].sort(
    (a, b) =>
      rankHit(b, terms, userMessage) - rankHit(a, terms, userMessage) ||
      (b.score ?? 0) - (a.score ?? 0)
  );
}

export function pickTopSearchHit<T extends RankedSearchHit>(
  hits: T[],
  userMessage?: string
): T | undefined {
  return rankSearchHits(hits, userMessage)[0];
}

export function pickSearchHitsToRead<T extends RankedSearchHit & { content?: string }>(
  hits: T[],
  max = 2,
  userMessage?: string
): T[] {
  const ranked = rankSearchHits(hits, userMessage);
  const keys = userMessage ? namedSymbolKeys(userMessage) : [];
  // Named symbol in the ask → only keep hits that actually mention it. Empty is
  // better than reading a UI form that merely shares the word "auth".
  // Exception: the user named this file (authMiddleware.ts) — keep it even if
  // the body exports a different identifier.
  let pool =
    keys.length > 0
      ? ranked.filter(
          (hit) =>
            hitMentionsNamedSymbol(hit, userMessage!) ||
            Boolean(userMessage && queryNamesSourceFile(hit.fileName, userMessage))
        )
      : ranked;
  if (keys.length === 0 && userMessage && queryRoleHints(userMessage).length > 0) {
    const roleHits = pool.filter((hit) =>
      textMentionsQueryRoles(`${hit.fileName}\n${hit.content ?? ""}`, userMessage)
    );
    if (roleHits.length > 0) {
      pool = roleHits;
    }
  }
  // Prefer declaration sites over call sites when the user named a symbol.
  if (keys.length > 0 && userMessage) {
    const decls = pool.filter((hit) => contentLooksLikeDeclaration(hit.content ?? "", userMessage));
    if (decls.length > 0) {
      pool = [...decls, ...pool.filter((hit) => !decls.includes(hit))];
    }
  }
  const picked: T[] = [];
  for (const hit of pool) {
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
    .map((symbol) => ({ symbol, score: symbolNameScore(symbol, ident, terms, userMessage) }))
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

function symbolNameScore(
  symbol: RankedSymbolHit,
  ident: string,
  terms: string[],
  userMessage: string
): number {
  const raw = (symbol.displayName ?? symbol.symbol ?? "").trim();
  const name = normalizeSymbol(raw);
  if (!name) {
    return 0;
  }
  const formNorms = namedSymbolForms(userMessage).map(normalizeSymbol).filter(Boolean);
  // Named symbol hunts: only exact identifier match (requireAuth ↔ require_auth).
  // Substring matching is banned — requireauthentication contains requireauth and
  // stole change hunts onto contract tests.
  if (formNorms.length > 0) {
    return formNorms.includes(name) ? 100 : 0;
  }
  // Role / prose asks (no camelCase symbol): soft term overlap is OK.
  if (ident.length >= 6) {
    for (const term of terms) {
      if (term.length >= 4 && name === term) {
        return 85;
      }
    }
  }
  const matched = terms.filter((term) => name.includes(term)).length;
  return matched > 0 ? Math.min(40, matched * 15) : 0;
}

/**
 * camelCase / snake_case token the user likely meant as a code symbol.
 * Plain words like "logging" are not specific enough to filter hits.
 */
export function isSpecificCodeIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4 || /\s/.test(trimmed)) {
    return false;
  }
  return (
    /_/.test(trimmed) ||
    /[a-z][A-Z]/.test(trimmed) ||
    /^[A-Z][a-z]+[A-Z]/.test(trimmed) ||
    /^[A-Z][a-z]{2,}$/.test(trimmed)
  );
}

/** True when the user named a specific identifier (requireAuth), not a broad ask. */
export function queryHasNamedSymbol(userMessage: string): boolean {
  return namedSymbolKeys(userMessage).length > 0;
}

/**
 * Source files the user typed (`authMiddleware.ts`, `src/server/auth.ts`).
 * File hunts are not the same as symbol hunts — the file may export other names.
 */
export function extractNamedSourceFiles(userMessage: string): string[] {
  const named: string[] = [];
  const seen = new Set<string>();
  NAMED_SOURCE_FILE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NAMED_SOURCE_FILE.exec(userMessage)) !== null) {
    const value = (match[1] ?? "").replace(/^\/+/, "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    named.push(value);
  }
  return named;
}

/** True when `fileName` is a file the user typed (basename or full path). */
export function queryNamesSourceFile(fileName: string, userMessage: string): boolean {
  const named = extractNamedSourceFiles(userMessage);
  if (!named.length) {
    return false;
  }
  const path = normalizePath(fileName).toLowerCase();
  return named.some((ref) => {
    const n = ref.toLowerCase();
    return path === n || path.endsWith(`/${n}`) || path.endsWith(n);
  });
}

/** Normalized keys for the symbol the user named + casing aliases. */
export function namedSymbolKeys(userMessage: string): string[] {
  const primary = extractAgentSearchQuery(userMessage);
  if (!isSpecificCodeIdentifier(primary)) {
    return [];
  }
  // "Find authMiddleware.ts" names a file, not a required in-body symbol.
  if (isStemOfNamedSourceFile(primary, userMessage)) {
    return [];
  }
  const keys = new Set<string>([normalizeSymbol(primary)]);
  for (const alias of identifierSearchAliases(primary)) {
    const norm = normalizeSymbol(alias);
    if (norm.length >= 4) {
      keys.add(norm);
    }
  }
  return [...keys];
}

function isStemOfNamedSourceFile(identifier: string, userMessage: string): boolean {
  const stem = identifier.replace(/\.[^.]+$/, "").toLowerCase();
  const identNorm = normalizeSymbol(identifier);
  return extractNamedSourceFiles(userMessage).some((file) => {
    const base = (file.split("/").pop() ?? file).replace(/\.[^.]+$/, "");
    return base.toLowerCase() === stem || normalizeSymbol(base) === identNorm;
  });
}

/**
 * True when `text` contains the named symbol as a whole identifier token.
 * Substring-of-stripped-blob matching is wrong: `require_authentication`
 * contains `requireauth` after normalization and stole definition hunts.
 */
export function textMentionsNamedSymbol(text: string, userMessage: string): boolean {
  const forms = namedSymbolForms(userMessage);
  if (!forms.length) {
    return true;
  }
  return forms.some((form) => textHasIdentifierToken(text, form));
}

/** Role nouns the user named (middleware, handler, …). */
export function queryRoleHints(userMessage: string): string[] {
  const lower = userMessage.toLowerCase();
  return ROLE_HINTS.filter((role) => new RegExp(`\\b${role}s?\\b`).test(lower));
}

/**
 * When the user named a role (auth *middleware*), the file/path must mention
 * that role. Otherwise collab `onAuthenticate` steals HTTP middleware hunts.
 */
export function textMentionsQueryRoles(text: string, userMessage: string): boolean {
  const hints = queryRoleHints(userMessage);
  if (!hints.length) {
    return true;
  }
  const blob = text.toLowerCase();
  return hints.some((role) => blob.includes(role));
}

function hitMentionsNamedSymbol(
  hit: { fileName: string; content?: string },
  userMessage: string
): boolean {
  return textMentionsNamedSymbol(`${hit.fileName}\n${hit.content ?? ""}`, userMessage);
}

/** Identifier spellings the user likely meant (requireAuth, require_auth, …). */
function namedSymbolForms(userMessage: string): string[] {
  const primary = extractAgentSearchQuery(userMessage);
  if (!isSpecificCodeIdentifier(primary)) {
    return [];
  }
  const forms = new Set<string>([primary]);
  for (const alias of identifierSearchAliases(primary)) {
    if (alias.length >= 4) {
      forms.add(alias);
    }
  }
  return [...forms];
}

function textHasIdentifierToken(text: string, form: string): boolean {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "i").test(text);
}

function contentLooksLikeDeclaration(content: string, userMessage: string): boolean {
  const forms = namedSymbolForms(userMessage);
  if (!forms.length || !content) {
    return false;
  }
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      new RegExp(
        `\\b(async\\s+)?(def|function|class|const|let|var|fn|fun|func)\\s+${escaped}\\b`
      ).test(content)
    ) {
      return true;
    }
    if (new RegExp(`\\b${escaped}\\s*[=:]\\s*(async\\s*)?(function|\\()`).test(content)) {
      return true;
    }
  }
  return false;
}

function userAskedAboutTests(userMessage: string): boolean {
  return /\b(tests?|specs?|unit\s*tests?|contract\s*tests?)\b/i.test(userMessage);
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

function rankHit(hit: RankedSearchHit, terms: string[], userMessage?: string): number {
  let rank = hit.score ?? 0;
  const path = normalizePath(hit.fileName);
  for (const term of terms) {
    if (path.includes(term)) {
      rank += 3;
    }
  }
  // Exact path token for the symbol (require_auth.py) beats a weak "auth"
  // substring match — and must not fire on require_authentication filenames.
  if (userMessage) {
    for (const form of namedSymbolForms(userMessage)) {
      if (pathHasIdentifierToken(hit.fileName, form)) {
        rank += 14;
        break;
      }
    }
    if (contentLooksLikeDeclaration((hit as { content?: string }).content ?? "", userMessage)) {
      rank += 20;
    }
  }
  if (isBarrelPath(hit.fileName)) {
    rank -= 3;
  }
  if (isGeneratedOrVendorPath(hit.fileName)) {
    rank -= 6;
  }
  if (
    userMessage &&
    namedSymbolKeys(userMessage).length > 0 &&
    isTestPath(hit.fileName) &&
    !userAskedAboutTests(userMessage)
  ) {
    rank -= 12;
  }
  return rank;
}

function pathHasIdentifierToken(fileName: string, form: string): boolean {
  const tokens = fileName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const want = normalizeSymbol(form);
  return tokens.some((token) => normalizeSymbol(token) === want);
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

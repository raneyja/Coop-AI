import { classifyFieldHandlingEvidence, type FieldHandlingSource, type VerifiedFieldHandling } from "./fieldHandlingEvidence";
import {
  isBarrelPath,
  isClientUiPath,
  isEmptyStatePackagePath,
  isGeneratedOrVendorPath,
  isHtmlTemplatePath,
  isIconOrAssetPath,
  isLocaleCatalogPath,
  isMigrationPath,
  isMutationHandlerPath,
  isSchemaCatalogPath,
  isSeedOrFixturePath,
  isDocOrSpecPath,
  isQueryFilterPath,
  isSharedTypePackagePath,
  isServerWritePath,
  isTestPath,
  normalizePath
} from "../../indexing/evidencePathNoise";
import { stripLeadingAskLabels } from "../../chat/intentPlanner/planChatJobs";
import { isShipCheckQuery } from "../../context/fileCallerIntent";
import { preferredHitsForLocate } from "./locateEvidence";

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
    "find",
    "pager",
    "oncall"
  ].map((w) => w.toLowerCase())
);

const IDENTIFIER =
  /\b(?:[a-z][a-zA-Z]*[A-Z][a-zA-Z0-9_]*|[A-Z][a-z]+[A-Z][a-zA-Z0-9_]*|[a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+)\b/g;
const MAX_SEARCH_CHARS = 48;
/** Reject error strings from the ask are longer than name hunts — keep them searchable. */
const MAX_REJECT_SEARCH_CHARS = 80;
const MAX_FALLBACK_QUERIES = 9;
/** API-reject hunts need field-access queries, not only “is not valid” slogans. */
const MAX_API_REJECT_FALLBACK_QUERIES = 12;
/**
 * Path-shaped file refs (`foo.ts`, `src/db/seed.sql`). Extension must start
 * with a letter so `v2.0` / `COOP-401` are not files. Language allowlists
 * miss the next repo (`.jsp`, `.sql`, `.gradle`).
 */
const NAMED_SOURCE_FILE = new RegExp(
  `(?:^|[\\s\`'"(\\[]|/)((?:[\\w.-]+/)*[\\w.-]+\\.[A-Za-z][A-Za-z0-9]{0,9})(?=$|[\\s\`'")\\],:;!?]|\\.(?:\\s|$))`,
  "gi"
);
/** Host suffixes and prose — never real source exts (`ts`, `js`, `go`, `cc`, `md`). */
const BLOCKED_FILE_EXTS = new Set([
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "io",
  "dev",
  "ai",
  "co",
  "uk",
  "us",
  "info",
  "biz",
  "app",
  "xyz",
  "me",
  "tv",
  "cloud",
  "name",
  "pro"
]);
/** Bare product names people type in prose. Count only with a path prefix. */
const PRODUCT_FILE_BASENAMES = new Set(["node.js", "next.js", "nuxt.js"]);
const PROSE_FILE_BASENAMES = new Set(["e.g", "i.e"]);

export {
  isBarrelPath,
  isGeneratedOrVendorPath
} from "../../indexing/evidencePathNoise";

/**
 * Common code-role nouns. `<word> <role>` is a better index query than a whole
 * sentence. Deliberately repo-agnostic — no product, folder, or framework names.
 */
const ROLE_NOUN =
  /\b((?!(?:this|the|that|our|your|an)\b)[a-z][a-z0-9]+\s+(?:middleware|service|controller|provider|handler|adapter|repository|resolver|guard|interceptor|client|store|queue|worker|migration|schema))\b/i;

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

/** Question words — never a component/symbol name. */
const DENIED_PASCAL =
  /^(Where|What|Which|How|Why|Show|Find|Please|Define|Explain|This|That|When|After|Before)$/i;

/**
 * Single-hump Pascal that is English or HTTP, not a code symbol. "Button" and
 * "LoginForm" stay eligible for search; these must not become the hunt key.
 */
const PROSE_PASCAL = new Set(
  [
    "Authorization",
    "Bearer",
    "Users",
    "User",
    "Token",
    "Request",
    "Response",
    "Header",
    "Headers",
    "Error",
    "Client",
    "Server",
    "Message",
    "File",
    "Data",
    "Type",
    "Status",
    "State",
    "Item",
    "Issue",
    "Work",
    "Api"
  ].map((w) => w.toLowerCase())
);

/** Fallback tokens that burn the 3-try budget without finding a definition. */
const JUNK_SEARCH_TOKEN = new Set(
  [
    "existing",
    "helper",
    "write",
    "point",
    "cloned",
    "returns",
    "error",
    "move",
    "out",
    "bad",
    "new",
    "dont",
    "have",
    "can",
    "cant",
    "cannot",
    "wont",
    "just",
    "really",
    "function",
    "ask",
    "our",
    "not",
    "any",
    "other",
    "line",
    "body",
    "open",
    "add",
    "two",
    "tests",
    "match",
    "style",
    "rewrite",
    "suite",
    "missing",
    "returns",
    "undefined"
  ].map((w) => w.toLowerCase())
);

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
  const trimmed = stripLeadingAskLabels(userMessage.trim()) || userMessage.trim();
  if (!trimmed) {
    return trimmed;
  }

  // On-call API reject: Exact pasted error quote first — not ValidationError /
  // bare issue_id / get("parent") scavenger (those open error_codes / UI).
  if (isApiRejectAsk(trimmed)) {
    const quoteFirst = rejectQuoteFirstSearchQueries(trimmed)[0];
    if (quoteFirst) {
      return clip(quoteFirst, MAX_REJECT_SEARCH_CHARS);
    }
    const rejectQuery = apiRejectSearchQueries(trimmed)[0];
    if (rejectQuery) {
      return clip(rejectQuery, MAX_REJECT_SEARCH_CHARS);
    }
  }

  // “Where does this exact string appear: …” — search the phrase, not issue_id.
  const exactNeedle = extractPastedExactStringNeedle(trimmed);
  if (exactNeedle) {
    return clip(exactNeedle, MAX_REJECT_SEARCH_CHARS);
  }

  // Create-issue locate: land on ViewSet/create serializer, not reject slogans.
  if (isCreateLocateAsk(trimmed)) {
    return clip("IssueCreateSerializer");
  }

  // Calm backend-state locate: "work-item states live backend" floods issue seeds.
  // Lead with the model/class name repos actually use.
  if (isBackendStateLocateAsk(trimmed)) {
    return clip("class State");
  }

  // API key / request-auth locate: prefer the Authentication class over config catalogs.
  if (isApiKeyRequestAuthLocateAsk(trimmed)) {
    return clip("APIKeyAuthentication");
  }

  const identifier = firstIdentifier(trimmed);
  if (identifier && !(isApiRejectAsk(trimmed) && isApiFieldIdToken(identifier))) {
    return clip(identifier);
  }

  // "Where is the Button component" — prefer Button over the role phrase.
  // Do not use HTTP/English Pascal (Authorization, Users) or a sentence-initial
  // subject ("Users can't move…") as the hunt key.
  const pascalName = [...trimmed.matchAll(/\b([A-Z][a-z][a-zA-Z0-9]+)(?!['’])\b/g)]
    .map((match) => match[1]!)
    .find((word) => isSearchablePascal(word, trimmed));
  if (pascalName) {
    return clip(pascalName);
  }

  const locate = locateObjectPhrase(trimmed);
  if (locate) {
    return clip(locate);
  }

  const role = trimmed.match(ROLE_NOUN);
  if (role) {
    return clip(role[0]);
  }

  const tokens = significantTokens(trimmed).filter((token) => !isJunkSearchToken(token));
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
  // Reject hunts: keep ValidationError / “Parent is not valid…” criteria.
  // Rewriting long error strings to get("parent") is why Exact Parent never hit Zoekt.
  if (isApiRejectAsk(userMessage) && isRejectShapedSearchCriterion(q)) {
    return clip(q, MAX_REJECT_SEARCH_CHARS);
  }
  if (
    isApiRejectAsk(userMessage) &&
    askedRejectErrorQuotes(userMessage).some((quote) => {
      const needle = quote.toLowerCase().replace(/\s+/g, " ");
      const hay = q.toLowerCase().replace(/\s+/g, " ").replace(/^["']|["']$/g, "");
      return needle.includes(hay) || hay.includes(needle.slice(0, Math.min(needle.length, 24)));
    })
  ) {
    return clip(q, MAX_REJECT_SEARCH_CHARS);
  }
  if (q.length > MAX_SEARCH_CHARS || q === userMessage.trim() || looksLikeFullQuestion(q)) {
    return extracted;
  }
  // Sentence-subject English ("Users can't…") is not a hunt key.
  if (PROSE_PASCAL.has(q.toLowerCase())) {
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
  const namedQueries = namedFileIndexQueries(trimmed);
  if (namedQueries.length > 0) {
    return namedQueries.join(" OR ");
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
  if (
    userMessage &&
    isLocaleCatalogPath(fileName) &&
    !userAskedAboutLocales(userMessage)
  ) {
    return true;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isClientUiPath(fileName)) {
    return true;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isApiRejectNoisePath(fileName)) {
    return true;
  }
  if (userMessage && isBackendStateLocateAsk(userMessage) && isClientUiPath(fileName)) {
    return true;
  }
  if (
    userMessage &&
    isBackendStateLocateAsk(userMessage) &&
    (isSeedOrFixturePath(fileName) || isDocOrSpecPath(fileName))
  ) {
    return true;
  }
  if (userMessage && isRequestAuthLocateAsk(userMessage) && isClientUiPath(fileName)) {
    return true;
  }
  if (userMessage && isRequestAuthLocateAsk(userMessage) && pathLooksLikeConfigCatalog(fileName)) {
    return true;
  }
  if (userMessage && isCreateLocateAsk(userMessage) && isClientUiPath(fileName)) {
    return true;
  }
  if (
    userMessage &&
    isCreateLocateAsk(userMessage) &&
    (isSeedOrFixturePath(fileName) ||
      isDocOrSpecPath(fileName) ||
      isMigrationPath(fileName) ||
      isHtmlTemplatePath(fileName) ||
      isIconOrAssetPath(fileName))
  ) {
    return true;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isSchemaCatalogPath(fileName)) {
    return true;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isSeedOrFixturePath(fileName)) {
    return true;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isDocOrSpecPath(fileName)) {
    return true;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isQueryFilterPath(fileName)) {
    return true;
  }
  if (
    userMessage &&
    isApiRejectAsk(userMessage) &&
    isTestPath(fileName) &&
    !userAskedAboutTests(userMessage)
  ) {
    return true;
  }
  // Locate with a named symbol or role: skip docs/tests/fixtures. This does not
  // catch mention-class stories; the locate verdict does.
  if (
    userMessage &&
    !isApiRejectAsk(userMessage) &&
    (namedSymbolKeys(userMessage).length > 0 || queryRoleHints(userMessage).length > 0) &&
    (isDocOrSpecPath(fileName) ||
      isSeedOrFixturePath(fileName) ||
      (isTestPath(fileName) && !userAskedAboutTests(userMessage)))
  ) {
    return true;
  }
  return false;
}

/**
 * Progressively broader index queries, tried in order when the first search
 * returns nothing readable. Starts from the question's own words, then
 * English aliases (work item → issue/state) so a prose locate can hit the
 * names the repo actually uses.
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
  if (isApiRejectAsk(userMessage)) {
    // Quote-first: long error strings need the reject clip budget (not 48).
    for (const quote of rejectQuoteFirstSearchQueries(userMessage)) {
      const clipped = clip(quote, MAX_REJECT_SEARCH_CHARS);
      if (clipped && !unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
        unique.push(clipped);
      }
    }
    for (const rejectQuery of apiRejectSearchQueries(userMessage)) {
      const clipped = clip(rejectQuery, MAX_REJECT_SEARCH_CHARS);
      if (clipped && !unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
        unique.push(clipped);
      }
    }
    for (const alias of proseLocateSearchAliases(userMessage)) {
      push(alias);
    }
    return unique.slice(0, MAX_API_REJECT_FALLBACK_QUERIES);
  }
  // Calm state-definition locate is a small symbol hunt. Keep its fallback
  // budget to distinct definition-oriented terms instead of splitting the
  // natural-language ask into repeated state/work-item synonyms.
  if (isBackendStateLocateAsk(userMessage) && !isRequestAuthLocateAsk(userMessage)) {
    push("class State");
    push("State model");
    return unique.slice(0, 3);
  }
  push(primary);
  if (identifiers.length && !role && !isShipCheckQuery(userMessage)) {
    for (const id of identifiers) {
      push(id);
      for (const alias of identifierSearchAliases(id)) push(alias);
    }
    return unique.slice(0, MAX_FALLBACK_QUERIES);
  }
  if (isShipCheckQuery(userMessage)) {
    push("unauthorized");
  }
  for (const alias of proseLocateSearchAliases(userMessage)) {
    push(alias);
  }
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
  if (role) {
    for (const alias of rolePhraseFileAliases(role)) {
      push(alias);
    }
  }
  for (const token of tokens) {
    if (isJunkSearchToken(token)) {
      continue;
    }
    push(token);
    if (unique.length >= MAX_FALLBACK_QUERIES) {
      break;
    }
  }
  return unique.slice(0, MAX_FALLBACK_QUERIES);
}

/**
 * Ask-derived index queries from THIS paste's wording — not a fixed slogan bank.
 * Prefer distinctive error fragments the user actually wrote. Never lead with
 * English slogans like "reject a bad X" (those match noise, not ValidationError).
 */
export function inventAskDerivedSearchCriteria(userMessage: string): string[] {
  const text = userMessage.replace(/\s+/g, " ").trim();
  if (text.length < 8) {
    return [];
  }
  const unique: string[] = [];
  const rejectAsk = isApiRejectAsk(userMessage);
  const push = (candidate: string | undefined): void => {
    const clipped = clip(
      candidate ?? "",
      rejectAsk ? MAX_REJECT_SEARCH_CHARS : MAX_SEARCH_CHARS
    );
    if (!clipped || clipped.length < 3) {
      return;
    }
    if (isGenericRejectSlogan(clipped)) {
      return;
    }
    if (unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      return;
    }
    unique.push(clipped);
  };

  const named = allIdentifiers(text);
  if (!rejectAsk && named.length && !text.match(ROLE_NOUN) && !isShipCheckQuery(text)) {
    for (const id of named) {
      push(id);
      for (const alias of identifierSearchAliases(id)) push(alias);
    }
    return unique;
  }

  for (const match of text.matchAll(/"([^"]{3,80})"|`([^`]{3,80})`/g)) {
    push(match[1] ?? match[2]);
  }

  // Distinctive situational / error fragments — not "reject a bad transition".
  const fragmentPatterns = [
    /\b([a-z][a-z0-9_]*(?:\s+[a-z][a-z0-9_]*){0,5}\s+(?:isn'?t|is not|not)\s+(?:in|a|an|valid|on)\s+[a-z][a-z0-9_]*(?:\s+[a-z][a-z0-9_]*){0,3})/gi,
    /\b((?:must|does not|doesn't)\s+(?:belong|exist|match)(?:\s+[a-z][a-z0-9_]*){0,6})/gi,
    /\b(out of\s+[a-z][a-z0-9_]+)\b/gi
  ];
  for (const pattern of fragmentPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      push(match[1]);
    }
  }

  if (isApiRejectAsk(userMessage)) {
    for (const field of askedRejectFieldTokens(userMessage)) {
      const stem = field.replace(/_id$/i, "");
      if (stem.length >= 3) {
        push(`${stem} is not valid`);
        push(`ValidationError ${stem}`);
        push(`${stem} ValidationError`);
      }
    }
  }

  return unique.slice(0, 8);
}

/**
 * English about the bug ("reject a bad parent") — not index-ready. Slogan pad
 * and ValidationError/get("field") lists cover the code shape instead.
 */
export function isGenericRejectSlogan(query: string): boolean {
  const q = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (!q) {
    return false;
  }
  if (/^rejects?\s+(a\s+)?bad\b/.test(q)) {
    return true;
  }
  if (/^bad\s+(parent|assignee|state|transition|estimate)(?:\s+\w+){0,3}$/.test(q)) {
    return true;
  }
  if (/^rejects?\s+a\s+bad\s+(parent|assignee|state|transition)/.test(q)) {
    return true;
  }
  return false;
}

/**
 * Planned quarterback criteria useful for an API-reject hunt. Calm locate
 * topics ("work item state") and generic reject slogans are ignored — fail open
 * to invent + slogan pad.
 */
export function isRejectShapedSearchCriterion(query: string): boolean {
  const q = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (!q || isGenericRejectSlogan(q)) {
    return false;
  }
  if (
    /^(work[-\s]?items?|work[-\s]?item\s+states?|api\s*key|request\s+authentication|authentication)\b/.test(
      q
    ) &&
    !/(valid|error|reject|validation|get\(|400)/.test(q)
  ) {
    return false;
  }
  return (
    /validationerror|get\s*\(|\["|raise\b|is not valid|not valid|must belong|does not (?:exist|belong)|isn'?t in|\b400\b|invalid\s+\w+|^validate_[a-z][a-z0-9_]*$|_id\b/.test(
      q
    ) ||
    (/\b(parent|assignee|state|transition|estimate)\b/.test(q) &&
      /(valid|error|reject|validation|project|belong)/.test(q))
  );
}

/**
 * When Lightning returns zero hits, try code-host full-text search for
 * reject-shaped or long quoted error strings — not every empty locate.
 */
export function shouldFailOpenCodeHostSearch(query: string): boolean {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q || q.length < 8) {
    return false;
  }
  if (isRejectShapedSearchCriterion(q)) {
    return true;
  }
  if (/["'][^"']{12,}["']/.test(q)) {
    return true;
  }
  return /\bis not valid\b|\bValidationError\b|\braise\b/i.test(q);
}

/**
 * Lightning "satisfied" this search only if hits actually carry the phrase for
 * multi-word / quoted error queries. Short tokens (ValidationError) keep any hit.
 * Prevents: ValidationError → error_codes noise → skip codehost on later quotes.
 */
export function lightningHitsSatisfySearchQuery(
  hits: Array<{ content?: string }>,
  query: string
): boolean {
  if (hits.length === 0) {
    return false;
  }
  if (!shouldFailOpenCodeHostSearch(query)) {
    return true;
  }
  const needle = query
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // Short / single-token criteria — any Lightning hit is enough for this step.
  if (needle.length < 16 || !/\s/.test(needle)) {
    return true;
  }
  const prefix = needle.slice(0, Math.min(28, needle.length));
  return hits.some((hit) => {
    const hay = (hit.content ?? "").toLowerCase().replace(/\s+/g, " ");
    if (!hay) {
      return false;
    }
    if (hay.includes(needle) || hay.includes(prefix)) {
      return true;
    }
    // Hit is a Match span inside the asked phrase.
    if (needle.includes(hay.replace(/^["'`]+|["'`]+$/g, "").trim()) && hay.trim().length >= 12) {
      return true;
    }
    return false;
  });
}

/**
 * Mutation / job words from the ask that distinguish twin raise sites
 * (e.g. create/update vs an unrelated draft sibling). Not path hardcoding —
 * used only to decide whether gather may continue under budget after a first attach.
 */
export function askRejectJobTokens(userMessage: string): string[] {
  const raw = userMessage.toLowerCase();
  const tokens: string[] = [];
  const push = (token: string): void => {
    if (!tokens.includes(token)) {
      tokens.push(token);
    }
  };
  if (/\bcreat(e|es|ed|ing)\b/.test(raw)) {
    push("create");
  }
  if (/\bupdat(e|es|ed|ing)\b/.test(raw)) {
    push("update");
  }
  if (/\bassign(s|ed|ing|ee)?\b/.test(raw)) {
    push("assign");
  }
  if (/\btransition(s|ed|ing)?\b/.test(raw)) {
    push("transition");
  }
  if (/\bdelet(e|es|ed|ing)\b/.test(raw)) {
    push("delete");
  }
  if (/\binvent(s|ed|ing)?\b/.test(raw)) {
    push("invent");
  }
  if (/\bpatch(es|ed|ing)?\b/.test(raw)) {
    push("patch");
  }
  if (/\b(?:signer|signing|signature|sign(?:s|ed)?)\b/.test(raw) &&
      !/\bsign[ -]?(?:in|up)\b/.test(raw)) {
    push("sign");
  }
  return tokens;
}

/** True when attached reject evidence mentions ask job tokens (or ask has none). */
export function rejectEvidenceMatchesAskJob(
  files: Array<{ path?: string; content?: string }>,
  userMessage: string
): boolean {
  const tokens = askRejectJobTokens(userMessage);
  if (tokens.length === 0) {
    return true;
  }
  return files.some((file) => {
    const path = (file.path ?? "").toLowerCase().replace(/\\/g, "/");
    const content = file.content ?? "";
    return tokens.some((token) => {
      // Path segment (create_issue.py) or defining class (class IssueCreateSerializer).
      // Do NOT count imports — live Fail: draft.py imports IssueCreateSerializer.
      if (path.includes(token)) {
        return true;
      }
      return new RegExp(`\\b(?:class|def|function)\\s+\\w*${token}\\w*`, "i").test(content) ||
        new RegExp(`\\b(?:const|let)\\s+\\w*${token}\\w*\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|\\w+\\s*=>)`, "i").test(content);
    });
  });
}

/**
 * Ask has create/update/… but this path/snippet does not — a twin raise site
 * (live: draft.py when ask said create/update). Demote; do not freeze invent.
 */
export function isWeakRejectTwinForAsk(
  path: string,
  content: string,
  userMessage: string
): boolean {
  const tokens = askRejectJobTokens(userMessage);
  if (tokens.length === 0) {
    return false;
  }
  return !rejectEvidenceMatchesAskJob([{ path, content }], userMessage);
}

/** Higher = prefer first when inventing reject sites under a job-constrained ask. */
export function rejectInventPathRank(path: string, userMessage: string): number {
  const tokens = askRejectJobTokens(userMessage);
  const n = path.replace(/\\/g, "/").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (n.includes(token)) {
      score += 4;
    }
  }
  // Alternate write surface not named in the ask — demote, don't path-hardcode ban.
  if (tokens.length > 0 && /\bdraft\b/.test(n)) {
    score -= 3;
  }
  if (/(^|\/)serializers?\//.test(n) && !/\bdraft\b/.test(n)) {
    score += 1;
  }
  return score;
}

/**
 * When invent opens a weak twin (draft.py), follow relative imports that name
 * ask job serializers (IssueCreateSerializer) — evidence-driven, not a path table.
 */
export function relatedSerializerPathsFromWeakTwin(
  weakPath: string,
  body: string,
  userMessage: string
): string[] {
  const tokens = askRejectJobTokens(userMessage);
  if (tokens.length === 0) {
    return [];
  }
  const normalized = weakPath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : "";
  const out: string[] = [];
  const push = (rel: string): void => {
    const path = dir ? `${dir}/${rel}` : rel;
    if (!out.includes(path)) {
      out.push(path);
    }
  };
  for (const match of body.matchAll(
    /from\s+\.(\w+)\s+import\s+([^\n]+)/g
  )) {
    const mod = match[1] ?? "";
    const names = match[2] ?? "";
    if (
      tokens.some((token) => new RegExp(token, "i").test(names)) ||
      /CreateSerializer|UpdateSerializer/i.test(names)
    ) {
      push(`${mod}.py`);
    }
  }
  // Same-folder peer: draft.py → issue.py when ask wants create/update.
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  if (/\bdraft\b/i.test(base) && (tokens.includes("create") || tokens.includes("update"))) {
    push("issue.py");
  }
  return out;
}

/**
 * Rank a candidate reject path for ask job words (create/update/…).
 * Higher = better twin. Live Fail: IssueCreateSerializer invent opened draft.py first.
 */
export function scoreRejectPathForAskJob(
  path: string,
  content: string,
  userMessage: string
): number {
  const tokens = askRejectJobTokens(userMessage);
  if (tokens.length === 0) {
    return 0;
  }
  const pathLower = path.toLowerCase().replace(/\\/g, "/");
  const hay = `${pathLower}\n${content}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (pathLower.includes(token)) {
      score += 4;
    }
    // Defining class embeds the job: IssueCreateSerializer — not an import line.
    if (new RegExp(`\\bclass\\s+\\w*${token}\\w*`, "i").test(content)) {
      score += 5;
    }
  }
  return score;
}

/**
 * Ask-derived symbol / validate queries when Exact error quote is absent from
 * Lightning + codehost. Built from field stems and entity+create/update nouns
 * in THIS ask — not a Plane path table. Finish rail may run ≤2 of these before miss.
 */
export function inventRejectSymbolSearchCriteria(userMessage: string): string[] {
  if (!isApiRejectAsk(userMessage)) {
    return [];
  }
  const out: string[] = [];
  const push = (candidate: string): void => {
    const clipped = clip(candidate, MAX_REJECT_SEARCH_CHARS);
    if (!clipped || out.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      return;
    }
    out.push(clipped);
  };

  const entities: string[] = [];
  if (/\bissues?\b/i.test(userMessage)) {
    entities.push("Issue");
  }
  if (/\bwork[-\s]?items?\b/i.test(userMessage) && !entities.includes("Issue")) {
    entities.push("Issue");
  }
  if (/\bprojects?\b/i.test(userMessage) && /\b(create|update|assign)\b/i.test(userMessage)) {
    entities.push("Project");
  }

  const jobs = askRejectJobTokens(userMessage);
  // Prefer class-definition queries — SCIP often re-exports to __init__.py (live Fail).
  for (const entity of entities) {
    for (const job of jobs) {
      const pascal = `${job.charAt(0).toUpperCase()}${job.slice(1)}`;
      push(`class ${entity}${pascal}Serializer`);
      push(`${entity}${pascal}Serializer`);
    }
    push(`class ${entity}Serializer`);
    push(`${entity}Serializer`);
  }

  for (const field of askedRejectFieldTokens(userMessage)) {
    const stem = field.replace(/_id$/i, "");
    if (stem.length >= 3) {
      push(`validate_${stem}`);
    }
  }

  return out.slice(0, 4);
}

/**
 * Quote-first on reject (Exact Parent law), then quarterback planned (reject-shaped
 * only), then invent, then slogan/fallback pad. Never lead with ValidationError
 * when the ask already pasted the error string.
 * Fail-open / no-planTurn pad only — must not drive live Activity when planTurn exists.
 */
export function mergePlannedAgentSearchQueries(options: {
  userMessage: string;
  planned?: string[];
  max?: number;
}): string[] {
  const max = options.max ?? MAX_API_REJECT_FALLBACK_QUERIES;
  const unique: string[] = [];
  const rejectAsk = isApiRejectAsk(options.userMessage);
  const push = (candidate: string | undefined): void => {
    const clipped = clip(
      candidate ?? "",
      rejectAsk ? MAX_REJECT_SEARCH_CHARS : MAX_SEARCH_CHARS
    );
    if (!clipped) {
      return;
    }
    if (unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      return;
    }
    unique.push(clipped);
  };

  if (rejectAsk) {
    for (const quote of rejectQuoteFirstSearchQueries(options.userMessage)) {
      push(quote);
    }
  }
  const hasExactQuote = rejectAsk && rejectQuoteFirstSearchQueries(options.userMessage).length > 0;
  for (const planned of options.planned ?? []) {
    if (rejectAsk && !isRejectShapedSearchCriterion(planned)) {
      continue;
    }
    // Do not let planned ValidationError / get("field") / bare field tokens outrank Exact quote.
    if (hasExactQuote) {
      const p = planned.trim();
      if (
        /^ValidationError\b/i.test(p) ||
        /^get\s*\(/i.test(p) ||
        /^[a-z][a-z0-9]*_id$/i.test(p) ||
        /^(parent|assignee|state|issue_id)$/i.test(p)
      ) {
        continue;
      }
    }
    push(planned);
  }
  for (const invented of inventAskDerivedSearchCriteria(options.userMessage)) {
    push(invented);
  }
  for (const fallback of fallbackAgentSearchQueries(options.userMessage)) {
    push(fallback);
  }
  return unique.slice(0, Math.max(1, max));
}

/**
 * Bounded locate-job queries for one-shot context gather.
 * Named files and identifiers win the cap; generic prose is last.
 */
export function locateJobIndexQueries(terms: string[], max = 3): string[] {
  const cleaned = terms.map((term) => term.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return [];
  }
  const unique: string[] = [];
  const push = (candidate: string | undefined): void => {
    const clipped = clip(candidate ?? "");
    if (!clipped) {
      return;
    }
    if (unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      return;
    }
    unique.push(clipped);
  };

  for (const term of cleaned) {
    for (const file of namedFileIndexQueries(term)) {
      push(file);
    }
  }
  for (const term of cleaned) {
    if (allIdentifiers(term).some((id) => id.toLowerCase() === term.toLowerCase())) {
      push(term);
    }
  }
  for (const term of cleaned) {
    push(term);
  }
  for (const term of fallbackAgentSearchQueries(cleaned.join(" "))) {
    push(term);
  }
  return unique.slice(0, Math.max(1, max));
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
    pool = pool.filter((hit) =>
      textMentionsQueryRoles(`${hit.fileName}\n${hit.content ?? ""}`, userMessage)
    );
  } else if (
    keys.length > 0 &&
    pool.length === 0 &&
    userMessage &&
    queryRoleHints(userMessage).length > 0
  ) {
    const roleHits = ranked.filter((hit) =>
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
  if (userMessage && isShipCheckQuery(userMessage)) {
    const unauthorizedHits = pool.filter((hit) =>
      contentLooksLikeUnauthorizedWrite(hit.content ?? "")
    );
    if (unauthorizedHits.length > 0) {
      pool = [
        ...unauthorizedHits,
        ...pool.filter((hit) => !unauthorizedHits.includes(hit))
      ];
    }
  }
  if (userMessage && isApiRejectAsk(userMessage)) {
    const writers = pool.filter((hit) => isServerWritePath(hit.fileName));
    if (writers.length > 0) {
      pool = [...writers, ...pool.filter((hit) => !writers.includes(hit))];
    }
    const fieldHits = pool.filter((hit) =>
      contentLooksLikeAskedFieldReject(hit.content ?? "", userMessage, hit.fileName)
    );
    if (fieldHits.length > 0) {
      pool = fieldHits;
    } else {
      pool = pool.filter((hit) => {
        const snippet = hit.content ?? "";
        if (contentLooksLikeWrongFieldReject(snippet, userMessage)) {
          const path = normalizePath(hit.fileName);
          return (
            /(^|\/)serializers?\//.test(path) || /\.serializer\.(py|ts|go|rb)$/.test(path)
          );
        }
        return isActionableApiRejectHit(hit);
      });
    }
    const mutators = pool.filter((hit) => contentLooksLikeWriteReject(hit.content ?? ""));
    if (mutators.length > 0) {
      pool = [...mutators, ...pool.filter((hit) => !mutators.includes(hit))];
    }
  }
  if (userMessage && isCreateLocateAsk(userMessage)) {
    const creates = pool.filter((hit) => isCreateDefinitionHit(hit));
    if (creates.length > 0) {
      pool = creates;
    } else {
      pool = pool.filter(
        (hit) =>
          !isClientUiPath(hit.fileName) &&
          !isTestPath(hit.fileName) &&
          (isServerWritePath(hit.fileName) || isMutationHandlerPath(hit.fileName))
      );
    }
  }
  if (userMessage && isRequestAuthLocateAsk(userMessage) && isBackendStateLocateAsk(userMessage)) {
    // Compound Monday ask: keep auth enforcement AND state definition hits together.
    const enforcement = pool.filter((hit) => isRequestAuthEnforcementHit(hit));
    const definitions = pool.filter((hit) => isBackendStateDefinitionHit(hit));
    const preferred = [
      ...enforcement,
      ...definitions.filter((hit) => !enforcement.includes(hit))
    ];
    if (preferred.length > 0) {
      // Auth alone must not pad with a wrong-field issue serializer as "state".
      pool = preferred;
    } else {
      pool = pool.filter(
        (hit) =>
          !isClientUiPath(hit.fileName) &&
          !pathLooksLikeConfigCatalog(hit.fileName) &&
          !contentLooksLikeSecondarySecretGate(hit.content ?? "") &&
          !isUnrelatedSerializerForStateLocate(hit)
      );
    }
  } else if (userMessage && isRequestAuthLocateAsk(userMessage)) {
    const enforcement = pool.filter((hit) => isRequestAuthEnforcementHit(hit));
    if (enforcement.length > 0) {
      pool = enforcement;
    } else {
      pool = pool.filter(
        (hit) =>
          !pathLooksLikeConfigCatalog(hit.fileName) &&
          !contentLooksLikeSecondarySecretGate(hit.content ?? "")
      );
    }
  } else if (userMessage && isBackendStateLocateAsk(userMessage)) {
    const definitions = pool.filter((hit) => isBackendStateDefinitionHit(hit));
    if (definitions.length > 0) {
      pool = definitions;
    } else {
      const backend = pool.filter(
        (hit) =>
          !isClientUiPath(hit.fileName) &&
          !isUnrelatedSerializerForStateLocate(hit) &&
          (isServerWritePath(hit.fileName) ||
            isSchemaCatalogPath(hit.fileName) ||
            isMutationHandlerPath(hit.fileName))
      );
      if (backend.length > 0) {
        pool = backend;
      } else {
        pool = pool.filter((hit) => !isClientUiPath(hit.fileName));
      }
    }
  }
  if (userMessage) {
    pool = preferredHitsForLocate(pool, userMessage);
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
  const rejectAsk = isApiRejectAsk(userMessage);
  const scored = symbols
    .map((symbol) => ({ symbol, score: symbolNameScore(symbol, ident, terms, userMessage) }))
    .filter((entry) => {
      if (entry.score <= 0 || shouldSkipEvidencePath(entry.symbol.file, userMessage)) {
        return false;
      }
      // Reject hunts: symbol index must not prefer types packages or filter utils.
      if (rejectAsk) {
        return isActionableApiRejectHit({ fileName: entry.symbol.file, content: "" });
      }
      return true;
    })
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
 * camelCase / snake_case / multi-hump Pascal the user likely meant as a code
 * symbol. Single-hump Pascal (Authorization, Users, Button) is not specific
 * enough to require that token in every read — that latched C1/C2 onto prose.
 */
export function isSpecificCodeIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4 || /\s/.test(trimmed)) {
    return false;
  }
  return /_/.test(trimmed) || /[a-z][A-Z]/.test(trimmed) || /^[A-Z][a-z]+[A-Z]/.test(trimmed);
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
    if (
      !value ||
      seen.has(key) ||
      namedFileMatchIsUrl(userMessage, match.index) ||
      shouldIgnoreNamedFileRef(value)
    ) {
      continue;
    }
    seen.add(key);
    named.push(value);
  }
  return named;
}

function namedFileMatchIsUrl(message: string, matchIndex: number): boolean {
  const token = (message.slice(0, matchIndex).split(/\s/).pop() ?? "").toLowerCase();
  if (token.includes("://")) {
    return true;
  }
  const host = token.replace(/^[(`'"<\[]+/, "").replace(/\/+$/, "");
  const ext = fileRefExtension(host);
  return Boolean(ext && BLOCKED_FILE_EXTS.has(ext));
}

function fileRefExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

/** TLDs, version-shaped tokens, URL hosts, and `e.g.` / `node.js` prose. */
function shouldIgnoreNamedFileRef(value: string): boolean {
  const normalized = value.replace(/^\/+/, "").toLowerCase();
  if (!normalized || normalized.includes("://")) {
    return true;
  }
  const parts = normalized.split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? normalized;
  if (PROSE_FILE_BASENAMES.has(base)) {
    return true;
  }
  if (PRODUCT_FILE_BASENAMES.has(base) && parts.length < 2) {
    return true;
  }
  for (const segment of parts.slice(0, -1)) {
    const hostExt = fileRefExtension(segment);
    if (hostExt && BLOCKED_FILE_EXTS.has(hostExt)) {
      return true;
    }
  }
  const ext = fileRefExtension(base);
  return !ext || BLOCKED_FILE_EXTS.has(ext);
}

/** Basenames to search when the user typed files (`customers.jsp`, `src/foo.ts`). */
export function namedFileIndexQueries(userQuery: string, limit = 2): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const file of extractNamedSourceFiles(userQuery)) {
    const basename = file.split("/").pop() ?? file;
    const key = basename.toLowerCase();
    if (!basename || seen.has(key)) {
      continue;
    }
    seen.add(key);
    queries.push(basename);
    if (queries.length >= limit) {
      break;
    }
  }
  return queries;
}

/** Named files or identifier basenames the user typed — keep them ahead of the attach cap. */
export function queryNamesEvidencePath(fileName: string, userMessage: string): boolean {
  if (queryNamesSourceFile(fileName, userMessage)) {
    return true;
  }
  const base = (fileName.split("/").pop() ?? fileName).replace(/\.[^.]+$/, "");
  if (base.length < 4) {
    return false;
  }
  return allIdentifiers(userMessage).some((id) => id.toLowerCase() === base.toLowerCase());
}

/** Named files the user typed stay first so a locate cap cannot drop them. */
export function preferNamedSourcePaths(paths: string[], userMessage: string): string[] {
  const named: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
    if (!path.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (queryNamesEvidencePath(path, userMessage)) {
      named.push(path);
    } else {
      rest.push(path);
    }
  }
  return [...named, ...rest];
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

/** API payload field (`issue_id`, `parent_id`) — not a function to ground a hunt. */
export function isApiFieldIdToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4) {
    return false;
  }
  return /_id$/i.test(trimmed) || /[a-z]Id$/.test(trimmed);
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
  // On-call API reject: issue_id is the field, not a C1-style symbol latch.
  if (isApiRejectAsk(userMessage) && isApiFieldIdToken(primary)) {
    return [];
  }
  // Create locate primary is a synthetic alias (IssueCreateSerializer), not a
  // symbol the user typed — do not require it in every read body.
  if (isCreateLocateAsk(userMessage)) {
    return [];
  }
  // Calm state/auth locate primaries are aliases too (class State / APIKey…).
  if (isBackendStateLocateAsk(userMessage) || isApiKeyRequestAuthLocateAsk(userMessage)) {
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

function sourceFileStem(file: string): string {
  const base = (file.split("/").pop() ?? file).replace(/^\/+/, "");
  return base
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/_test\.[^.]+$/i, "")
    .replace(/\.[^.]+$/, "");
}

function isStemOfNamedSourceFile(identifier: string, userMessage: string): boolean {
  const stem = identifier.replace(/\.[^.]+$/, "").toLowerCase();
  const identNorm = normalizeSymbol(identifier);
  return extractNamedSourceFiles(userMessage).some((file) => {
    const base = sourceFileStem(file);
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

/**
 * "requireAuth or authentication middleware" is an OR. Named-only asks still
 * require the identifier; role-only asks still require the role.
 */
export function textSatisfiesLocateQuery(text: string, userMessage: string): boolean {
  const hasNamed = queryHasNamedSymbol(userMessage);
  const hasRole = queryRoleHints(userMessage).length > 0;
  const namedOk = !hasNamed || textMentionsNamedSymbol(text, userMessage);
  const roleOk = !hasRole || textMentionsQueryRoles(text, userMessage);
  if (hasNamed && hasRole) {
    return namedOk || roleOk;
  }
  return namedOk && roleOk;
}

/**
 * File line of a call / import of the named symbol that is not its declaration.
 * Same-file `extractBearerToken(headers)` at L77 counts; the export does not.
 */
export function lineNumberOfCallerUse(
  text: string,
  userMessage: string,
  groundedExport?: string
): number | undefined {
  const forms = callerSymbolForms(userMessage, groundedExport);
  if (!forms.length || !text) {
    return undefined;
  }
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? "";
    const line = row.replace(/^\d+\|/, "");
    if (!forms.some((form) => textHasIdentifierToken(line, form))) {
      continue;
    }
    if (lineLooksLikeSymbolDeclaration(line, forms)) {
      continue;
    }
    const prefixed = /^(\d+)\|/.exec(row);
    if (prefixed) {
      const numbered = Number(prefixed[1]);
      if (Number.isInteger(numbered) && numbered >= 1) {
        return numbered;
      }
    }
    return i + 1;
  }
  return undefined;
}

/**
 * A call / import of the named symbol on a line that is not its declaration.
 * Same-file `extractBearerToken(headers)` at L77 counts; the export does not.
 */
export function readBodyHasCallerUse(
  text: string,
  userMessage: string,
  groundedExport?: string
): boolean {
  return lineNumberOfCallerUse(text, userMessage, groundedExport) !== undefined;
}

/** `auth middleware` → authMiddleware / authMiddleware.ts for last-chance index queries. */
function rolePhraseFileAliases(rolePhrase: string): string[] {
  const words = rolePhrase
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) {
    return [];
  }
  const camel =
    words[0] + words.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  if (camel.length < 4) {
    return [];
  }
  return [camel, `${camel}.ts`];
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
  return identifierForms(primary);
}

function identifierForms(primary: string): string[] {
  const trimmed = primary.trim();
  if (!trimmed) {
    return [];
  }
  const forms = new Set<string>([trimmed]);
  for (const alias of identifierSearchAliases(trimmed)) {
    if (alias.length >= 4) {
      forms.add(alias);
    }
  }
  return [...forms];
}

function callerSymbolForms(userMessage: string, groundedExport?: string): string[] {
  const named = namedSymbolForms(userMessage);
  if (named.length) {
    return named;
  }
  const exportName = groundedExport?.trim();
  if (!exportName) {
    return [];
  }
  return identifierForms(exportName);
}

function lineLooksLikeSymbolDeclaration(content: string, forms: string[]): boolean {
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

function textHasIdentifierToken(text: string, form: string): boolean {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "i").test(text);
}

export function contentLooksLikeDeclaration(
  content: string,
  userMessage: string,
  groundedExport?: string
): boolean {
  return lineLooksLikeSymbolDeclaration(content, callerSymbolForms(userMessage, groundedExport));
}

export function userAskedAboutTests(userMessage: string): boolean {
  return (
    /\b(tests?|specs?|unit\s*tests?|contract\s*tests?)\b/i.test(userMessage) ||
    isShipCheckQuery(userMessage)
  );
}

function userAskedAboutLocales(userMessage: string): boolean {
  return /\b(i18n|l10n|locale|locales|translation|translations|copy catalog)\b/i.test(
    userMessage
  );
}

/**
 * Explicit on-call / reject language — not bare “API” or “work-item”.
 * Locate asks (“where is auth…”, “where do states live”) share those nouns
 * and must not enter the ValidationError scavenger hunt.
 */
function hasExplicitApiRejectSignal(text: string): boolean {
  return (
    /\b(4xx|rejects?|rejecting|illegal|invalid)\b/.test(text) ||
    /\breturns?\s+an?\s+error\b/.test(text) ||
    /\bcan'?t\b/.test(text) ||
    /\bcannot\b/.test(text) ||
    /\b(isn'?t|is not|not valid)\b/.test(text) ||
    /\bbad\s+[a-z][a-z0-9_]*\b/.test(text) ||
    /\bvalidationerror\b/.test(text)
  );
}

/**
 * Calm locate / “where does X live” with no reject/error complaint.
 * Compound Monday asks (auth + work-item states) must stay here.
 */
function isLocateWithoutRejectComplaint(text: string): boolean {
  const locateShaped =
    /\bwhere\s+(?:is|are|do(?:es)?|can)\b/.test(text) ||
    /\b(?:defined|lives?|live)\b/.test(text) ||
    /\bpoint\s+me\s+at\b/.test(text) ||
    /\bfind\s+(?:the\s+)?(?:existing\s+)?(?:function|file|class|middleware)\b/.test(text);
  return locateShaped && !hasExplicitApiRejectSignal(text);
}

/** On-call paste: API error / write / reject — not board grouping, i18n, or calm locate. */
export function isApiRejectAsk(userMessage: string): boolean {
  const text = userMessage.toLowerCase();
  // "Where is API key… and where do work-item states live?" is locate, not C2.
  if (isLocateWithoutRejectComplaint(text)) {
    return false;
  }
  const apiOrError = /\b(api|4xx|rejects?|rejecting|illegal|invalid|validationerror)\b/.test(text);
  const writeOrTransition = /\b(written|writes?|transition|backlog|work[-\s]?item)\b/.test(
    text
  );
  const fieldReject =
    /\b[a-z][a-z0-9]*_id\b/.test(text) ||
    /\b(parent|assignee|estimate|status)\b/.test(text) ||
    /\bbad\s+[a-z][a-z0-9_]*\b/.test(text) ||
    /\b(isn'?t|is not|not valid)\b/.test(text);
  // Bare "api" + "work-item" is not enough — need an explicit reject/error signal
  // (or a non-locate field-reject paste that already carries isn't/bad/…).
  if (apiOrError && (writeOrTransition || fieldReject)) {
    if (/\bapi\b/.test(text) && !hasExplicitApiRejectSignal(text)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Calm locate: where is API key / request authentication defined.
 * Prefer DRF/Auth middleware enforcement over env catalogs and secondary secret gates.
 */
export function isRequestAuthLocateAsk(userMessage: string): boolean {
  if (isApiRejectAsk(userMessage)) {
    return false;
  }
  const text = userMessage.toLowerCase();
  return (
    /\bapi\s*key\b/.test(text) ||
    /\brequest\s+authentication\b/.test(text) ||
    (/\bauthenticat/.test(text) && /\b(api|request|key|defined|middleware)\b/.test(text))
  );
}

/** Narrower than request-auth: API key / request authentication (not bare middleware hunts). */
export function isApiKeyRequestAuthLocateAsk(userMessage: string): boolean {
  if (isApiRejectAsk(userMessage)) {
    return false;
  }
  const text = userMessage.toLowerCase();
  return /\bapi\s*key\b/.test(text) || /\brequest\s+authentication\b/.test(text);
}

/**
 * Calm locate that must ground on an implementation — not seeds, UI, or catalogs.
 * Used by the agent loop finish gate (same bar as named-symbol / role locates).
 */
export function isDefinitionLocateAsk(userMessage: string): boolean {
  return (
    isParserLocateAsk(userMessage) ||
    isBackendStateLocateAsk(userMessage) ||
    isRequestAuthLocateAsk(userMessage) ||
    isCreateLocateAsk(userMessage) ||
    queryHasNamedSymbol(userMessage) ||
    queryRoleHints(userMessage).length > 0
  );
}

/** Prose parsing asks need a parser declaration, not a token store or caller. */
export function isParserLocateAsk(query: string): boolean {
  return /\b(?:parse|parses|parsing|extract|extracts|extracting|decode|decodes|decoding)\b/i.test(query) &&
    /\b(?:where|find|existing|implementation|function)\b/i.test(query) && !isApiRejectAsk(query);
}

export function contentLooksLikeRequestedParser(content: string, query: string): boolean {
  const terms = queryTerms(query);
  const declarations = /\b(?:function|def|func|fn)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(|\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/g;
  for (const match of content.matchAll(declarations)) {
    const name = match[1] ?? match[2];
    if (!/^(?:parse|extract|decode)(?:[A-Z_]|$)/.test(name)) continue;
    const subject = name.replace(/^(?:parse|extract|decode)/, "").toLowerCase();
    if (terms.some((term) => term.length >= 3 && subject.includes(term))) return true;
  }
  return false;
}

/** Compound auth + work-item/issue state locate — both halves must ground. */
export function isCompoundAuthAndStateLocateAsk(userMessage: string): boolean {
  return isRequestAuthLocateAsk(userMessage) && isBackendStateLocateAsk(userMessage);
}

/**
 * Calm locate: where does the API create an issue / work item.
 * Prefer ViewSet create / CreateSerializer — not reject hunts or UI.
 */
export function isCreateLocateAsk(userMessage: string): boolean {
  if (isApiRejectAsk(userMessage)) {
    return false;
  }
  const text = userMessage.toLowerCase();
  if (!/\bcreates?\b/.test(text) && !/\bcreating\b/.test(text)) {
    return false;
  }
  const resource = /\b(issues?|work[-\s]?items?)\b/.test(text);
  if (!resource) {
    return false;
  }
  return (
    /\b(api|endpoint|viewset|serializer|server|backend)\b/.test(text) ||
    /\bwhere\s+(?:does|do|is|are)\b/.test(text)
  );
}

/**
 * Calm locate: where do work-item / issue states live on the backend/server.
 * Prefer models/views/serializers — not client hooks/stores/commands.
 */
export function isBackendStateLocateAsk(userMessage: string): boolean {
  if (isApiRejectAsk(userMessage)) {
    return false;
  }
  const text = userMessage.toLowerCase();
  if (!/\bstates?\b/.test(text)) {
    return false;
  }
  return (
    /\b(backend|server)\b/.test(text) ||
    /\bwork[-\s]?items?\b/.test(text) ||
    /\bissues?\b/.test(text) ||
    (/\bapi\b/.test(text) && /\b(defined|live|lives)\b/.test(text))
  );
}

/** Path looks like request-auth enforcement (Authentication class / auth middleware). */
export function pathLooksLikeRequestAuthEnforcement(fileName: string): boolean {
  const n = normalizePath(fileName);
  const base = n.split("/").pop() ?? "";
  if (/authentication/.test(base) || /^api_auth/.test(base) || /^auth_middleware\./.test(base)) {
    return true;
  }
  const segments = n.split("/");
  if (segments.includes("authentication")) {
    return true;
  }
  if (segments.includes("middleware") && /auth/.test(n)) {
    return true;
  }
  if (segments.includes("auth") && isServerWritePath(fileName)) {
    return true;
  }
  return false;
}

/** Env / instance config catalogs — they list API_KEY names, they do not authenticate. */
export function pathLooksLikeConfigCatalog(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    n.includes("config_variables") ||
    n.includes("instance_config") ||
    (n.includes("/config/") && (n.includes("variable") || n.includes("constant"))) ||
    (n.includes("/settings/") && n.includes("variable"))
  );
}

/** Snippet is a primary request-auth class / authenticate() — not a secret-key gate. */
export function contentLooksLikeRequestAuthEnforcement(content: string): boolean {
  if (!content) {
    return false;
  }
  return (
    /\bAPIKeyAuthentication\b/.test(content) ||
    /\bclass\s+\w*Authentication\b/.test(content) ||
    /\bdef\s+authenticate\s*\(/.test(content) ||
    /\bauthenticate\s*\(\s*self\s*,\s*request/.test(content) ||
    /\bHTTP_X_API_KEY\b/i.test(content) ||
    /\bX-Api-Key\b/i.test(content)
  );
}

/** Secondary service secret gate (requireSecretKey-shaped) — not API request auth. */
export function contentLooksLikeSecondarySecretGate(content: string): boolean {
  if (!content || contentLooksLikeRequestAuthEnforcement(content)) {
    return false;
  }
  return /\brequireSecretKey\b|\brequire_secret_key\b|\bSECRET_KEY\b|x-secret-key/i.test(
    content
  );
}

export function isRequestAuthEnforcementHit(hit: {
  fileName: string;
  content?: string;
}): boolean {
  if (pathLooksLikeConfigCatalog(hit.fileName)) {
    return false;
  }
  if (contentLooksLikeSecondarySecretGate(hit.content ?? "")) {
    return false;
  }
  return (
    pathLooksLikeRequestAuthEnforcement(hit.fileName) ||
    contentLooksLikeRequestAuthEnforcement(hit.content ?? "")
  );
}

/**
 * Serializer (or similar mutation handler) whose snippet is not a state
 * definition — wrong-field validate, or no State class / state path signal.
 * Used so calm state locate does not latch a generic resource serializer.
 */
export function isUnrelatedSerializerForStateLocate(hit: {
  fileName: string;
  content?: string;
}): boolean {
  const n = normalizePath(hit.fileName);
  const isSerializer =
    /(^|\/)serializers?\//.test(n) || /\.serializer\.(py|ts|go|rb)$/.test(n);
  if (!isSerializer) {
    return false;
  }
  if (isBackendStateDefinitionHitIgnoringSerializerGate(hit)) {
    return false;
  }
  const base = n.split("/").pop() ?? "";
  if (/^state\./.test(base) || /_state\./.test(base) || n.includes("/state/") || n.includes("/states/")) {
    return false;
  }
  const content = hit.content ?? "";
  if (
    /\bclass\s+State\b/.test(content) ||
    /\bStateSerializer\b/.test(content) ||
    /\bStateViewSet\b/.test(content) ||
    /\bclass\s+\w*State(ViewSet|Serializer|Model)?\b/.test(content)
  ) {
    return false;
  }
  return true;
}

/** Same as isBackendStateDefinitionHit but without the unrelated-serializer gate. */
function isBackendStateDefinitionHitIgnoringSerializerGate(hit: {
  fileName: string;
  content?: string;
}): boolean {
  if (isClientUiPath(hit.fileName)) {
    return false;
  }
  const n = normalizePath(hit.fileName);
  const base = n.split("/").pop() ?? "";
  const pathAboutState =
    /^state\./.test(base) ||
    /_state\./.test(base) ||
    n.includes("/state/") ||
    n.includes("/states/");
  if (
    pathAboutState &&
    (isServerWritePath(hit.fileName) ||
      isSchemaCatalogPath(hit.fileName) ||
      isMutationHandlerPath(hit.fileName))
  ) {
    return true;
  }
  const content = hit.content ?? "";
  if (!content) {
    return false;
  }
  return (
    /\bclass\s+State\b/.test(content) ||
    /\bclass\s+\w*State(ViewSet|Serializer|Model)?\b/.test(content) ||
    /\bStateViewSet\b/.test(content) ||
    /\bStateSerializer\b/.test(content)
  );
}

export function isBackendStateDefinitionHit(hit: {
  fileName: string;
  content?: string;
}): boolean {
  if (isUnrelatedSerializerForStateLocate(hit)) {
    return false;
  }
  return isBackendStateDefinitionHitIgnoringSerializerGate(hit);
}

/** True only when the opened source declares the State type itself. */
export function contentLooksLikeStateModelDeclaration(content: string): boolean {
  if (!content.trim()) {
    return false;
  }
  return /\bclass\s+State\b|\btype\s+State\s+struct\b|\bstruct\s+State\b/.test(content);
}

/** @deprecated Use isUnrelatedSerializerForStateLocate — kept as alias for tests. */
export function isNonStateIssueSerializerHit(hit: {
  fileName: string;
  content?: string;
}): boolean {
  return isUnrelatedSerializerForStateLocate(hit);
}

/** Migrations, icons, empty-state packages, HTML templates, shared types — burn reject reads. */
export function isApiRejectNoisePath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    isMigrationPath(fileName) ||
    isIconOrAssetPath(fileName) ||
    isEmptyStatePackagePath(fileName) ||
    isHtmlTemplatePath(fileName) ||
    isSharedTypePackagePath(fileName) ||
    isRejectErrorCatalogPath(fileName)
  );
}

/**
 * ValidationError / error-code catalogs (utils/error_codes.py) — live Fail when
 * preferred over serializers. Not a write-reject site.
 */
export function isRejectErrorCatalogPath(fileName: string): boolean {
  const n = normalizePath(fileName);
  return (
    /(^|\/)(utils|helpers)\/[^/]*error_codes?\.[a-z]+$/.test(n) ||
    /(^|\/)error_codes?\.(py|ts|js|go)$/.test(n) ||
    /(^|\/)(constants|const)\/[^/]*(error|status)_?codes?\.[a-z]+$/.test(n)
  );
}

/** Snippet shows create / perform_create / CreateSerializer for an issue API. */
export function contentLooksLikeCreateHandler(content: string): boolean {
  if (!content) {
    return false;
  }
  return (
    /\bperform_create\s*\(/.test(content) ||
    /\b(?:async\s+)?def\s+create\s*\(/.test(content) ||
    /\b(?:async\s+)?create\s*\(\s*(?:self|req|request|ctx)\b/.test(content) ||
    /\bclass\s+\w*Create\w*Serializer\b/.test(content) ||
    /\bIssueCreateSerializer\b/.test(content)
  );
}

export function isCreateDefinitionHit(hit: {
  fileName: string;
  content?: string;
}): boolean {
  if (
    isClientUiPath(hit.fileName) ||
    isSeedOrFixturePath(hit.fileName) ||
    isDocOrSpecPath(hit.fileName) ||
    isMigrationPath(hit.fileName) ||
    isHtmlTemplatePath(hit.fileName) ||
    isTestPath(hit.fileName)
  ) {
    return false;
  }
  const content = hit.content ?? "";
  if (contentLooksLikeCreateHandler(content)) {
    return true;
  }
  const n = normalizePath(hit.fileName);
  if (
    /\bviewset\b/.test(n) &&
    (isServerWritePath(hit.fileName) || isMutationHandlerPath(hit.fileName))
  ) {
    return /\bcreate\b/.test(content) || /\bIssueViewSet\b/.test(content);
  }
  if (
    /create/.test(n) &&
    (isServerWritePath(hit.fileName) || isMutationHandlerPath(hit.fileName))
  ) {
    return true;
  }
  return (
    /\bclass\s+\w*ViewSet\b/.test(content) &&
    /\bcreate\b/i.test(content) &&
    (isServerWritePath(hit.fileName) || isMutationHandlerPath(hit.fileName))
  );
}

export function lineNumberOfCreateHandler(content: string): number | undefined {
  const rows = content.split(/\r?\n/).map((row) => row.replace(/^\d+\|/, ""));
  const preferred =
    /\bperform_create\s*\(|\b(?:async\s+)?def\s+create\s*\(|\bclass\s+\w*Create\w*Serializer\b|\bIssueCreateSerializer\b/;
  for (let i = 0; i < rows.length; i++) {
    if (preferred.test(rows[i] ?? "")) {
      return i + 1;
    }
  }
  for (let i = 0; i < rows.length; i++) {
    if (/\bclass\s+\w*ViewSet\b/.test(rows[i] ?? "")) {
      return i + 1;
    }
  }
  return undefined;
}

/**
 * Exact error strings the user pasted — search these before ValidationError /
 * get("field") / bare *_id. Empty when the ask has no long quoted error.
 */
export function rejectQuoteFirstSearchQueries(userMessage: string): string[] {
  if (!isApiRejectAsk(userMessage)) {
    return [];
  }
  const unique: string[] = [];
  for (const quote of askedRejectErrorQuotes(userMessage)) {
    const clipped = clip(quote, MAX_REJECT_SEARCH_CHARS);
    if (!clipped || clipped.length < 12) {
      continue;
    }
    if (unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      continue;
    }
    unique.push(clipped);
  }
  return unique;
}

/**
 * Needle from “Where does this exact string appear: …” (quoted or bare).
 * Prevents latching bare `issue_id` from the pasted error text.
 */
export function extractPastedExactStringNeedle(userMessage: string): string | undefined {
  const text = userMessage.replace(/\s+/g, " ").trim();
  if (!text) {
    return undefined;
  }
  const quoted = askedRejectErrorQuotes(text)[0];
  if (quoted && quoted.length >= 12) {
    return clip(quoted, MAX_REJECT_SEARCH_CHARS);
  }
  const afterLabel = text.match(
    /\b(?:exact\s+string|this\s+exact\s+string|exact\s+error(?:\s+string)?)\b[^:]*:\s*(.+)$/i
  );
  if (afterLabel?.[1]) {
    const phrase = afterLabel[1].trim().replace(/^["'`]+|["'`]+$/g, "");
    if (phrase.length >= 12) {
      return clip(phrase, MAX_REJECT_SEARCH_CHARS);
    }
  }
  // Unquoted long ValidationError-shaped fragment in the sentence.
  const fragment = text.match(
    /\b([A-Z][a-zA-Z]*(?:\s+\w+){2,12}\s+is not valid\b[^"'`]{0,60})/
  );
  if (fragment?.[1] && fragment[1].trim().length >= 16) {
    return clip(fragment[1].trim(), MAX_REJECT_SEARCH_CHARS);
  }
  return undefined;
}

/**
 * Index queries that land on the asked field's ValidationError — not a bare
 * `issue_id` / `parent_id` token (those match converters and OpenAPI first).
 * When the ask quotes an error string, that quote leads the list.
 */
export function apiRejectSearchQueries(userMessage: string): string[] {
  if (!isApiRejectAsk(userMessage)) {
    return [];
  }
  const unique: string[] = [];
  const push = (candidate: string | undefined): void => {
    const clipped = clip(candidate ?? "", MAX_REJECT_SEARCH_CHARS);
    if (!clipped) {
      return;
    }
    if (unique.some((seen) => seen.toLowerCase() === clipped.toLowerCase())) {
      return;
    }
    unique.push(clipped);
  };
  // Quote-first product law — never lead Exact Parent with get("parent").
  for (const quote of rejectQuoteFirstSearchQueries(userMessage)) {
    push(quote);
  }
  const fields = askedRejectFieldTokens(userMessage);
  const jobs = askedRejectJobTokens(userMessage);
  const stems = [...new Set(fields.map((field) => field.replace(/_id$/i, "")))];
  const preferred = ["parent", "assignee", "state", "estimate", "transition"];
  const orderedStems = [
    ...preferred.filter((stem) => stems.includes(stem)),
    ...stems.filter((stem) => !preferred.includes(stem))
  ];
  const hasExactQuote = unique.length > 0;
  for (const job of jobs) {
    push(job);
    for (const stem of orderedStems) {
      if (stem.length >= 3) {
        push(`${job} ${stem}`);
      }
    }
  }
  for (const stem of orderedStems) {
    if (stem.length < 3) {
      continue;
    }
    // Field access — pad after quotes. Skip bare stem / *_id when we already
    // have the Exact message (those flood UI / converters before the raise).
    if (!hasExactQuote) {
      push(`get("${stem}")`);
      push(`get("${stem}_id")`);
      push(`["${stem}"]`);
      push(stem);
      push(`${stem}_id`);
    }
    push(`${stem} is not valid`);
    push(`${stem} is required`);
    push(`not valid ${stem}`);
    push(`invalid ${stem}`);
    push(`ValidationError ${stem}`);
  }
  for (const field of fields) {
    if (/_id$/i.test(field)) {
      push(`not valid ${field}`);
    }
  }
  // Bare ValidationError last — Lightning noise (error_codes.py), never lead.
  if (!hasExactQuote) {
    push("ValidationError");
  }
  return unique;
}

/**
 * Qualifier stems for API-reject hunts. "bad parent issue_id" is about parent,
 * not a generic issue_id token that every issue serializer mentions.
 */
const REJECT_QUALIFIER_STEMS = [
  "parent",
  "assignee",
  "estimate",
  "owner",
  "label",
  "priority",
  "status"
] as const;

function addRejectFieldStem(tokens: Set<string>, raw: string): void {
  let field = raw.toLowerCase();
  if (field.endsWith("_id")) {
    field = field.slice(0, -3);
  } else if (field.length > 4 && /[a-z]id$/.test(field)) {
    field = field.slice(0, -2);
  }
  if (field.length < 3) {
    return;
  }
  tokens.add(field);
  tokens.add(`${field}_id`);
}

/**
 * Field names the user asked the API to reject. Qualifiers win: "parent issue_id"
 * → parent, not issue_id. Bare `*_id` only when no qualifier is present.
 */
export function askedRejectFieldTokens(userMessage: string): string[] {
  const tokens = new Set<string>();
  const text = userMessage.toLowerCase();

  for (const stem of REJECT_QUALIFIER_STEMS) {
    if (new RegExp(`\\b${stem}(?:_id)?\\b`, "i").test(text)) {
      addRejectFieldStem(tokens, stem);
    }
  }

  const bad = text.match(/\bbad\s+([a-z][a-z0-9_]*)\b/);
  if (bad?.[1] && bad[1].length >= 3) {
    addRejectFieldStem(tokens, bad[1]);
  }

  if (/\b(state|transition|backlog)(?:_id)?\b/.test(text)) {
    tokens.add("state");
    tokens.add("state_id");
    tokens.add("transition");
  }

  if (tokens.size === 0) {
    for (const id of allIdentifiers(userMessage)) {
      if (isApiFieldIdToken(id)) {
        addRejectFieldStem(tokens, id);
      }
    }
  }

  return [...tokens].filter((token) => token.length >= 3);
}

/**
 * Workflow the user named (invite vs signup vs checkout). Empty when the ask
 * is only a field. Repo-agnostic nouns — not product paths.
 */
const REJECT_JOB_STEMS = ["invite", "signup", "register", "checkout", "login"] as const;

function compactJobText(text: string): string {
  return text.toLowerCase().replace(/[_-\s]/g, "");
}

export function askedRejectJobTokens(userMessage: string): string[] {
  const compact = compactJobText(userMessage);
  const jobs: string[] = [];
  for (const stem of REJECT_JOB_STEMS) {
    if (compact.includes(stem)) {
      jobs.push(stem);
    }
  }
  const spaced = userMessage.toLowerCase();
  if (/\bsign\s*up\b/.test(spaced) && !jobs.includes("signup")) {
    jobs.push("signup");
  }
  if (/\bsign\s*in\b/.test(spaced) && !jobs.includes("login")) {
    jobs.push("login");
  }
  return jobs;
}

function contentMentionsAskedJob(content: string, fileName: string, jobs: string[]): boolean {
  if (jobs.length === 0) {
    return true;
  }
  const hay = compactJobText(`${fileName}\n${content}`);
  return jobs.some((job) => hay.includes(job));
}

/** Rethrow of a caught error — not the check that rejected the request. */
function isRethrowLine(line: string): boolean {
  return /\b(throw|raise)\s+(error|err|e|ex|exc|exception)\s*;?\s*$/i.test(line.trim());
}

function lineLooksLikeClientValidationReject(line: string): boolean {
  return (
    /\bwriteJson\s*\([^)]*\b(400|422)\b/i.test(line) ||
    /\b(res\.status|abort)\s*\(\s*(400|422)\b/i.test(line) ||
    /\bstatus\s*[:=]\s*(400|422)\b/i.test(line)
  );
}

function lineLooksLikeWriteReject(line: string): boolean {
  const text = line.replace(/^\d+\|/, "");
  if (isRethrowLine(text)) {
    return false;
  }
  if (
    /\b(raise |throw |ValidationError|ValueError|Forbidden|is_valid_transition|invalid.{0,16}transition|validate_state)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return lineLooksLikeClientValidationReject(text);
}

/** Hit body assigns/rejects — not a group enum, seed row, rethrow, or read-only serializer. */
export function contentLooksLikeWriteReject(content: string): boolean {
  return content.split("\n").some((row) => lineLooksLikeWriteReject(row));
}

/**
 * A 401 / unauthorized JSON write — the missing-key (and sibling handler) shape.
 * Repo-agnostic: writeJson/status(401) plus `error: "unauthorized"`.
 */
export function contentLooksLikeUnauthorizedWrite(content: string): boolean {
  return lineNumberOfUnauthorizedWrite(content) !== undefined;
}

export function lineNumberOfUnauthorizedWrite(content: string): number | undefined {
  if (!content.trim()) {
    return undefined;
  }
  const rows = content.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? "";
    const line = row.replace(/^\d+\|/, "");
    if (!lineLooksLikeUnauthorizedWrite(line)) {
      continue;
    }
    const prefixed = /^(\d+)\|/.exec(row);
    if (prefixed) {
      const numbered = Number(prefixed[1]);
      if (Number.isInteger(numbered) && numbered >= 1) {
        return numbered;
      }
    }
    return i + 1;
  }
  return undefined;
}

function lineLooksLikeUnauthorizedWrite(line: string): boolean {
  const text = line.replace(/^\d+\|/, "");
  if (!/\bunauthorized\b/i.test(text) && !/\b401\b/.test(text)) {
    return false;
  }
  return (
    /\bwriteJson\s*\([^)]*\b401\b/i.test(text) ||
    /\b(?:res(?:ponse)?|reply|ctx)\.status\s*\(\s*401\b/i.test(text) ||
    /\bstatus\s*\(\s*401\b/i.test(text) ||
    /\berror\s*:\s*["']unauthorized["']/i.test(text) ||
    /\berror[\s\S]{0,32}["']unauthorized["']/i.test(text) ||
    (/\b401\b/.test(text) && /\bunauthorized\b/i.test(text))
  );
}

/**
 * Keep the unauthorized write in a compacted writer excerpt instead of the file head.
 */
export function excerptUnauthorizedWrite(content: string, maxChars: number): string | undefined {
  if (!content || maxChars < 24) {
    return undefined;
  }
  if (!contentLooksLikeUnauthorizedWrite(content)) {
    return undefined;
  }
  if (content.length <= maxChars) {
    return content;
  }
  const rows = content.split(/\r?\n/);
  let matchAt = -1;
  for (let i = 0; i < rows.length; i++) {
    if (lineLooksLikeUnauthorizedWrite((rows[i] ?? "").replace(/^\d+\|/, ""))) {
      matchAt = i;
      break;
    }
  }
  if (matchAt < 0) {
    return undefined;
  }
  const matchLine = rows[matchAt] ?? "";
  if (matchLine.length >= maxChars) {
    const idx = Math.max(0, matchLine.search(/writeJson|\bunauthorized\b|\b401\b/i));
    return `${matchLine.slice(idx, idx + maxChars).trimEnd()}…`;
  }
  let start = matchAt;
  let end = matchAt;
  let size = matchLine.length;
  while (end < rows.length - 1) {
    const next = (rows[end + 1] ?? "").length + 1;
    if (size + next > maxChars) {
      break;
    }
    end += 1;
    size += next;
  }
  while (start > 0) {
    const prev = (rows[start - 1] ?? "").length + 1;
    if (size + prev > maxChars) {
      break;
    }
    start -= 1;
    size += prev;
  }
  const slice = rows.slice(start, end + 1).join("\n");
  return start > 0 ? `…\n${slice}` : slice;
}

/**
 * Reject that is actually about work-item state — not UUID/choice filter
 * validation that happens to live under apps/api.
 */
export function contentLooksLikeStateTransitionReject(content: string): boolean {
  if (!contentLooksLikeWriteReject(content)) {
    return false;
  }
  return (
    /\b(state_id|is_valid_transition|validate_state)\b/i.test(content) ||
    /invalid.{0,16}transition/i.test(content) ||
    /\bvalid state\b/i.test(content)
  );
}

function validationErrorMessages(content: string): string {
  const chunks: string[] = [];
  const quoted = /ValidationError\(\s*(?:serializers\.)?["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(content)) !== null) {
    chunks.push(match[1] ?? "");
  }
  const dict = /ValidationError\(\s*\{([^}]*)\}/gi;
  while ((match = dict.exec(content)) !== null) {
    chunks.push(match[1] ?? "");
  }
  return chunks.join("\n");
}

function fieldTokenInText(text: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
    return true;
  }
  if (!/_/.test(field)) {
    return false;
  }
  const camel = field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return new RegExp(`\\b${camel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

/** Guard on the asked field — not `email: adminEmail` passed into a callee. */
function contentHasAskedFieldGuard(content: string, fields: string[]): boolean {
  return fields.some((field) => {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A client checking an HTTP response code does not establish a domain-status guard.
    const comparisonValue = field === "status" ? "(?!\\s*[12345]\\d{2}\\b)" : "";
    return (
      new RegExp(`\\.get\\(\\s*['"]${escaped}['"]`, "i").test(content) ||
      new RegExp(`\\[\\s*['"]${escaped}['"]\\s*\\]`, "i").test(content) ||
      new RegExp(`if\\s*\\(\\s*!+\\s*(?:[\\w$]+\\.)*${escaped}\\b`, "i").test(content) ||
      new RegExp(`if\\s*\\(\\s*(?:[\\w$]+\\.)*${escaped}\\b\\s*(?:===|!==|==|!=)(?!=)${comparisonValue}`, "i").test(content) ||
      new RegExp(`if\\s+not\\s+(?:[\\w$]+\\.)*${escaped}\\b`, "i").test(content) ||
      new RegExp(`\\b${escaped}\\s*(?:===|!==|==|!=)\\s*(?:['"]['']|null|undefined|None)`, "i").test(
        content
      )
    );
  });
}

function quotedRejectText(content: string): string {
  const quotes = [...content.matchAll(/["'“”]([^"'“”]{2,})["'“”]/g)].map((match) => match[1] ?? "");
  return `${validationErrorMessages(content)}\n${quotes.join("\n")}`;
}

/**
 * Error strings the user quoted in the ask (straight or curly **double** quotes).
 * Do not treat apostrophes in don't / isn't as quote delimiters — that invented a
 * fake C2 “quote” and outranked ValidationError state (live Fail class).
 * Zoekt often returns only that message line — no `raise` / `ValidationError`.
 */
export function askedRejectErrorQuotes(userMessage: string): string[] {
  const patterns: RegExp[] = [/"([^"]{12,})"/g, /“([^”]{12,})”/g, /«([^»]{12,})»/g];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of userMessage.matchAll(pattern)) {
      const quote = (match[1] ?? "").trim();
      if (quote.length < 12) {
        continue;
      }
      const key = quote.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(quote);
    }
  }
  return out;
}

/** Hit body contains the exact (or near-exact) error string from the ask. */
export function contentIncludesAskedRejectQuote(content: string, userMessage: string): boolean {
  const hay = content.toLowerCase().replace(/\s+/g, " ");
  for (const quote of askedRejectErrorQuotes(userMessage)) {
    const needle = quote.toLowerCase().replace(/\s+/g, " ");
    if (needle.length >= 12 && hay.includes(needle)) {
      return true;
    }
  }
  return false;
}

/**
 * Live Zoekt Fragments[].Match is often only the matched span — e.g. the ask
 * quotes the full Parent message, but the hit is `is not valid issue_id please…`
 * without the word Parent. Treat a substantial overlap as the same evidence.
 */
export function contentOverlapsAskedRejectQuote(content: string, userMessage: string): boolean {
  if (contentIncludesAskedRejectQuote(content, userMessage)) {
    return true;
  }
  const hay = content
    .split("\n")
    .map((row) => row.replace(/^\d+\|/, ""))
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (hay.length < 12) {
    return false;
  }
  for (const quote of askedRejectErrorQuotes(userMessage)) {
    const needle = quote.toLowerCase().replace(/\s+/g, " ").trim();
    if (needle.length < 12) {
      continue;
    }
    // Hit is a span inside the quoted error, or a long prefix of it.
    if (needle.includes(hay)) {
      return true;
    }
    const prefixLen = Math.min(needle.length, Math.max(24, Math.floor(needle.length * 0.6)));
    if (hay.includes(needle.slice(0, prefixLen))) {
      return true;
    }
  }
  return false;
}

/** ±12 lines around each raise/throw so a sibling field's validate() does not count. */
function rejectWindows(content: string): string[] {
  const rows = content.split("\n");
  const windows: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!contentLooksLikeWriteReject(rows[i] ?? "")) {
      continue;
    }
    windows.push(rows.slice(Math.max(0, i - 12), i + 8).join("\n"));
  }
  if (windows.length === 0 && contentLooksLikeWriteReject(content)) {
    windows.push(content);
  }
  return windows;
}

function contentMentionsAskedField(content: string, fields: string[]): boolean {
  if (fields.length === 0) {
    return false;
  }
  const messages = quotedRejectText(content);
  if (fields.some((field) => fieldTokenInText(messages, field))) {
    return true;
  }
  return contentHasAskedFieldGuard(content, fields);
}

/**
 * Zoekt often returns only the API error message (no raise / ValidationError).
 * Match field-shaped error copy on serializer / server-write paths.
 */
function lineLooksLikeApiErrorMessage(line: string): boolean {
  const text = line.replace(/^\d+\|/, "").replace(/^["'`]+|["'`]+$/g, "").trim();
  return (
    /\bnot valid\b/i.test(text) ||
    /\bis required\b/i.test(text) ||
    /\bplease pass a valid\b/i.test(text) ||
    /\bmust belong\b/i.test(text) ||
    /\bdoes not (?:exist|belong)\b/i.test(text) ||
    /\bisn'?t in\b/i.test(text) ||
    (/\binvalid\b/i.test(text) && /\b(id|issue|state|parent|assignee|field)\b/i.test(text))
  );
}

function pathAllowsFieldShapedReject(fileName: string): boolean {
  if (!fileName.trim()) {
    // Unknown path — allow when message + field match (snippet-only attach).
    return true;
  }
  const n = normalizePath(fileName);
  if (
    isClientUiPath(fileName) ||
    isSeedOrFixturePath(fileName) ||
    isSchemaCatalogPath(fileName) ||
    isDocOrSpecPath(fileName) ||
    isQueryFilterPath(fileName) ||
    isLocaleCatalogPath(fileName) ||
    isHtmlTemplatePath(fileName)
  ) {
    return false;
  }
  return (
    isServerWritePath(fileName) ||
    isMutationHandlerPath(fileName) ||
    /(^|\/)serializers?\//.test(n) ||
    /\.serializer\.(py|ts|go|rb)$/.test(n)
  );
}

/**
 * Raise-less Zoekt line that names the asked field and looks like API error copy.
 * Unquoted paraphrase asks (COPILOT_T2_ASK) need this — quote recovery alone is not enough.
 */
export function contentLooksLikeFieldShapedApiError(
  content: string,
  userMessage: string,
  fileName = ""
): boolean {
  if (!pathAllowsFieldShapedReject(fileName)) {
    return false;
  }
  const fields = askedRejectFieldTokens(userMessage);
  if (fields.length === 0) {
    return false;
  }
  return content.split(/\n/).some((row) => {
    const text = row.replace(/^\d+\|/, "");
    if (!lineLooksLikeApiErrorMessage(text)) {
      return false;
    }
    return fields.some((field) => fieldTokenInText(text, field));
  });
}

/**
 * Serializer/view reject for the field the user asked about — parent, state,
 * assignee, or any `*_id`. Generic filter ValidationError does not count.
 *
 * Also Pass when the hit is only the quoted API error string from the ask
 * (live Zoekt often omits `raise` / `ValidationError` on that line), or a
 * field-shaped message-only line on a serializer/server-write path.
 */
export function contentLooksLikeAskedFieldReject(
  content: string,
  userMessage: string,
  fileName = ""
): boolean {
  // A status guard in a neighboring operation is not the signing rejection.
  // Match the operation's path/declaration, rather than incidental "signed"
  // text in a PDF-download message or an imported signature type.
  if (askRejectJobTokens(userMessage).includes("sign") &&
      !rejectEvidenceMatchesAskJob([{ path: fileName, content }], userMessage)) {
    return false;
  }
  const jobs = askedRejectJobTokens(userMessage);
  if (!contentMentionsAskedJob(content, fileName, jobs)) {
    return false;
  }
  const fields = askedRejectFieldTokens(userMessage);
  const requiredStatus = /\bmust\s+be\s+([a-z_]+)\s+(?:for|before|to)\b/i.exec(userMessage)?.[1];
  if (fields.includes("status") && requiredStatus &&
      !rejectWindows(content).some((window) => contentHasAskedFieldGuard(window, ["status"]) &&
        fieldTokenInText(window, requiredStatus))) {
    return false;
  }
  if (/\btransition\b/i.test(userMessage) && fields.includes("state") &&
      !contentHasAskedFieldGuard(content, ["state", "state_id"]) &&
      !contentLooksLikeStateTransitionReject(content)) {
    return false;
  }
  // Exact error copy from the ask — attach even without raise/ValidationError keywords.
  if (contentIncludesAskedRejectQuote(content, userMessage)) {
    if (fields.length === 0) {
      return true;
    }
    if (contentMentionsAskedField(content, fields)) {
      return true;
    }
    // Ask quote / Zoekt message line names the field ("Parent is not valid…").
    if (
      askedRejectErrorQuotes(userMessage).some((quote) =>
        fields.some((field) => fieldTokenInText(quote, field))
      )
    ) {
      return true;
    }
    return fields.some((field) => fieldTokenInText(content, field));
  }
  // Zoekt Match span is a substring of the asked quote (Parent omitted from fragment).
  if (contentOverlapsAskedRejectQuote(content, userMessage)) {
    if (
      fields.length === 0 ||
      askedRejectErrorQuotes(userMessage).some((quote) =>
        fields.some((field) => fieldTokenInText(quote, field))
      ) ||
      fields.some((field) => fieldTokenInText(content, field))
    ) {
      return pathAllowsFieldShapedReject(fileName);
    }
  }
  // Unquoted ask + message-only Zoekt (no raise keywords).
  if (contentLooksLikeFieldShapedApiError(content, userMessage, fileName)) {
    return true;
  }
  if (!contentLooksLikeWriteReject(content)) {
    return false;
  }
  if (fields.length === 0) {
    return contentLooksLikeStateTransitionReject(content);
  }
  if (rejectWindows(content).some((window) => contentMentionsAskedField(window, fields))) {
    return true;
  }
  if (fields.some((field) => field === "state" || field === "transition" || field === "state_id")) {
    return contentLooksLikeStateTransitionReject(content);
  }
  return false;
}

/**
 * A ValidationError that is clearly about a different payload field than the
 * one the user asked about (comment_html vs parent). Generic write/reject
 * snippets without a sibling field stay eligible.
 */
export function verifiedFieldHandlingEvidence(
  file: FieldHandlingSource,
  userMessage: string
): VerifiedFieldHandling | undefined {
  if (!isApiRejectAsk(userMessage) || !pathAllowsFieldShapedReject(file.path) || isTestPath(file.path)) {
    return undefined;
  }
  if (!contentMentionsAskedJob(file.content, file.path, askedRejectJobTokens(userMessage)) ||
      contentLooksLikeAskedFieldReject(file.content, userMessage, file.path)) {
    return undefined;
  }
  return classifyFieldHandlingEvidence(file, askedRejectFieldTokens(userMessage));
}


export function contentLooksLikeWrongFieldReject(
  content: string,
  userMessage: string
): boolean {
  if (!contentLooksLikeWriteReject(content)) {
    return false;
  }
  if (contentLooksLikeAskedFieldReject(content, userMessage)) {
    return false;
  }
  const asked = new Set(askedRejectFieldTokens(userMessage).map((field) => field.toLowerCase()));
  if (asked.size === 0) {
    return false;
  }
  const haystack = content.toLowerCase();
  const compact = haystack.replace(/_/g, "");
  for (const stem of REJECT_QUALIFIER_STEMS) {
    if (asked.has(stem) || asked.has(`${stem}_id`)) {
      continue;
    }
    if (new RegExp(`\\b${stem}\\b`).test(haystack) || compact.includes(`${stem}id`)) {
      return true;
    }
  }
  if (!asked.has("comment") && !asked.has("comment_html") && compact.includes("commenthtml")) {
    return true;
  }
  return false;
}

/** Read-side serializer / seed snippet — represents state, does not reject a transition. */
export function contentLooksLikeReadOnlyState(content: string): boolean {
  if (contentLooksLikeWriteReject(content)) {
    return false;
  }
  return /read_only\s*=\s*True/.test(content) || /"state_id"\s*:/.test(content);
}

export function isActionableApiRejectHit(hit: {
  fileName: string;
  content?: string;
}): boolean {
  const content = hit.content ?? "";
  if (
    isSeedOrFixturePath(hit.fileName) ||
    isSchemaCatalogPath(hit.fileName) ||
    isClientUiPath(hit.fileName) ||
    isDocOrSpecPath(hit.fileName) ||
    isQueryFilterPath(hit.fileName) ||
    isApiRejectNoisePath(hit.fileName)
  ) {
    return false;
  }
  if (contentLooksLikeWriteReject(content)) {
    return true;
  }
  const path = normalizePath(hit.fileName);
  // Open serializer files even when the hit is a read-only class — validate()
  // in the same file is the reject. Seeds/clients stay skipped.
  if (/(^|\/)serializers?\//.test(path) || /\.serializer\.(py|ts|go|rb)$/.test(path)) {
    return true;
  }
  if (contentLooksLikeReadOnlyState(content)) {
    return false;
  }
  // Views/services without a reject snippet are permission checks — not the write.
  if (isMutationHandlerPath(hit.fileName)) {
    return false;
  }
  // Server write trees (e.g. work_item_state.py) stay candidates so the hunt can
  // open and jump. Exclude utils/helpers — those are grouping/filter helpers.
  if (isServerWritePath(hit.fileName) && !/(^|\/)(utils|helpers)\//.test(path)) {
    return true;
  }
  return false;
}

/**
 * preferredHits fail-open pool for reject: actionable ∪ asked-field ∪ server-write.
 * Shared by decorateToolResult, seed, and lastChance.
 */
export function isFailOpenRejectHit(
  hit: { fileName: string; content?: string },
  userMessage: string
): boolean {
  if (!hit.fileName || shouldSkipEvidencePath(hit.fileName, userMessage)) {
    return false;
  }
  if (isActionableApiRejectHit(hit)) {
    return true;
  }
  if (isServerWritePath(hit.fileName)) {
    return true;
  }
  return contentLooksLikeAskedFieldReject(hit.content ?? "", userMessage, hit.fileName);
}

/** Keep only file bodies that actually reject/write — drop OpenAPI and read-only classes. */
export function filterWriteRejectFiles<T extends { path?: string; content?: string }>(
  files: T[],
  userMessage: string
): T[] {
  return files.filter((file) => {
    const path = file.path ?? "";
    if (path && shouldSkipEvidencePath(path, userMessage)) {
      return false;
    }
    return contentLooksLikeAskedFieldReject(file.content ?? "", userMessage, path);
  });
}

export function lineNumberOfWriteReject(
  content: string,
  userMessage?: string,
  fileName?: string
): number | undefined {
  const rows = content.split("\n").map((row) => row.replace(/^\d+\|/, ""));
  const fields = userMessage ? askedRejectFieldTokens(userMessage) : [];
  // Prefer the rejection that names the asked field itself. A nearby window
  // can overlap the next field's guard in multi-field validators.
  if (fields.length > 0) {
    const direct = rows.findIndex((row) =>
      contentLooksLikeWriteReject(row) && contentMentionsAskedField(row, fields) &&
      (!userMessage || contentMentionsAskedJob(row, fileName ?? "", askedRejectJobTokens(userMessage)))
    );
    if (direct >= 0) return direct + 1;
  }
  for (let i = 0; i < rows.length; i++) {
    if (!contentLooksLikeWriteReject(rows[i])) {
      continue;
    }
    const nearby = rows.slice(Math.max(0, i - 12), i + 8).join("\n");
    if (userMessage && fields.length > 0) {
      if (contentLooksLikeAskedFieldReject(nearby, userMessage, fileName ?? "")) {
        return i + 1;
      }
      continue;
    }
    if (
      /\b(state_id|is_valid_transition|validate_state)\b/i.test(nearby) ||
      /invalid.{0,16}transition/i.test(nearby) ||
      /valid state/i.test(nearby)
    ) {
      return i + 1;
    }
  }
  return undefined;
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
  if (userMessage && isParserLocateAsk(userMessage) &&
      contentLooksLikeRequestedParser((hit as { content?: string }).content ?? "", userMessage)) {
    rank += 24;
  }
  for (const term of terms) {
    if (path.includes(term)) {
      rank += 3;
    }
  }
  // Exact path token for the symbol (require_auth.py) beats a weak "auth"
  // substring match — and must not fire on require_authentication filenames.
  if (userMessage && queryNamesSourceFile(hit.fileName, userMessage)) {
    rank += 22;
  }
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
  if (isLocaleCatalogPath(hit.fileName) && !(userMessage && userAskedAboutLocales(userMessage))) {
    rank -= 18;
  }
  if (userMessage && isApiRejectAsk(userMessage)) {
    const snippet = (hit as { content?: string }).content ?? "";
    if (contentLooksLikeAskedFieldReject(snippet, userMessage, hit.fileName)) {
      rank += 24;
    } else if (contentLooksLikeWriteReject(snippet)) {
      rank -= 12;
    }
  }
  if (userMessage && isApiRejectAsk(userMessage) && isServerWritePath(hit.fileName)) {
    rank += 18;
    const basename = path.split("/").pop() ?? "";
    for (const operation of askRejectJobTokens(userMessage)) {
      if (basename.includes(operation)) rank += 12;
      if (basename.split(/[_.-]/)[0] === operation) rank += 10;
    }
  }
  if (userMessage && isApiRejectAsk(userMessage) && isMutationHandlerPath(hit.fileName)) {
    rank += 12;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isSchemaCatalogPath(hit.fileName)) {
    rank -= 16;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isClientUiPath(hit.fileName)) {
    rank -= 16;
  }
  if (userMessage && isApiRejectAsk(userMessage) && askRejectJobTokens(userMessage).includes("sign") &&
      /^(?:sign|log)[-_]?(?:in|out|up)(?:\.|$)/.test(path.split("/").pop() ?? "")) {
    // Document signing is a distinct operation from authentication entry/exit.
    rank -= 24;
  }
  if (userMessage && isApiRejectAsk(userMessage) && isApiRejectNoisePath(hit.fileName)) {
    rank -= 20;
  }
  if (userMessage && isRequestAuthLocateAsk(userMessage)) {
    if (isRequestAuthEnforcementHit(hit)) {
      rank += 22;
    }
    if (pathLooksLikeConfigCatalog(hit.fileName)) {
      rank -= 20;
    }
    if (contentLooksLikeSecondarySecretGate((hit as { content?: string }).content ?? "")) {
      rank -= 18;
    }
  }
  if (userMessage && isBackendStateLocateAsk(userMessage)) {
    // A definition question asks for the declared type, not its API wrappers.
    if (isSchemaCatalogPath(hit.fileName)) {
      rank += 18;
    }
    if (isBackendStateDefinitionHit(hit)) {
      rank += 22;
    }
    if (isNonStateIssueSerializerHit(hit) || isUnrelatedSerializerForStateLocate(hit)) {
      rank -= 18;
    }
    if (isClientUiPath(hit.fileName)) {
      rank -= 20;
    } else if (
      isServerWritePath(hit.fileName) ||
      isSchemaCatalogPath(hit.fileName) ||
      isMutationHandlerPath(hit.fileName)
    ) {
      rank += 12;
    }
  }
  if (userMessage && isCreateLocateAsk(userMessage)) {
    if (isCreateDefinitionHit(hit)) {
      rank += 24;
    }
    if (isClientUiPath(hit.fileName) || isTestPath(hit.fileName)) {
      rank -= 16;
    } else if (isServerWritePath(hit.fileName) || isMutationHandlerPath(hit.fileName)) {
      rank += 12;
    }
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
  return allIdentifiers(text).find((id) => !isStemOfNamedSourceFile(id, text));
}

function allIdentifiers(text: string): string[] {
  return [...text.matchAll(IDENTIFIER)]
    .map((m) => m[0])
    .filter((id) => !STOP.has(id.toLowerCase()));
}

function isSearchablePascal(word: string, text: string): boolean {
  if (DENIED_PASCAL.test(word) || PROSE_PASCAL.has(word.toLowerCase())) {
    return false;
  }
  if (/^(where|what|which|how|find|who)\b/i.test(text.trim())) {
    return true;
  }
  return !new RegExp(`^${word}\\b`).test(text.trim());
}

/**
 * English the user typed mapped to words repos actually use.
 * "work item" / backlog / transition → issue / state / workflow.
 * Reject/validation slogans only when this is an on-call API-reject ask —
 * calm “where do work-item states live?” must not hunt ValidationError.
 * Repo-agnostic — no product or folder names.
 */
export function proseLocateSearchAliases(userMessage: string): string[] {
  const text = userMessage.toLowerCase();
  const hasWorkItem = /\bwork[-\s]?items?\b/.test(text);
  const hasTransition = /\btransitions?\b/.test(text);
  const hasBacklog = /\bbacklog\b/.test(text);
  const aliases: string[] = [];
  if (isApiRejectAsk(userMessage)) {
    aliases.push("ValidationError");
    const fields = askedRejectFieldTokens(userMessage);
    if (fields.some((field) => field === "parent" || field === "parent_id")) {
      aliases.push("invalid parent");
      aliases.push("parent_id");
    }
    for (const field of fields) {
      if (/_id$/.test(field)) {
        aliases.push(field);
      }
    }
    if (hasWorkItem || hasTransition) {
      aliases.push("validate_state");
      aliases.push("invalid state");
      aliases.push("state transition");
      aliases.push("state validation");
      aliases.push("state_id");
    }
    if (hasWorkItem || hasBacklog) {
      aliases.push("issue state");
    }
    aliases.push("ValidationError");
    return aliases;
  }
  // Calm locate: map product English → repo words, not reject slogans.
  if (isCreateLocateAsk(userMessage)) {
    aliases.push("IssueCreateSerializer");
    aliases.push("perform_create");
    aliases.push("IssueViewSet");
    aliases.push("create_issue");
  } else if (isBackendStateLocateAsk(userMessage)) {
    // Do not lead with bare "issue" — that floods seed/issue rows before State.
    aliases.push("class State");
    aliases.push("StateSerializer");
    aliases.push("state model");
    aliases.push("issue state");
  } else if (hasWorkItem || hasBacklog) {
    aliases.push("issue state");
    aliases.push("issue");
  }
  if (hasTransition) {
    aliases.push("state transition");
  }
  if (isRequestAuthLocateAsk(userMessage) || /\bauthenticat/i.test(text) || /\bapi\s*key\b/i.test(text)) {
    aliases.push("authentication");
    aliases.push("API key");
    aliases.push("api_authentication");
    aliases.push("APIKeyAuthentication");
  }
  return aliases;
}

/** Noun phrase after "where is / where do we parse" — not the complaint subject. */
function locateObjectPhrase(text: string): string | undefined {
  const match = text.match(
    /\bwhere\s+(?:is|are|do\s+we|does)\s+(?:(?:we\s+)?(?:parse|find|write|store|define|enforce|read)\s+)?(?:(?:the|a|an)\s+)?(.+?)(?:\?|,|\s+and\s+what|\s+and\s+how|$)/i
  );
  if (!match?.[1]) {
    return undefined;
  }
  const cleaned = match[1]
    .replace(/\b(defined|written|enforced|in this repo|in the codebase)\b.*$/i, "")
    .trim();
  const tokens = significantTokens(cleaned).filter((token) => !isJunkSearchToken(token));
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.slice(0, 4).join(" ");
}

function isJunkSearchToken(token: string): boolean {
  const normalized = token.toLowerCase().replace(/[./]+$/g, "");
  return normalized.length < 3 || JUNK_SEARCH_TOKEN.has(normalized);
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

function clip(text: string, maxChars = MAX_SEARCH_CHARS): string {
  const t = text.trim();
  return t.length > maxChars ? `${t.slice(0, maxChars).trim()}` : t;
}

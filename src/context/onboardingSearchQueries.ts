/**
 * Understand Repo / Gaps topic queries — not agent-hunt shortening.
 * Hunt still uses extractAgentSearchQuery. These products search the user's topics.
 */

import { isTestPath } from "../indexing/evidencePathNoise";
import { focusQueryForRetrieval } from "./userFocusQuery";

const MAX_TOPIC_QUERIES = 4;
/** Cap parallel index searches (soft gather budget). */
export const MAX_TOPIC_SEARCH_QUERIES = 3;

const NEWCOMER_PREFIX =
  /\bi'?m new to this (service|repo|repository|codebase|app|application)\b[^.?!]*[.?!]?\s*/gi;
/** Bare "I'm new" with no object — still framing, and it splits into a junk topic. */
const NEWCOMER_BARE = /\bi'?m\s+new\b(?!\s+to\b)/gi;
const ON_CALL_PREFIX = /\bi'?m on-call for(?:\s+this service)?\b[^.?!]*[.?!]?\s*/gi;
const NOT_CLONED = /\bi don'?t have (it|this) cloned\b[^.?!]*[.?!]?\s*/gi;
const WITHOUT_CLONING = /\bwithout cloning\b[^.?!]*[.?!]?\s*/gi;
const THIS_SERVICE = /\bthis service\b/gi;
const FILES_TO_READ =
  /,?\s*(?:and\s+)?what are the \d+ files?(?: I should read first| to read first)?\??/gi;
const WEAK_QUERY =
  /^(this service|the service|focus|what|which|how|where|why|service|the repo|the repository|i'?m on-call for|on-call for)$/i;

/**
 * True when an index query is framing noise (hunt shortening of onboarding/Gaps asks).
 * Never search Zoekt for `"this service"` or `"Focus"` alone.
 */
export function isWeakIndexQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length < 3) {
    return true;
  }
  return WEAK_QUERY.test(trimmed);
}

function stripOnboardingFiller(text: string): string {
  return text
    .replace(NEWCOMER_PREFIX, " ")
    .replace(NEWCOMER_BARE, " ")
    .replace(ON_CALL_PREFIX, " ")
    .replace(NOT_CLONED, " ")
    .replace(WITHOUT_CLONING, " ")
    .replace(THIS_SERVICE, " ")
    .replace(FILES_TO_READ, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Question words and articles stack up: "where does the …" leaves three to peel. */
const TOPIC_LEAD = /^(?:where|what|which|who|how|why|does|do|did|is|are|was|were|the|a|an)\s+/i;

function cleanTopic(part: string): string {
  let out = part.trim();
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out.replace(TOPIC_LEAD, "");
  }
  return out
    // "a message get sent" — the auxiliary is not part of the topic.
    .replace(/\b(?:get|gets|getting|got)\s+(?=\w)/gi, "")
    .replace(/\s+(live|flow|work|go|start)\??$/i, "")
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a new-hire / onboarding ask into 2–4 index topic queries.
 * Pass: E1 ask → topics include auth and work-items/states — not `"this service"`.
 */
export function extractOnboardingTopicQueries(focus: string | undefined): string[] {
  const gather = focusQueryForRetrieval(focus);
  if (!gather) {
    return [];
  }
  const stripped = stripOnboardingFiller(gather);
  const source = stripped || gather;
  const parts = source
    .split(/\s*(?:,|;|\bwhere does\b|\bhow do(?:es)?\b|\band\b)\s*/i)
    .map(cleanTopic)
    .filter((part) => part.length >= 3 && !isWeakIndexQuery(part));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(part);
    if (unique.length >= MAX_TOPIC_QUERIES) {
      break;
    }
  }
  if (unique.length === 0 && stripped.length >= 8 && !isWeakIndexQuery(stripped)) {
    return [stripped.slice(0, 64)];
  }
  return unique;
}

/**
 * Files are named for the action, not the tense the user typed. "where does a
 * message get sent" must reach `sendMessage` / `messageHandler`, so the index
 * gets the stem alongside the user's wording.
 */
const ACTION_STEMS: Array<[RegExp, string]> = [
  [/\b(?:sent|sends|sending)\b/, "send"],
  [/\b(?:handled|handles|handling)\b/, "handler"],
  [/\b(?:received|receives|receiving)\b/, "receive"],
  [/\b(?:dispatched|dispatches|dispatching)\b/, "dispatch"],
  [/\b(?:submitted|submits|submitting)\b/, "submit"],
  [/\b(?:processed|processes|processing)\b/, "process"],
  [/\b(?:routed|routes|routing)\b/, "route"],
  [/\b(?:stored|stores|storing|saved|saves|saving|persisted)\b/, "store"]
];

function expandOnboardingTopic(topic: string): string[] {
  const lower = topic.toLowerCase();
  const extra: string[] = [];
  if (/\bauth\b/.test(lower) && !/authentication/.test(lower)) {
    extra.push("authentication");
  }
  if (/work items?/.test(lower)) {
    extra.push("issue");
  }
  if (/\bstates\b/.test(lower) && !/\bstate\b/.test(lower)) {
    extra.push("state");
  }
  if (
    /\bapi\b/.test(lower) &&
    /\b(create|creates|creating|write|writes|reject|rejects|invalid)\b/.test(lower)
  ) {
    extra.push("serializer");
    extra.push("views");
    if (/\bissues?\b/.test(lower)) {
      extra.push("issue");
    }
  }
  for (const [pattern, stem] of ACTION_STEMS) {
    if (pattern.test(lower) && !lower.includes(stem)) {
      extra.push(stem);
    }
  }
  for (const camel of expandBehaviouralIndexQueries(topic)) {
    extra.push(camel);
  }
  return extra;
}

/** Queries actually sent to the index (cap 3). Auth → authentication, not “API auth”. */
export function onboardingIndexQueries(focus: string | undefined): string[] {
  const topics = extractOnboardingTopicQueries(focus);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const term = raw.trim();
    if (!term || isWeakIndexQuery(term)) {
      return;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(term);
  };
  for (const topic of topics) {
    for (const expanded of expandOnboardingTopic(topic)) {
      push(expanded);
    }
  }
  for (const topic of topics) {
    push(topic);
  }
  return out.slice(0, MAX_TOPIC_SEARCH_QUERIES);
}

function normalizeOnboardingPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
}

/**
 * Seed data, OpenAPI specs, locale catalogs, tests, and migrations are real
 * files — they are not where auth lives or how work items flow.
 * Repo-agnostic path shapes only. If the user asked for that kind of file, keep it.
 */
export function isOnboardingNoisePath(path: string, query = ""): boolean {
  const n = normalizeOnboardingPath(path);
  const q = query.toLowerCase();
  const askedOpenApi = /openapi|swagger/.test(q);
  const askedTests = /\btests?\b/.test(q);
  const askedMigrations = /\bmigrations?\b/.test(q);
  return (
    /(^|\/)(seeds?|fixtures?|factories|locales?|i18n|translations?|l10n)\//.test(n) ||
    /(^|\/)[^/]*seed[^/]*$/.test(n) ||
    (!askedOpenApi && /openapi|swagger/.test(n)) ||
    (!askedTests && isTestPath(n)) ||
    (!askedMigrations && /(^|\/)migrations?\//.test(n))
  );
}

type PathIdentityKind = "stem" | "snake" | "segment" | "none";

const IDENTITY_RANK: Record<PathIdentityKind, number> = {
  stem: 3,
  snake: 2,
  segment: 1,
  none: 0
};

function pathBasename(path: string): string {
  const n = normalizeOnboardingPath(path);
  const parts = n.split("/");
  return parts[parts.length - 1] ?? n;
}

function filenameStem(path: string): string {
  const base = pathBasename(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function titleCaseToken(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function isActionTopicToken(token: string): boolean {
  const lower = token.toLowerCase();
  return ACTION_STEMS.some(([pattern, stem]) => pattern.test(lower) || stem === lower);
}

/**
 * "chat message sent" must reach `handleChatSend`, not only the word "send"
 * (which ranks `types.ts` via ChatMessage). CamelCase keys are repo-agnostic.
 */
export function expandBehaviouralIndexQueries(topic: string): string[] {
  const lower = topic.toLowerCase();
  const nouns = queryTopicTokens(topic).filter((token) => !isActionTopicToken(token));
  if (nouns.length === 0) {
    return [];
  }
  const extra: string[] = [];
  const seen = new Set<string>();
  const push = (term: string): void => {
    const key = term.toLowerCase();
    if (!term || seen.has(key)) {
      return;
    }
    seen.add(key);
    extra.push(term);
  };
  for (const [pattern, stem] of ACTION_STEMS) {
    if (!pattern.test(lower) && !lower.includes(stem)) {
      continue;
    }
    for (const noun of nouns) {
      push(`handle${titleCaseToken(noun)}`);
    }
    for (const noun of nouns) {
      push(`${stem}${titleCaseToken(noun)}`);
    }
  }
  return extra;
}

function queryTopicTokens(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(/\s+/)) {
    const token = raw.replace(/[^a-z0-9]+/g, "");
    if ((token.length < 4 && !/^(api|db|ui)$/.test(token)) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    out.push(token);
  }
  return out;
}

function topicIdentityForms(topic: string): string[] {
  const tokens = queryTopicTokens(topic);
  const fallback = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  const keys = tokens.length > 0 ? tokens : fallback;
  const forms = new Set<string>();
  for (const key of keys) {
    forms.add(key);
    if (key.endsWith("s") && !key.endsWith("ss") && key.length > 4) {
      forms.add(key.slice(0, -1));
    }
  }
  return [...forms];
}

/**
 * How this path names a topic — not "letters appear somewhere."
 * stem: state.py. snake: api_authentication.py. segment: views/issue/archive.py.
 * Hyphen compounds (empty-state.tsx) are not identity.
 */
function pathIdentityForTopic(path: string, topic: string): PathIdentityKind {
  const n = normalizeOnboardingPath(path);
  const stem = filenameStem(n);
  const dirs = n.split("/").slice(0, -1);
  let best: PathIdentityKind = "none";
  for (const form of topicIdentityForms(topic)) {
    if (stem === form) {
      return "stem";
    }
    const snakeParts = stem.split("_").filter(Boolean);
    if (snakeParts.includes(form)) {
      best = "snake";
    }
    if (dirs.some((dir) => dir === form || dir === `${form}s`) && IDENTITY_RANK[best] < IDENTITY_RANK.segment) {
      best = "segment";
    }
  }
  return best;
}

function bestIdentityForQuery(path: string, query: string): PathIdentityKind {
  let best: PathIdentityKind = "none";
  for (const topic of queryTopicTokens(query)) {
    const kind = pathIdentityForTopic(path, topic);
    if (IDENTITY_RANK[kind] > IDENTITY_RANK[best]) {
      best = kind;
    }
  }
  return best;
}

/** Filename/type identity — empty-state.tsx does not match topic "state". */
export function pathMatchesOnboardingTopic(path: string, topic: string): boolean {
  return pathIdentityForTopic(path, topic) !== "none";
}

function pathCoversOnboardingTopic(path: string, topic: string): boolean {
  const kind = pathIdentityForTopic(path, topic);
  return kind === "stem" || kind === "snake";
}

function dominantTopic(path: string, topics: string[]): string {
  let best = "_other";
  let bestRank = 0;
  for (const topic of topics) {
    const rank = IDENTITY_RANK[pathIdentityForTopic(path, topic)];
    if (rank > bestRank) {
      bestRank = rank;
      best = topic;
    }
  }
  return best;
}

/**
 * Declares shapes, does not run behaviour: `types.ts`, `*.d.ts`, `interfaces/`.
 * Real files a new hire may need — just never the answer to "where does X happen".
 */
export function isTypeDeclarationPath(path: string): boolean {
  const n = normalizeOnboardingPath(path);
  return (
    /\.d\.ts$/.test(n) ||
    /^(?:types?|interfaces?|enums?|constants?|typings?)$/.test(filenameStem(n)) ||
    /(^|\/)(?:types?|interfaces?|typings?)\//.test(n)
  );
}

/** The ask is about code that runs — "where does a chat message get sent". */
const BEHAVIOURAL_ASK =
  /\b(?:send|sends|sent|sending|dispatch|dispatches|dispatched|dispatching|handle|handles|handled|handling|handler|handlers|receive|receives|received|receiving|process|processes|processed|processing|route|routes|routed|routing|submit|submits|submitted|submitting|store|stores|stored|storing|save|saves|saved|saving|call|calls|called|trigger|triggers|triggered|invoke|invokes|invoked|flow|flows)\b/i;

/** The user asked about the shapes themselves, so declarations are the answer. */
const DECLARATION_ASK = /\b(?:types?|interfaces?|enums?|schemas?|typings?|contracts?)\b/i;

/**
 * `src/chat/types.ts` defines a ChatMessage; it is not where a chat message is
 * sent. Declarations stay eligible as context — they just never lead a
 * behavioural answer, which is how types.ts came to be named as the send path.
 */
export function isDemotedDeclarationPath(path: string, query: string): boolean {
  return isTypeDeclarationPath(path) && BEHAVIOURAL_ASK.test(query) && !DECLARATION_ASK.test(query);
}

/** Higher is better for a new-hire first-files set. */
export function onboardingPathScore(path: string, query: string): number {
  const n = normalizeOnboardingPath(path);
  const q = query.toLowerCase();
  let score = 0;
  if (isOnboardingNoisePath(n, q)) {
    score -= 80;
  }
  const identity = bestIdentityForQuery(n, q);
  if (identity === "stem") {
    score += 100;
  } else if (identity === "snake") {
    score += 80;
  } else if (identity === "segment") {
    score += 40;
  }
  if (/(^|\/)(middleware|models|db)\//.test(n)) {
    score += 30;
  } else if (/(^|\/)(views|serializers|handlers|controllers|viewsets)\//.test(n)) {
    score += 10;
  }
  if (/\bapi\b/.test(q) && /(^|\/)(api|serializers?|views|handlers|controllers|viewsets)\//.test(n)) {
    score += 50;
  }
  if (/(^|\/)components\//.test(n)) {
    score -= 20;
  }
  if (/\bapi\b/.test(q) && /(^|\/)(components|hooks|store|modal|widgets)\//.test(n)) {
    score -= 40;
  }
  if (/\bapi\b/.test(q) && /(^|\/)apps\/web\//.test(n)) {
    score -= 30;
  }
  if (/openapi|swagger/.test(n) && !/openapi|swagger/.test(q)) {
    score -= 50;
  }
  return score;
}

/**
 * Same basename in the same layer (two middleware copies) collapses.
 * Same basename in different layers (serializers/issue.py vs views/issue.py) does not.
 */
function onboardingLayerDedupeKey(path: string): string {
  const n = normalizeOnboardingPath(path);
  const base = pathBasename(n);
  const layer = n.match(
    /(^|\/)(serializers?|views|handlers|controllers|viewsets|models|middleware|components|hooks|store|widgets|db)(\/|$)/
  );
  return `${layer?.[2] ?? "other"}:${base}`;
}

function compareOnboardingPaths(a: string, b: string, query: string): number {
  const declarationDelta =
    Number(isDemotedDeclarationPath(a, query)) - Number(isDemotedDeclarationPath(b, query));
  if (declarationDelta !== 0) {
    return declarationDelta;
  }
  const scoreDelta = onboardingPathScore(b, query) - onboardingPathScore(a, query);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const identityDelta =
    IDENTITY_RANK[bestIdentityForQuery(b, query)] - IDENTITY_RANK[bestIdentityForQuery(a, query)];
  if (identityDelta !== 0) {
    return identityDelta;
  }
  return filenameStem(a).length - filenameStem(b).length;
}

/**
 * Prefer middleware/models/views over OpenAPI, seed JSON, i18n, tests, and migrations.
 * Spread first-files across query topics so auth does not fill every slot.
 * Fail-open: if every path is noise, keep the original order.
 */
export function selectOnboardingEvidencePaths(paths: string[], query: string, max = 5): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const key = normalizeOnboardingPath(path);
    if (!path.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(path);
  }
  const scored = unique
    .map((path) => ({ path, score: onboardingPathScore(path, query) }))
    .sort((a, b) => compareOnboardingPaths(a.path, b.path, query));
  const domain = scored.filter(
    (entry) => entry.score > 0 && !isOnboardingNoisePath(entry.path, query)
  );
  if (domain.length === 0) {
    // Search order is test-heavy. Prefer any implementation file even at score 0.
    const nonNoise = unique.filter((path) => !isOnboardingNoisePath(path, query));
    return (nonNoise.length > 0 ? nonNoise : unique).slice(0, max);
  }

  const byLayer = new Map<string, (typeof domain)[number]>();
  for (const entry of domain) {
    const key = onboardingLayerDedupeKey(entry.path);
    const existing = byLayer.get(key);
    if (!existing || compareOnboardingPaths(entry.path, existing.path, query) < 0) {
      byLayer.set(key, entry);
    }
  }
  const deduped = [...byLayer.values()].sort((a, b) => compareOnboardingPaths(a.path, b.path, query));

  const topics = queryTopicTokens(query);
  if (topics.length < 2) {
    return deduped.slice(0, max).map((entry) => entry.path);
  }

  const buckets = new Map<string, Array<(typeof deduped)[number]>>();
  for (const entry of deduped) {
    const topic = dominantTopic(entry.path, topics);
    const bucket = buckets.get(topic) ?? [];
    bucket.push(entry);
    buckets.set(topic, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => compareOnboardingPaths(a.path, b.path, query));
  }

  const out: string[] = [];
  const used = new Set<string>();
  const strongTopics = new Set<string>();
  const order = [...topics, "_other"];
  let added = true;
  while (out.length < max && added) {
    added = false;
    for (const topic of order) {
      const bucket = buckets.get(topic);
      while (bucket?.length) {
        const next = bucket.shift();
        if (!next) {
          break;
        }
        const key = normalizeOnboardingPath(next.path);
        if (used.has(key)) {
          continue;
        }
        if (topic !== "_other") {
          const kind = pathIdentityForTopic(next.path, topic);
          if (strongTopics.has(topic) && kind === "segment") {
            continue;
          }
          if (kind === "stem" || kind === "snake") {
            strongTopics.add(topic);
          }
        }
        used.add(key);
        out.push(next.path);
        added = true;
        break;
      }
      if (out.length >= max) {
        break;
      }
    }
  }
  return out;
}

export function rankOnboardingEntryFiles<T extends { path: string }>(
  files: T[],
  query: string
): T[] {
  const order = selectOnboardingEvidencePaths(
    files.map((file) => file.path),
    query,
    files.length
  );
  const byKey = new Map(
    files.map((file) => [normalizeOnboardingPath(file.path), file] as const)
  );
  const out: T[] = [];
  const used = new Set<string>();
  for (const path of order) {
    const key = normalizeOnboardingPath(path);
    const file = byKey.get(key);
    if (!file || used.has(key)) {
      continue;
    }
    used.add(key);
    out.push(file);
  }
  return out;
}

function isFrontendOnboardingPath(path: string): boolean {
  const n = normalizeOnboardingPath(path);
  return /(^|\/)(components|hooks|store|modal|widgets)(\/|$)/.test(n) || /(^|\/)apps\/web\//.test(n);
}

function isApiLayerOnboardingPath(path: string): boolean {
  const n = normalizeOnboardingPath(path);
  return /(^|\/)(api|serializers?|views|handlers|controllers|viewsets)(\/|$)/.test(n);
}

function askWantsApiLayer(topicQueries: string[]): boolean {
  return topicQueries.some((topic) => /\bapi\b/i.test(topic));
}

/**
 * Topics the index hit but we did not attach a filename/type identity.
 * Folder hits (issue/archive.py) and hyphen compounds do not cover.
 * Fail-open: a topic with zero stem/snake hits is not uncovered (cannot invent files).
 * Exception: when the user asked the API and we only attached frontend, retry API hits.
 */
export function uncoveredOnboardingTopics(options: {
  topicQueries: string[];
  hitPaths: string[];
  attachedPaths: string[];
}): string[] {
  const rankQuery = options.topicQueries.join(" ");
  const hits = options.hitPaths.filter((path) => !isOnboardingNoisePath(path, rankQuery));
  const attached = options.attachedPaths.filter((path) => !isOnboardingNoisePath(path, rankQuery));
  const fromIdentity = options.topicQueries.filter((topic) => {
    const hasHit = hits.some((path) => pathCoversOnboardingTopic(path, topic));
    if (!hasHit) {
      return false;
    }
    return !attached.some((path) => pathCoversOnboardingTopic(path, topic));
  });
  if (fromIdentity.length > 0) {
    return fromIdentity;
  }
  if (
    askWantsApiLayer(options.topicQueries) &&
    attached.length > 0 &&
    attached.every((path) => isFrontendOnboardingPath(path)) &&
    hits.some((path) => isApiLayerOnboardingPath(path))
  ) {
    return options.topicQueries;
  }
  // types.ts attached, send-path hits ignored — same job as frontend-only API attach.
  if (
    BEHAVIOURAL_ASK.test(rankQuery) &&
    !DECLARATION_ASK.test(rankQuery) &&
    attached.length > 0 &&
    attached.every((path) => isTypeDeclarationPath(path)) &&
    hits.some((path) => !isTypeDeclarationPath(path) && !isOnboardingNoisePath(path, rankQuery))
  ) {
    return options.topicQueries;
  }
  return [];
}

export function onboardingTopicsCovered(options: {
  topicQueries: string[];
  hitPaths: string[];
  attachedPaths: string[];
}): boolean {
  return uncoveredOnboardingTopics(options).length === 0;
}

/**
 * When a behavioural ask only attached types.ts, pull implementation hits next.
 * Filename identity will not cover "send" → CoopChatSession.ts; the hit list can.
 */
export function pickBehaviouralImplementationPaths(options: {
  query: string;
  hitPaths: string[];
  attachedPaths: string[];
  maxPaths?: number;
}): string[] {
  if (!BEHAVIOURAL_ASK.test(options.query) || DECLARATION_ASK.test(options.query)) {
    return [];
  }
  if (options.attachedPaths.some((path) => !isTypeDeclarationPath(path))) {
    return [];
  }
  const used = new Set(options.attachedPaths.map((path) => normalizeOnboardingPath(path)));
  const maxPaths = options.maxPaths ?? 4;
  const out: string[] = [];
  const ranked = [...options.hitPaths].sort((a, b) => compareOnboardingPaths(a, b, options.query));
  for (const path of ranked) {
    if (out.length >= maxPaths) {
      break;
    }
    const key = normalizeOnboardingPath(path);
    if (
      !path.trim() ||
      used.has(key) ||
      isOnboardingNoisePath(path, options.query) ||
      isTypeDeclarationPath(path)
    ) {
      continue;
    }
    used.add(key);
    out.push(path);
  }
  return out;
}

/** One non-noise pathHit per uncovered topic, highest onboarding score first. */
export function pickOnboardingTopicAttachPaths(options: {
  topicQueries: string[];
  hitPaths: string[];
  attachedPaths: string[];
  maxPaths?: number;
}): string[] {
  const uncovered = uncoveredOnboardingTopics(options);
  const rankQuery = options.topicQueries.join(" ");
  const used = new Set(options.attachedPaths.map((path) => normalizeOnboardingPath(path)));
  const out: string[] = [];
  const maxPaths = options.maxPaths ?? uncovered.length;
  for (const topic of uncovered) {
    if (out.length >= maxPaths) {
      break;
    }
    const candidates = options.hitPaths
      .filter((path) => !isOnboardingNoisePath(path, rankQuery) && pathCoversOnboardingTopic(path, topic))
      .sort((a, b) => compareOnboardingPaths(a, b, rankQuery));
    const pick = candidates.find((path) => !used.has(normalizeOnboardingPath(path)));
    if (!pick) {
      continue;
    }
    used.add(normalizeOnboardingPath(pick));
    out.push(pick);
  }
  if (out.length === 0) {
    return pickBehaviouralImplementationPaths({
      query: rankQuery,
      hitPaths: options.hitPaths,
      attachedPaths: options.attachedPaths,
      maxPaths
    });
  }
  return out;
}

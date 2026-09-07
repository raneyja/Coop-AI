/**
 * Shared helpers for user focus text on quick actions / slash commands.
 * Focus drives retrieval and synthesis — never the canned action prompt blob.
 */

/** Min length for a retrieval query (aligned with semantic retrieval). */
export const FOCUS_QUERY_MIN_LENGTH = 8;

/** Keep at most this many canonical anchors when merging focus paths. */
export const FOCUS_MIN_ANCHOR_PATHS = 1;

const LOW_VALUE_ANCHOR_BASENAMES = new Set([
  "package.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  "agents.md",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock"
]);

/** README is the only onboarding anchor worth keeping when focus hits exist. */
export function isLowValueAnchorPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  const base = normalized.split("/").pop() ?? normalized;
  if (LOW_VALUE_ANCHOR_BASENAMES.has(base) || LOW_VALUE_ANCHOR_BASENAMES.has(normalized)) {
    return true;
  }
  return normalized === "docs/readme.md";
}

export function isReadmeAnchorPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  return /(^|\/)readme\.md$/.test(normalized);
}

/** Max entry files after merging anchors + focus hits. */
export const FOCUS_MAX_ENTRY_PATHS = 6;

/** Max focus-ranked paths to inject ahead of generic manifest fillers. */
export const FOCUS_MAX_INJECTED_PATHS = 5;

const PREFIX_FILLER_RE =
  /^(please|pls|can you|could you|would you|hey coop|hey|hi|ok|okay)[,!.:]?(?:\s+|$)/i;

/** Multi-line / directive markers that only appear in canned quickActionModelPrompt text. */
const CANNED_DIRECTIVE_MARKERS = [
  "Respond in complete sentences",
  "Use attached",
  "evidence bundle",
  "DIRECTIVE"
];

/** Imperative canned task openers from quickActionPromptParts — only when they lead the string. */
const CANNED_TASK_PREFIXES = [
  "Explain this repository for a new engineer",
  "Explain why this code exists and what trade-offs",
  "Analyze the blast radius of changing",
  "Audit knowledge gaps for",
  "Audit knowledge gaps across"
];

/** Full canned ownership tasks end with this distinctive phrase. */
const CANNED_OWNERSHIP_SUFFIX = "who should i contact for questions or changes?";

/**
 * Join text before and after a slash command into a single focus string.
 * Lightly strips leading polite filler from the prefix only.
 */
export function combineSlashFocus(prefix: string, args: string): string {
  const before = stripLeadingFiller(prefix.trim());
  const after = args.trim();
  if (before && after) {
    return `${before} ${after}`.replace(/\s+/g, " ").trim();
  }
  return before || after;
}

function stripLeadingFiller(text: string): string {
  let current = text;
  // Allow a couple of stacked fillers ("hey, please …") without looping forever.
  for (let i = 0; i < 3; i += 1) {
    const next = current.replace(PREFIX_FILLER_RE, "").trim();
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

/**
 * Returns a retrieval-safe focus query, or undefined when there is no real user ask.
 * Rejects empty/short text and canned quick-action prompt blobs.
 */
export function focusQueryForRetrieval(focus: string | undefined): string | undefined {
  const trimmed = focus?.trim();
  if (!trimmed || trimmed.length < FOCUS_QUERY_MIN_LENGTH) {
    return undefined;
  }
  if (looksLikeCannedQuickActionPrompt(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\s+/g, " ");
}

export function looksLikeCannedQuickActionPrompt(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  // Multi-line directive prompts from quickActionModelPrompt.
  if (
    normalized.includes("\n") &&
    CANNED_DIRECTIVE_MARKERS.some((marker) => normalized.includes(marker))
  ) {
    return true;
  }
  if (normalized.toLowerCase().endsWith(CANNED_OWNERSHIP_SUFFIX)) {
    return true;
  }
  return CANNED_TASK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Merge canonical anchors with focus-ranked paths.
 *
 * Pass: keeps up to FOCUS_MIN_ANCHOR_PATHS anchors, then injects focus paths, then fills.
 * Fail: dropping all anchors when focus hits exist, or ignoring focus paths when provided.
 */
export function mergeFocusEntryPaths(options: {
  anchorPaths: string[];
  focusPaths: string[];
  maxPaths?: number;
  minAnchors?: number;
}): string[] {
  const maxPaths = options.maxPaths ?? FOCUS_MAX_ENTRY_PATHS;
  const minAnchors = options.minAnchors ?? FOCUS_MIN_ANCHOR_PATHS;
  const normalize = (path: string): string => path.replace(/\\/g, "/").replace(/^\.?\//, "");
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string | undefined): void => {
    const path = raw?.trim();
    if (!path) {
      return;
    }
    const key = normalize(path);
    if (seen.has(key) || out.length >= maxPaths) {
      return;
    }
    seen.add(key);
    out.push(path);
  };

  const anchors = options.anchorPaths.map((p) => p.trim()).filter(Boolean);
  const focus = options.focusPaths.map((p) => p.trim()).filter(Boolean);

  for (const path of anchors.slice(0, minAnchors)) {
    push(path);
  }
  for (const path of focus.slice(0, FOCUS_MAX_INJECTED_PATHS)) {
    push(path);
  }
  for (const path of anchors.slice(minAnchors)) {
    push(path);
  }
  for (const path of focus.slice(FOCUS_MAX_INJECTED_PATHS)) {
    push(path);
  }

  return out.slice(0, maxPaths);
}

/**
 * Pass/fail check for gather: when focus search returned hits, at least one
 * attached entry path must come from those hits (or share a focus token in the path).
 */
export function focusGatherSatisfied(options: {
  focusQuery: string;
  focusHitPaths: string[];
  attachedEntryPaths: string[];
}): boolean {
  const hits = new Set(
    options.focusHitPaths.map((p) => p.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase())
  );
  if (hits.size === 0) {
    // No index hits — gather cannot invent files; fail-open is OK.
    return true;
  }
  const attached = options.attachedEntryPaths.map((p) =>
    p.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase()
  );
  if (attached.some((path) => hits.has(path))) {
    return true;
  }
  const tokens = tokenizeFocusTerms(options.focusQuery);
  if (tokens.length === 0) {
    return attached.some((path) => hits.has(path));
  }
  return attached.some((path) => tokens.some((token) => path.includes(token)));
}

/**
 * Merge focus-search file bodies into Understand Repo entryFiles.
 * Focus hits go first and displace low-value anchors (package.json, compose, AGENTS.md).
 * At most one README is kept when focus bodies exist.
 */
export function mergeFocusFilesIntoEntryFiles<T extends { path: string; content?: string; truncated?: boolean }>(
  entryFiles: T[] | undefined,
  focusFiles: Array<{ path: string; content: string; truncated?: boolean }>,
  maxPaths = FOCUS_MAX_ENTRY_PATHS
): T[] {
  const existing = [...(entryFiles ?? [])];
  const focus = focusFiles.filter((file) => file.content.trim());
  if (focus.length === 0) {
    return existing.slice(0, maxPaths);
  }

  const normalize = (path: string): string =>
    path.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  const seen = new Set<string>();
  const out: T[] = [];

  const push = (file: T | undefined): void => {
    if (!file || out.length >= maxPaths) {
      return;
    }
    const key = normalize(file.path);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(file);
  };

  for (const file of focus) {
    if (isLowValueAnchorPath(file.path)) {
      continue;
    }
    push(file as T);
  }
  const readme = existing.find((file) => isReadmeAnchorPath(file.path));
  if (readme) {
    push(readme);
  }
  for (const file of existing) {
    if (isLowValueAnchorPath(file.path) || isReadmeAnchorPath(file.path)) {
      continue;
    }
    push(file);
  }
  return out.slice(0, maxPaths);
}

/** Content tokens from focus text for path matching (stop-word stripped). */
export function tokenizeFocusTerms(focus: string): string[] {
  const stop = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "to",
    "for",
    "of",
    "in",
    "on",
    "is",
    "are",
    "what",
    "which",
    "who",
    "how",
    "does",
    "do",
    "a",
    "from",
    "with",
    "this",
    "that",
    "main",
    "please"
  ]);
  return [
    ...new Set(
      focus
        .toLowerCase()
        .replace(/[^a-z0-9_/.-]+/g, " ")
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3 && !stop.has(part))
    )
  ];
}

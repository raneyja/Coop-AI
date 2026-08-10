/**
 * Knowledge Gaps focus adherence — gather query + audit scope when the user
 * typed text after `/gaps …`. Focus is the primary topic; leftover open-file
 * chips are secondary at most when unrelated.
 */

import { focusQueryForRetrieval, tokenizeFocusTerms } from "./userFocusQuery";

/** Phrases that only set framing, not subsystem topics. */
const FOCUS_FRAMING_PREFIX =
  /^(?:focus\s+on|focusing\s+on|look\s+at|regarding|about|for|around|re:?)\s+/i;

/**
 * Natural-language Gaps asks: "Where are the biggest documentation or knowledge
 * gaps around signing / document status?" → strip framing so topics are the
 * subsystems (signing, document status), not "documentation"/"knowledge"/"gaps".
 */
const GAPS_QUESTION_FRAMING =
  /^(?:where\s+are\s+(?:the\s+)?(?:biggest\s+)?(?:documentation\s+or\s+|docs?\s+or\s+)?(?:knowledge\s+)?gaps?\s+(?:around|for|in|about|regarding)\s+|what\s+are\s+(?:the\s+)?(?:biggest\s+)?(?:documentation\s+or\s+|docs?\s+or\s+)?(?:knowledge\s+)?gaps?\s+(?:around|for|in|about|regarding)\s+|audit\s+(?:the\s+)?(?:knowledge\s+)?gaps?\s+(?:around|for|in|about|regarding)\s+)/i;

/** Meta tokens that must not suppress focus stubs or dominate Confluence OR queries. */
const GAPS_FOCUS_META_TOKENS = new Set([
  "where",
  "what",
  "which",
  "how",
  "are",
  "the",
  "biggest",
  "documentation",
  "documentations",
  "docs",
  "doc",
  "knowledge",
  "gaps",
  "gap",
  "around",
  "about",
  "regarding",
  "missing",
  "unclear",
  "audit",
  "focus",
  "look",
  "there",
  "this",
  "that",
  "area",
  "areas"
]);

export type KnowledgeGapsAuditScope = {
  /** Retrieval-safe focus string (primary gather query). */
  gatherQuery?: string;
  /** Multi-topic phrases the answer must address (or say no evidence). */
  focusTopics: string[];
  /** When set, open file is related enough to keep as a secondary code anchor. */
  relatedOpenFile?: string;
  /** Open editor path that does not match focus — secondary only, never Summary headline. */
  secondaryUnrelatedFile?: string;
  /** True when focus text drives the audit (not file-first). */
  focusPrimary: boolean;
};

/**
 * Build the Gaps gather query from slash focus text.
 * Pass: non-empty focus → returns F as the primary retrieval query.
 * Fail: returns undefined when focus is missing/short/canned (file/repo gather only).
 */
export function knowledgeGapsGatherQuery(userFocus?: string): string | undefined {
  return focusQueryForRetrieval(userFocus);
}

/** Strip Gaps question framing + trailing punctuation so topics are subsystems. */
export function stripKnowledgeGapsTopicFraming(text: string): string {
  return text
    .replace(GAPS_QUESTION_FRAMING, "")
    .replace(FOCUS_FRAMING_PREFIX, "")
    .replace(/[?!.]+$/g, "")
    .trim();
}

/**
 * Split focus text into subsystem topics the audit must cover.
 * e.g. "focus on webhook delivery and signature certificates"
 *   → ["webhook delivery", "signature certificates"]
 * e.g. "…gaps around signing / document status?"
 *   → ["signing", "document status"]
 */
export function knowledgeGapsFocusTopics(userFocus?: string): string[] {
  const gather = knowledgeGapsGatherQuery(userFocus);
  if (!gather) {
    return [];
  }
  const stripped = stripKnowledgeGapsTopicFraming(gather);
  if (!stripped) {
    return [gather];
  }
  const parts = stripped
    .split(/\s*(?:,|;|\/|\band\b|\bplus\b|\bas\s+well\s+as\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique : [stripped];
}

/** Distinctive topic tokens — meta Gaps words excluded. */
export function knowledgeGapsTopicContentTokens(topic: string): string[] {
  return tokenizeFocusTerms(topic).filter(
    (token) => token.length >= 4 && !GAPS_FOCUS_META_TOKENS.has(token)
  );
}

/** True when the open file path shares a content token with the focus ask. */
export function openFileRelatedToGapsFocus(
  file: string | undefined,
  userFocus: string | undefined
): boolean {
  const path = file?.trim();
  const gather = knowledgeGapsGatherQuery(userFocus);
  if (!path || !gather) {
    return false;
  }
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  // Prefer topic content tokens so "documentation" in a verbose ask doesn't
  // falsely relate every docs/ helper file.
  const tokens = knowledgeGapsFocusTopics(userFocus).flatMap((topic) =>
    knowledgeGapsTopicContentTokens(topic)
  );
  const fallback = tokenizeFocusTerms(gather).filter(
    (token) => token.length >= 4 && !GAPS_FOCUS_META_TOKENS.has(token)
  );
  const effective = tokens.length > 0 ? tokens : fallback;
  if (effective.length === 0) {
    return false;
  }
  return effective.some((token) => normalized.includes(token));
}

/**
 * Resolve Gaps audit scope for gather + synthesis.
 * When focus F is present: F is primary; unrelated open file is secondary only.
 */
export function resolveKnowledgeGapsAuditScope(options: {
  file?: string;
  userFocus?: string;
  focusHitPaths?: string[];
}): KnowledgeGapsAuditScope {
  const gatherQuery = knowledgeGapsGatherQuery(options.userFocus);
  const focusTopics = knowledgeGapsFocusTopics(options.userFocus);
  const file = options.file?.trim() || undefined;

  if (!gatherQuery) {
    return {
      focusTopics: [],
      relatedOpenFile: file,
      focusPrimary: false
    };
  }

  const hitRelated =
    Boolean(file) &&
    (options.focusHitPaths ?? []).some(
      (hit) =>
        hit.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase() ===
        file!.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase()
    );
  const related = hitRelated || openFileRelatedToGapsFocus(file, options.userFocus);

  return {
    gatherQuery,
    focusTopics,
    relatedOpenFile: related ? file : undefined,
    secondaryUnrelatedFile: file && !related ? file : undefined,
    focusPrimary: true
  };
}

/**
 * Integration / index search terms derived from Gaps focus.
 * Focus phrases and tokens come first so open-file path terms cannot crowd them out.
 * Omits the full verbose question blob so Confluence CQL is not flooded with meta words.
 */
export function knowledgeGapsFocusGatherTerms(userFocus?: string): string[] {
  const gather = knowledgeGapsGatherQuery(userFocus);
  if (!gather) {
    return [];
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const term = raw.trim();
    if (!term) {
      return;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    terms.push(term);
  };

  const topics = knowledgeGapsFocusTopics(userFocus);
  for (const topic of topics) {
    push(topic);
  }
  // Compact phrase only — long NL questions become meta noise in OR/AND CQL.
  if (gather.length <= 64 && !/\?\s*$/.test(gather) && topics.length <= 1) {
    push(gather);
  }
  for (const topic of topics) {
    for (const token of knowledgeGapsTopicContentTokens(topic)) {
      push(token);
    }
  }
  return terms.slice(0, 12);
}

function topicHasCodeEvidence(topic: string, hits: string[]): boolean {
  if (hits.length === 0) {
    return false;
  }
  const tokens = knowledgeGapsTopicContentTokens(topic);
  const phrase = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (phrase.length >= 6) {
    const phraseHit = hits.some((path) => path.replace(/[^a-z0-9]/g, "").includes(phrase));
    if (phraseHit) {
      return true;
    }
  }
  if (tokens.length === 0) {
    return false;
  }
  return hits.some((path) => {
    const matched = tokens.filter((token) => path.includes(token));
    if (tokens.length === 1) {
      return matched.length === 1;
    }
    // Multi-token topics need a strong signal (2+ tokens or one distinctive ≥6).
    return matched.length >= 2 || matched.some((token) => token.length >= 6);
  });
}

/**
 * Heuristic scan stubs when focus topics have no attached code/docs evidence yet.
 * Keeps the response contract from collapsing to open-file ownership alone.
 */
export function knowledgeGapsFocusTopicGapStubs(options: {
  userFocus?: string;
  focusHitPaths?: string[];
}): Array<Record<string, unknown>> {
  const topics = knowledgeGapsFocusTopics(options.userFocus);
  if (topics.length === 0) {
    return [];
  }
  const hits = (options.focusHitPaths ?? []).map((path) =>
    path.replace(/\\/g, "/").toLowerCase()
  );
  const gaps: Array<Record<string, unknown>> = [];
  for (const topic of topics) {
    if (topicHasCodeEvidence(topic, hits)) {
      continue;
    }
    gaps.push({
      type: "missing_docs",
      priority: "medium",
      topic,
      message: `No indexed code or docs evidence attached yet for focus topic: ${topic}`
    });
  }
  return gaps;
}

/**
 * Merge focus topic stubs into an existing job scan (including empty job results).
 * Pass: empty job + focus ask → structured missing_docs stubs for uncovered topics.
 * Fail: leaving foundGaps=0 when focus topics have no evidence.
 */
export function mergeKnowledgeGapsFocusStubsIntoScan(
  jobScan: Record<string, unknown> | undefined,
  stubs: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
  if (stubs.length === 0) {
    return jobScan;
  }
  const existingGaps = Array.isArray(jobScan?.gaps)
    ? [...(jobScan!.gaps as Array<Record<string, unknown>>)]
    : [];
  const existingKeys = new Set(
    existingGaps.map((gap) => {
      const topic = typeof gap.topic === "string" ? gap.topic.toLowerCase() : "";
      const message = typeof gap.message === "string" ? gap.message.toLowerCase() : "";
      return `${gap.type ?? ""}|${topic}|${message}`;
    })
  );
  for (const stub of stubs) {
    const topic = typeof stub.topic === "string" ? stub.topic.toLowerCase() : "";
    const message = typeof stub.message === "string" ? stub.message.toLowerCase() : "";
    const key = `${stub.type ?? ""}|${topic}|${message}`;
    if (existingKeys.has(key)) {
      continue;
    }
    // Also skip if an existing gap already covers the same focus topic string.
    if (
      topic &&
      existingGaps.some(
        (gap) =>
          (typeof gap.topic === "string" && gap.topic.toLowerCase() === topic) ||
          (typeof gap.message === "string" && gap.message.toLowerCase().includes(topic))
      )
    ) {
      continue;
    }
    existingKeys.add(key);
    existingGaps.push(stub);
  }

  const highPriority = existingGaps.filter((gap) => gap.priority === "high").length;
  const mediumPriority = existingGaps.filter((gap) => gap.priority === "medium").length;
  const lowPriority = existingGaps.filter((gap) => gap.priority === "low").length;

  return {
    ...(jobScan ?? {}),
    source: typeof jobScan?.source === "string" ? jobScan.source : "live-heuristic",
    cached: Boolean(jobScan?.cached),
    foundGaps: existingGaps.length,
    highPriority,
    mediumPriority,
    lowPriority,
    gaps: existingGaps
  };
}

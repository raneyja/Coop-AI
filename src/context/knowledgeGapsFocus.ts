/**
 * Knowledge Gaps focus adherence — gather query + audit scope when the user
 * typed text after `/gaps …`. Focus is the primary topic; leftover open-file
 * chips are secondary at most when unrelated.
 */

import { focusQueryForRetrieval, tokenizeFocusTerms } from "./userFocusQuery";

/** Phrases that only set framing, not subsystem topics. */
const FOCUS_FRAMING_PREFIX =
  /^(?:focus\s+on|focusing\s+on|look\s+at|regarding|about|for|around|re:?)\s+/i;

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

/**
 * Split focus text into subsystem topics the audit must cover.
 * e.g. "focus on webhook delivery and signature certificates"
 *   → ["webhook delivery", "signature certificates"]
 */
export function knowledgeGapsFocusTopics(userFocus?: string): string[] {
  const gather = knowledgeGapsGatherQuery(userFocus);
  if (!gather) {
    return [];
  }
  const stripped = gather.replace(FOCUS_FRAMING_PREFIX, "").trim();
  if (!stripped) {
    return [gather];
  }
  const parts = stripped
    .split(/\s*(?:,|;|\band\b|\bplus\b|\bas\s+well\s+as\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique : [stripped];
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
  const tokens = tokenizeFocusTerms(gather);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.some((token) => normalized.includes(token));
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

  for (const topic of knowledgeGapsFocusTopics(userFocus)) {
    push(topic);
  }
  push(gather);
  for (const token of tokenizeFocusTerms(gather)) {
    if (token.length >= 4) {
      push(token);
    }
  }
  return terms.slice(0, 12);
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
    const tokens = tokenizeFocusTerms(topic);
    const hasHit =
      hits.length > 0 &&
      (tokens.length === 0 ||
        hits.some((path) => tokens.some((token) => path.includes(token))));
    if (hasHit) {
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

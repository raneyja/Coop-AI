/**
 * Open-file grounding for Trace Decision gather/ranking.
 * Keeps primary narrative on the active file path — never silently retargets to
 * a sibling migration or unrelated path from a multi-file commit/PR.
 */

import { fileStemFromPath, textReferencesFile } from "./traceEvidenceRelevance";

const STOP_TERMS = new Set([
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
  "was",
  "were",
  "be",
  "been",
  "why",
  "how",
  "what",
  "which",
  "who",
  "do",
  "does",
  "did",
  "we",
  "our",
  "this",
  "that",
  "with",
  "from",
  "into",
  "about",
  "model",
  "modeled",
  "modelling",
  "modeling",
  "way",
  "like",
  "please",
  "code",
  "file",
  "here"
]);

const BULK_RENAME_COMMIT_RE =
  /\b(renam(e|ed|ing)|move(d|s)?|relocated?|reorganiz(e|ed|ing)|chore:\s*rename)\b/i;

/** Normalize repo-relative paths for equality checks. */
export function normalizeTracePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/** True when two paths refer to the same repo file (exact or suffix match). */
export function tracePathsReferToSameFile(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) {
    return false;
  }
  const left = normalizeTracePath(a);
  const right = normalizeTracePath(b);
  if (left === right) {
    return true;
  }
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

/**
 * Focus terms from the open file + user ask + snippet.
 * Used to rank commits/PRs toward the symbol the user asked about.
 */
export function extractTraceFocusTerms(options: {
  file: string;
  userFocus?: string;
  codeSnippet?: string;
}): string[] {
  const terms: string[] = [];
  const stem = fileStemFromPath(options.file);
  if (stem.length >= 3) {
    terms.push(stem);
  }
  const base = options.file.split("/").pop()?.toLowerCase();
  if (base && base.length >= 3) {
    terms.push(base.replace(/\.[^.]+$/, ""));
  }

  const pushToken = (raw: string): void => {
    const cleaned = raw.replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, "");
    if (cleaned.length < 3) {
      return;
    }
    const lower = cleaned.toLowerCase();
    if (!STOP_TERMS.has(lower)) {
      terms.push(lower);
    }
    // CamelCase / PascalCase → parts (StateGroup → state, group)
    for (const part of cleaned.split(/(?=[A-Z])/)) {
      const piece = part.toLowerCase();
      if (piece.length >= 3 && !STOP_TERMS.has(piece)) {
        terms.push(piece);
      }
    }
  };

  for (const chunk of [options.userFocus, options.codeSnippet]) {
    if (!chunk?.trim()) {
      continue;
    }
    for (const match of chunk.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
      pushToken(match[0]);
    }
  }

  return [...new Set(terms)].slice(0, 24);
}

/** Score how well free text matches Trace focus terms (0 = no overlap). */
export function scoreTextForTraceFocus(text: string, focusTerms: string[]): number {
  if (!text.trim() || focusTerms.length === 0) {
    return 0;
  }
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of focusTerms) {
    const needle = term.toLowerCase();
    if (needle.length < 3) {
      continue;
    }
    if (haystack.includes(needle)) {
      // Longer / more specific tokens weigh more (StateGroup > state).
      score += Math.min(6, Math.floor(needle.length / 2));
    }
  }
  return score;
}

export function isBulkRenameOrMoveCommit(message: string, filesChanged?: number): boolean {
  if (typeof filesChanged === "number" && filesChanged >= 40 && BULK_RENAME_COMMIT_RE.test(message)) {
    return true;
  }
  return BULK_RENAME_COMMIT_RE.test(message) && (filesChanged ?? 0) >= 20;
}

export type TracePrRelevanceInput = {
  title: string;
  description?: string;
  file: string;
  focusTerms: string[];
  reviewPaths?: Array<string | undefined>;
};

/**
 * True when a linked PR clearly relates to the open file or the user's ask.
 * Multi-file rename/chore PRs that never mention the file/ask are not primary rationale.
 */
export function linkedPrRelevantToTraceTarget(input: TracePrRelevanceInput): boolean {
  const haystack = `${input.title}\n${input.description ?? ""}`;
  if (textReferencesFile(haystack, input.file)) {
    return true;
  }
  if (scoreTextForTraceFocus(haystack, input.focusTerms) > 0) {
    return true;
  }
  return (input.reviewPaths ?? []).some(
    (path) => path && tracePathsReferToSameFile(path, input.file)
  );
}

/** Prefer review comments on the target file; keep others as secondary context. */
export function partitionReviewsForTraceTarget<T extends { path?: string }>(
  reviews: T[],
  file: string
): { primary: T[]; secondary: T[] } {
  const primary: T[] = [];
  const secondary: T[] = [];
  for (const review of reviews) {
    if (review.path && tracePathsReferToSameFile(review.path, file)) {
      primary.push(review);
    } else if (!review.path) {
      // Conversation without a path — keep as primary discussion.
      primary.push(review);
    } else {
      secondary.push(review);
    }
  }
  // If nothing lands on the file, keep general conversation (not path-scoped noise).
  if (primary.length === 0) {
    return {
      primary: reviews.filter((review) => !review.path),
      secondary: reviews.filter((review) => Boolean(review.path))
    };
  }
  return { primary, secondary };
}

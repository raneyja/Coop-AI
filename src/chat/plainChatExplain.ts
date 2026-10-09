/**
 * Plain-chat "explain this file / walk me through X" — briefing, not a dump.
 * Used to cap retrieval bodies and lock the response shape.
 */
import { normalizeRequestedPath, requestedRepoFiles } from "../api/agent/requestedRepoFiles";
import { hasRepoFactNeed, repoFactNeeds } from "../workspace/repoFactIntent";

const EXPLAIN_ASK_RE =
  /\b(explain|walk\s+me\s+through|what\s+does\s+(?:this|it)|what\s+behavior\s+does\s+(?:this|the)\b|how\s+does\s+(?:this|it)|when\s+does\s+it)\b/i;

const REVIEW_AS_PR_RE =
  /\breview\b/i;
const PR_TOKEN_RE = /\b(pr|pull\s+request)\b/i;
const REVIEW_BLOCK_RE = /\bwhat\s+would\s+you\s+block\b/i;
const REVIEW_AUTHOR_RE = /\bask\s+the\s+author\b/i;
const WHOLE_FILE_BEHAVIOR_RE = /\b(?:whole|entire|full)\b[^.?!\n]{0,80}\b(?:class|file)\b|\ball\b[^.?!\n]{0,80}\b(?:class|file|behavior)\b|\bevery\s+(?:method|behavior)\b/i;

export function isOpenFileExplainAsk(message: string | undefined): boolean {
  const text = message?.trim() ?? "";
  if (text.length < 8) {
    return false;
  }
  return EXPLAIN_ASK_RE.test(text);
}

/** A chip cannot own an explanation that explicitly requests other files. */
export function openFileOwnsExplainAsk(message: string, file?: string): boolean {
  if (!file || !isOpenFileExplainAsk(message) || isOpenFileReviewAsk(message) || hasRepoFactNeed(repoFactNeeds(message))) return false;
  const path = normalizeRequestedPath(file);
  return requestedRepoFiles(message).every((ref) => ref.requestedPath === path ||
    (!ref.exact && ref.requestedPath === path.split("/").pop()));
}

/**
 * "Review this like a PR" / block / fine / ask the author — teammate review of
 * the open file, not A8 stuck-status synthesis.
 */
export function isOpenFileReviewAsk(message: string | undefined): boolean {
  const text = message?.trim() ?? "";
  if (text.length < 8) {
    return false;
  }
  if (REVIEW_AS_PR_RE.test(text) && PR_TOKEN_RE.test(text)) {
    return true;
  }
  if (REVIEW_BLOCK_RE.test(text)) {
    return true;
  }
  if (REVIEW_AUTHOR_RE.test(text) && /\b(fine|block)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function asksForWholeOpenFileBehavior(message: string | undefined): boolean {
  return WHOLE_FILE_BEHAVIOR_RE.test(message?.trim() ?? "");
}

/**
 * Explain with an open file: search may return paths, but do not attach extra file bodies.
 * PR review needs caller bodies so Block can cite a real importer.
 */
export function semanticAttachModeForChat(options: {
  query: string;
  openFile?: string;
}): "bodies" | "paths-only" {
  const open = Boolean(options.openFile?.trim());
  if (!open) {
    return "bodies";
  }
  if (openFileOwnsExplainAsk(options.query, options.openFile)) {
    return "paths-only";
  }
  return "bodies";
}

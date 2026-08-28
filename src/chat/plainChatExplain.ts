/**
 * Plain-chat "explain this file / walk me through X" — briefing, not a dump.
 * Used to cap retrieval bodies and lock the response shape.
 */
const EXPLAIN_ASK_RE =
  /\b(explain|walk\s+me\s+through|what\s+does\s+(?:this|it)|how\s+does\s+(?:this|it)|when\s+does\s+it)\b/i;

const REVIEW_AS_PR_RE =
  /\breview\b/i;
const PR_TOKEN_RE = /\b(pr|pull\s+request)\b/i;
const REVIEW_BLOCK_RE = /\bwhat\s+would\s+you\s+block\b/i;
const REVIEW_AUTHOR_RE = /\bask\s+the\s+author\b/i;

export function isOpenFileExplainAsk(message: string | undefined): boolean {
  const text = message?.trim() ?? "";
  if (text.length < 8) {
    return false;
  }
  return EXPLAIN_ASK_RE.test(text);
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

/** Explain with an open file: search may return paths, but do not attach extra file bodies. */
export function semanticAttachModeForChat(options: {
  query: string;
  openFile?: string;
}): "bodies" | "paths-only" {
  if (isOpenFileExplainAsk(options.query) && Boolean(options.openFile?.trim())) {
    return "paths-only";
  }
  return "bodies";
}

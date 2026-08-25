/**
 * Plain-chat "explain this file / walk me through X" — briefing, not a dump.
 * Used to cap retrieval bodies and lock the response shape.
 */
const EXPLAIN_ASK_RE =
  /\b(explain|walk\s+me\s+through|what\s+does\s+(?:this|it)|how\s+does\s+(?:this|it)|when\s+does\s+it)\b/i;

export function isOpenFileExplainAsk(message: string | undefined): boolean {
  const text = message?.trim() ?? "";
  if (text.length < 8) {
    return false;
  }
  return EXPLAIN_ASK_RE.test(text);
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

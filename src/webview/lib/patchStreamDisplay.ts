/** True when streamed assistant text is (or will be) a File:/SEARCH-REPLACE patch. */
export function looksLikePatchStreamingContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("<<<<<<< SEARCH")) {
    return true;
  }
  if (/```patch\b/i.test(trimmed)) {
    return true;
  }
  // Model often emits the File: header before the fence opens.
  if (/^File:\s+/m.test(trimmed) && /```/.test(trimmed)) {
    return true;
  }
  if (/^File:\s+.+\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|c|cpp|h|swift)\b/im.test(trimmed)) {
    return true;
  }
  return false;
}

/** User bubble that indicates this turn is /edit (or edit composer). */
export function isEditHistoryContent(content: string | undefined): boolean {
  const trimmed = content?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return /^\/edit\b/i.test(trimmed) || /^\[edit\]/i.test(trimmed);
}

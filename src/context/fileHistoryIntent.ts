/**
 * Detect plain-chat asks for who created a file / when — git history, not Find Owner.
 */

function normalize(queryText: string | undefined): string {
  return queryText?.trim().toLowerCase() ?? "";
}

/**
 * True when the user wants author / creation / first-commit timing for the file.
 * Does not match ownership ("who owns") or caller asks.
 */
export function isFileHistoryQuery(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q) {
    return false;
  }
  if (/\bwho\s+owns\b/.test(q) || /\bfind\s+(?:the\s+)?owner\b/.test(q)) {
    return false;
  }

  return (
    /\bwho\s+created\b/.test(q) ||
    /\bwho\s+(?:first\s+)?(?:wrote|authored|added)\b/.test(q) ||
    /\bwhen\s+(?:was\s+)?(?:this|it)(?:\s+file)?\s+(?:created|added|written|introduced)\b/.test(q) ||
    /\bwhen\s+(?:was|were)\s+(?:this|it)\s+created\b/.test(q) ||
    /\bfirst\s+commit\b/.test(q) ||
    /\bgit\s+histor(?:y|ies)\b/.test(q) ||
    /\bwho\s+added\s+(?:this|it)(?:\s+file)?\b/.test(q) ||
    /\bcreation\s+date\b/.test(q) ||
    /\bwho\s+authored\b/.test(q)
  );
}

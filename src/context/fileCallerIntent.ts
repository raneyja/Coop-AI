/**
 * Detect plain-chat asks that need durable remote dependents (who calls / who imports),
 * not just active-file explanation. Blast already gathers these; plain chat must too.
 */

function normalize(queryText: string | undefined): string {
  return queryText?.trim().toLowerCase() ?? "";
}

/**
 * True when the user is asking for callers / importers of the open file (or "this").
 * Does not match ownership ("who owns") or generic "who" questions.
 */
export function isFileCallerQuery(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q) {
    return false;
  }
  // Find Owner — not import callers.
  if (/\bwho\s+owns\b/.test(q) || /\bfind\s+(?:the\s+)?owner\b/.test(q)) {
    return false;
  }

  return (
    /\bwho\s+calls\b/.test(q) ||
    /\bwho\s+imports?\b/.test(q) ||
    /\bwho\s+(?:else\s+)?(?:uses|consumes)\s+(?:this|it)\b/.test(q) ||
    /\bcallers?\s+(?:of|for|to)\b/.test(q) ||
    /\bwhat\s+(?:imports?|calls?)\s+(?:this|it)\b/.test(q) ||
    /\bwhat\s+depends\s+on\s+(?:this|it)\b/.test(q) ||
    /\bdependents?\s+(?:of|on)\b/.test(q) ||
    /\b(?:files?\s+that\s+)?(?:import|call)\s+(?:this|it)(?:\s+file)?\b/.test(q) ||
    /\breferences?\s+to\s+this\s+(?:file|module|symbol)\b/.test(q) ||
    /\bused\s+elsewhere\b/.test(q)
  );
}

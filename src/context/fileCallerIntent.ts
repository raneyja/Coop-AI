/**
 * Detect plain-chat asks that need durable remote dependents (who calls / who imports),
 * not just active-file explanation. Blast already gathers these; plain chat must too.
 * Ship-check English ("what else should I check before I ship") uses the same
 * search+read pipe — it must never promote to /blast.
 */

function normalize(queryText: string | undefined): string {
  return queryText?.trim().toLowerCase() ?? "";
}

function isOwnerAsk(q: string): boolean {
  return /\bwho\s+owns\b/.test(q) || /\bfind\s+(?:the\s+)?owner\b/.test(q);
}

/**
 * True when the user is asking what else to check before changing/shipping code.
 * Same caller-read pipe as `isFileCallerQuery`; never a workflow / slash.
 */
export function isShipCheckQuery(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q || isOwnerAsk(q)) {
    return false;
  }
  return (
    /\bbefore\s+i\s+ship\b/.test(q) ||
    /\bwhat\s+else\s+(?:in\s+this\s+(?:repo|repository|codebase|project)\s+)?should\s+i\s+check\b/.test(
      q
    ) ||
    /\bwhat\s+else\s+is\s+affected\b/.test(q) ||
    /\bwhat\s+breaks\s+if\s+i\s+(?:change|modify|rename|update|edit)\b/.test(q) ||
    /\bblast\s+radius\b/.test(q) ||
    /\b(?:is\s+it\s+)?safe\s+to\s+(?:change|modify|rename)\b/.test(q) ||
    /\bif\s+i\s+(?:change|modify|rename|update)\b[\s\S]{0,120}\bwhat\s+else\b/.test(q)
  );
}

/**
 * True when the user is asking for callers / importers of the open file (or "this"),
 * or a ship-check / blast-shaped impact follow-up. Does not match ownership
 * ("who owns") or generic "who" questions.
 */
export function isFileCallerQuery(queryText: string | undefined): boolean {
  const q = normalize(queryText);
  if (!q) {
    return false;
  }
  // Find Owner — not import callers.
  if (isOwnerAsk(q)) {
    return false;
  }
  if (isShipCheckQuery(q)) {
    return true;
  }

  return (
    /\bwho\s+calls\b/.test(q) ||
    /\bwho\s+imports?\b/.test(q) ||
    /\bwho\s+(?:else\s+)?(?:uses|consumes)\s+(?:this|it)\b/.test(q) ||
    /\bcallers?\s+(?:of|for|to)\b/.test(q) ||
    /\bwhat\s+(?:imports?|calls?)\s+(?:this|it)\b/.test(q) ||
    /\bwhat\s+depends\s+on\s+(?:this|it)\b/.test(q) ||
    /\bwhat\s+other\s+files\s+rely\s+on\b/.test(q) ||
    /\bfiles?\s+(?:that\s+)?rely\s+on\s+(?:this|it)\b/.test(q) ||
    /\brely\s+on\s+(?:this|it)(?:\s+file)?\b/.test(q) ||
    /\bdependents?\s+(?:of|on)\b/.test(q) ||
    /\b(?:files?\s+that\s+)?(?:import|call)\s+(?:this|it)(?:\s+file)?\b/.test(q) ||
    /\breferences?\s+to\s+this\s+(?:file|module|symbol)\b/.test(q) ||
    /\bused\s+elsewhere\b/.test(q)
  );
}

/**
 * Detects when an /edit user message asks for several alternative rewrites,
 * and builds a short turn-level reminder so the model cannot "helpfully" stuff
 * every option into one SEARCH/REPLACE block as comments.
 */

/** Nouns users use for "give me N alternatives". */
const OPTION_NOUN =
  "options|alternatives|ways|rewrites|approaches|changes|edits|patches|suggestions|improvements|variants|versions|recommendations";

const COUNT_BEFORE_OPTIONS = new RegExp(
  `\\b(\\d{1,2})\\s+(?:different\\s+|distinct\\s+|separate\\s+|possible\\s+|potential\\s+)?(?:${OPTION_NOUN})\\b`,
  "i"
);

const OPTIONS_BEFORE_COUNT = new RegExp(
  `\\b(?:${OPTION_NOUN})\\s*(?::|=)?\\s*(\\d{1,2})\\b`,
  "i"
);

const PROVIDE_N = new RegExp(
  `\\b(?:give|show|provide|propose|offer|recommend|suggest|list)\\s+(?:me\\s+)?(\\d{1,2})\\s+(?:different\\s+|distinct\\s+|separate\\s+)?(?:${OPTION_NOUN})\\b`,
  "i"
);

/** "recommend 2 changes" / "suggest three edits" with the verb before the count. */
const RECOMMEND_N = new RegExp(
  `\\b(?:recommend|suggest|propose|offer|list)\\s+(?:me\\s+)?(\\d{1,2})\\s+(?:different\\s+|distinct\\s+|separate\\s+)?(?:${OPTION_NOUN})\\b`,
  "i"
);

/** Comment-style option markers models bury inside a single REPLACE body. */
const EMBEDDED_OPTION_MARKER =
  /(?:^|\n)[ \t]*(?:\/\/\s*|#\s*|\/\*\s*)(?:Option|Alternative)\s*([0-9]+|[A-Za-z])\s*[:.\-–—)]/gi;

const HUNK_BODY_PATTERN =
  /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

export type EditOptionRequest = {
  count: number;
};

function parseOptionCount(match: RegExpExecArray | null): number | undefined {
  if (!match) {
    return undefined;
  }
  const count = Number(match[1]);
  if (Number.isFinite(count) && count >= 2 && count <= 8) {
    return count;
  }
  return undefined;
}

export function detectEditOptionRequest(message: string): EditOptionRequest | undefined {
  const text = message.trim();
  if (!text) {
    return undefined;
  }
  for (const pattern of [PROVIDE_N, RECOMMEND_N, COUNT_BEFORE_OPTIONS, OPTIONS_BEFORE_COUNT]) {
    // Fresh regex each pass — avoid lastIndex bleed across calls.
    const match = new RegExp(pattern.source, pattern.flags).exec(text);
    const count = parseOptionCount(match);
    if (count !== undefined) {
      return { count };
    }
  }
  return undefined;
}

/**
 * Counts unique Option/Alternative markers embedded as comments inside patch
 * SEARCH/REPLACE bodies (typically `// Option 1:` in one REPLACE). Plain
 * `Option N:` headers outside fences are real structure — handled separately.
 */
export function countEmbeddedOptionMarkers(content: string): number {
  const hunkBodies: string[] = [];
  const hunkRe = new RegExp(HUNK_BODY_PATTERN.source, "g");
  let hunkMatch: RegExpExecArray | null;
  while ((hunkMatch = hunkRe.exec(content)) !== null) {
    hunkBodies.push(hunkMatch[1] ?? "", hunkMatch[2] ?? "");
  }

  const ids = new Set<string>();
  for (const body of hunkBodies) {
    const markerRe = new RegExp(EMBEDDED_OPTION_MARKER.source, "gi");
    let marker: RegExpExecArray | null;
    while ((marker = markerRe.exec(body)) !== null) {
      ids.add((marker[1] ?? "").toLowerCase());
    }
  }
  return ids.size;
}

export function formatMultiOptionEditReminder(count: number): string {
  return [
    `<edit_options_reminder>`,
    `The user asked for ${count} separate options. You MUST emit exactly ${count} option blocks.`,
    `Each block is:`,
    `Option N: <short label>`,
    `File: \`path\``,
    "```patch",
    "<<<<<<< SEARCH",
    "...",
    "=======",
    "...",
    ">>>>>>> REPLACE",
    "```",
    `Summary: <1-2 sentences>`,
    ``,
    `Hard rules:`,
    `- Never put Option 1 / Option 2 / Option 3 (or their Summaries) as comments inside one REPLACE block.`,
    `- Never merge alternatives into a single SEARCH/REPLACE. Each option is its own File: + patch + Summary.`,
    `- Each option's SEARCH must match the current file independently — the user applies exactly one.`,
    `- Do not collapse ${count} requested alternatives into one "Proposed edit".`,
    `</edit_options_reminder>`
  ].join("\n");
}

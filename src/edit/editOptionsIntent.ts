/**
 * Detects when an /edit user message asks for several alternative rewrites,
 * and builds a short turn-level reminder so the model cannot "helpfully" stuff
 * every option into one SEARCH/REPLACE block as comments.
 */

const COUNT_BEFORE_OPTIONS =
  /\b(\d{1,2})\s+(?:different\s+|distinct\s+|separate\s+)?(?:options|alternatives|ways|rewrites|approaches)\b/i;

const OPTIONS_BEFORE_COUNT =
  /\b(?:options|alternatives|ways|rewrites|approaches)\s*(?::|=)?\s*(\d{1,2})\b/i;

const PROVIDE_N =
  /\b(?:give|show|provide|propose|offer)\s+(?:me\s+)?(\d{1,2})\s+(?:different\s+)?(?:options|alternatives|ways)\b/i;

/** Comment-style option markers models bury inside a single REPLACE body. */
const EMBEDDED_OPTION_MARKER =
  /(?:^|\n)[ \t]*(?:\/\/\s*|#\s*|\/\*\s*)(?:Option|Alternative)\s*([0-9]+|[A-Za-z])\s*[:.\-–—)]/gi;

const HUNK_BODY_PATTERN =
  /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

export type EditOptionRequest = {
  count: number;
};

export function detectEditOptionRequest(message: string): EditOptionRequest | undefined {
  const text = message.trim();
  if (!text) {
    return undefined;
  }
  for (const pattern of [PROVIDE_N, COUNT_BEFORE_OPTIONS, OPTIONS_BEFORE_COUNT]) {
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }
    const count = Number(match[1]);
    if (Number.isFinite(count) && count >= 2 && count <= 8) {
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
    `</edit_options_reminder>`
  ].join("\n");
}

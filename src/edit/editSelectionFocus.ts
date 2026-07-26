/**
 * Turn-level reminder so /edit stays on the user's highlighted range instead of
 * rewriting the whole attached file.
 */

export function formatEditSelectionReminder(
  selectedLines: readonly [number, number],
  file?: string,
  selectedCode?: string
): string {
  const [start, end] = selectedLines;
  const where = file?.trim() ? ` in \`${file.trim()}\`` : "";
  const lines = [
    `<edit_selection_focus>`,
    `The user highlighted lines ${start}-${end}${where}.`,
    `That highlight is the ONLY edit target.`,
    `Every SEARCH/REPLACE must modify this selection (or a contiguous subset of it).`,
    `Do not propose changes to other methods, listeners, or regions in the file.`,
    `Do not "improve" nearby code. If the request says replacements/options/changes without naming another region, apply them to this highlight.`
  ];
  const code = selectedCode?.trim();
  if (code) {
    lines.push("", "Highlighted code (authoritative — SEARCH must match this text):", "```", code, "```");
  }
  lines.push(`</edit_selection_focus>`);
  return lines.join("\n");
}

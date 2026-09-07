import type { PatchPreviewFile } from "../chat/types";

const MAX_DIFF_CHARS = 4000;
const MAX_HUNK_LINES = 80;

/** Compact +/- preview of applied hunks for PR notes generation. */
export function compactPatchDiffForPrNotes(files: readonly PatchPreviewFile[]): string {
  const sections: string[] = [];
  for (const file of files) {
    const lines: string[] = [];
    for (const hunk of file.hunks) {
      if (hunk.status === "rejected") {
        continue;
      }
      for (const line of hunk.lines) {
        if (line.kind === "context") {
          continue;
        }
        const mark = line.kind === "add" ? "+" : "-";
        lines.push(`${mark} ${line.text}`);
        if (lines.length >= MAX_HUNK_LINES) {
          break;
        }
      }
      if (lines.length >= MAX_HUNK_LINES) {
        break;
      }
    }
    if (lines.length === 0) {
      sections.push(`${file.relativePath}\n(no line preview)`);
      continue;
    }
    sections.push(`${file.relativePath}\n${lines.join("\n")}`);
  }
  const joined = sections.join("\n\n").trim();
  if (joined.length <= MAX_DIFF_CHARS) {
    return joined;
  }
  return `${joined.slice(0, MAX_DIFF_CHARS - 1).trimEnd()}…`;
}

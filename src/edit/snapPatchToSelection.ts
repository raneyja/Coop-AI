import { findAllSearchMatches, type SearchMatchHit } from "./patchContent";
import type { ParsedPatchSet, PatchHunk } from "./patchParser";

export type LineRange = [number, number];

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/);
}

/** 1-based inclusive slice. */
export function selectionTextFromFile(content: string, selectedLines: LineRange): string {
  const rows = splitLines(content);
  const start = Math.max(1, selectedLines[0]);
  const end = Math.min(rows.length, selectedLines[1]);
  if (end < start) {
    return "";
  }
  return rows.slice(start - 1, end).join("\n");
}

function leadingWhitespace(line: string): string {
  const match = line.match(/^(\s*)/);
  return match?.[1] ?? "";
}

function looksLikeCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("--")
  );
}

function hitLineRange(content: string, hit: SearchMatchHit): LineRange {
  const startLine = splitLines(content.slice(0, hit.start)).length;
  const endLine = splitLines(content.slice(0, Math.max(hit.start, hit.end))).length;
  return [Math.max(1, startLine), Math.max(1, endLine)];
}

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

function firstCommentPrefix(replace: string): string | undefined {
  const lines = splitLines(replace);
  let end = 0;
  while (end < lines.length && !lines[end]!.trim()) {
    end += 1;
  }
  if (end >= lines.length || !looksLikeCommentLine(lines[end]!)) {
    return undefined;
  }
  return lines.slice(0, end + 1).join("\n");
}

/**
 * Leading lines in REPLACE that are not part of SEARCH — the inserted comment
 * (or blank + comment) for "add a line above".
 */
export function extractInsertedPrefix(replace: string, search: string): string | undefined {
  if (replace.endsWith(search) && replace.length > search.length) {
    const prefix = replace.slice(0, replace.length - search.length);
    const trimmed = prefix.replace(/\n+$/, "");
    return trimmed.length > 0 ? trimmed : undefined;
  }
  const replaceLines = splitLines(replace);
  const searchLines = splitLines(search);
  if (replaceLines.length > searchLines.length) {
    const extraCount = replaceLines.length - searchLines.length;
    const extra = replaceLines.slice(0, extraCount);
    const rest = replaceLines.slice(extraCount).join("\n");
    if (rest === search && extra.some((line) => looksLikeCommentLine(line) || line.trim().length > 0)) {
      return extra.join("\n");
    }
  }
  return firstCommentPrefix(replace);
}

function indentCommentToSelection(comment: string, selectedText: string): string {
  const lead = leadingWhitespace(splitLines(selectedText)[0] ?? "");
  return splitLines(comment)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return "";
      }
      return `${lead}${trimmed}`;
    })
    .join("\n");
}

function retargetOntoSelection(hunk: PatchHunk, selectedText: string): PatchHunk {
  const prefix = extractInsertedPrefix(hunk.replace, hunk.search);
  if (prefix !== undefined) {
    const comment = indentCommentToSelection(prefix, selectedText);
    return {
      search: selectedText,
      replace: `${comment}\n${selectedText}`
    };
  }
  return {
    search: selectedText,
    replace: hunk.replace.includes(hunk.search)
      ? hunk.replace.replace(hunk.search, selectedText)
      : hunk.replace
  };
}

/**
 * When the user highlighted lines, SEARCH must land on those bytes.
 * Models often paraphrase a nearby dict/function; that yields "SEARCH not found"
 * or comments the wrong block. Snap SEARCH to the live selection.
 */
export function snapHunkToSelection(options: {
  content?: string;
  selectionText?: string;
  hunk: PatchHunk;
  selectedLines?: LineRange;
}): PatchHunk {
  const selectedLines = options.selectedLines;
  const selectedText =
    (options.content && selectedLines
      ? selectionTextFromFile(options.content, selectedLines)
      : undefined) ||
    options.selectionText?.trimEnd() ||
    "";
  if (!selectedText.trim()) {
    return options.hunk;
  }
  if (options.content && selectedLines) {
    const matches = findAllSearchMatches(options.content, options.hunk.search);
    if (matches.length === 0) {
      return retargetOntoSelection(options.hunk, selectedText);
    }
    const inside = matches.filter((hit) => rangesOverlap(hitLineRange(options.content!, hit), selectedLines));
    if (inside.length > 0) {
      return options.hunk;
    }
  } else if (options.hunk.search === selectedText) {
    return options.hunk;
  }
  return retargetOntoSelection(options.hunk, selectedText);
}

function lookupFileContent(
  relativePath: string,
  readContent: (relativePath: string) => string | undefined
): string | undefined {
  const direct = readContent(relativePath);
  if (direct) {
    return direct;
  }
  return undefined;
}

export function snapPatchSetToSelection(
  patches: ParsedPatchSet,
  options: {
    selectedLines?: LineRange;
    preferredFile?: string;
    selectionText?: string;
    readContent: (relativePath: string) => string | undefined;
  }
): ParsedPatchSet {
  if (!options.selectedLines && !options.selectionText?.trim()) {
    return patches;
  }
      const preferred = options.preferredFile?.replace(/\\/g, "/").replace(/^\.?\//, "");
  const onlyFile = patches.files.length === 1;
  return {
    files: patches.files.map((file) => {
      const path = file.relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
      if (
        !onlyFile &&
        preferred &&
        path !== preferred &&
        !path.endsWith(`/${preferred}`) &&
        !preferred.endsWith(`/${path}`)
      ) {
        return file;
      }
      const content = lookupFileContent(file.relativePath, options.readContent);
      if (!content && !options.selectionText?.trim()) {
        return file;
      }
      return {
        relativePath: file.relativePath,
        hunks: file.hunks.map((hunk) =>
          snapHunkToSelection({
            content,
            selectionText: options.selectionText,
            hunk,
            selectedLines: options.selectedLines
          })
        )
      };
    })
  };
}

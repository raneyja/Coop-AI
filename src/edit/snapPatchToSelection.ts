import { findAllSearchMatches, type SearchMatchHit } from "./patchContent";
import { replaceDuplicatesSearch } from "./patchHunkGuards";
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

function extractLeadingCommentPrefix(replace: string): string | undefined {
  const prefix = firstCommentPrefix(replace);
  if (!prefix) {
    return undefined;
  }
  const lines = splitLines(prefix).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.some((line) => !looksLikeCommentLine(line))) {
    return undefined;
  }
  return prefix;
}

/**
 * Comment-only asks: keep an inserted comment, drop signature/body rewrites.
 * Returns undefined when the hunk would change existing code with no comment.
 */
export function coerceCommentOnlyHunk(
  hunk: PatchHunk,
  selectedText: string
): PatchHunk | undefined {
  const prefix =
    extractInsertedPrefix(hunk.replace, hunk.search) ?? extractLeadingCommentPrefix(hunk.replace);
  if (prefix !== undefined && splitLines(prefix).some((line) => looksLikeCommentLine(line))) {
    const comment = indentCommentToSelection(prefix, selectedText);
    return {
      search: selectedText,
      replace: `${comment}\n${selectedText}`
    };
  }
  return undefined;
}

function extractUniqueCommentLines(replace: string, search: string): string | undefined {
  const searchTrimmed = new Set(
    splitLines(search)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
  const comments = splitLines(replace).filter(
    (line) => looksLikeCommentLine(line) && !searchTrimmed.has(line.trim())
  );
  if (comments.length === 0) {
    return undefined;
  }
  return comments.join("\n");
}

function normalizePatchText(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

/**
 * Overlap is not enough: a short SEARCH plus a fat REPLACE (comment + whole
 * block, or SEARCH pasted twice) expands on Apply and duplicates lines.
 */
export function hunkExpandsSelection(hunk: PatchHunk, selectedText: string): boolean {
  if (replaceDuplicatesSearch(hunk.replace, hunk.search)) {
    return true;
  }
  const sel = normalizePatchText(selectedText);
  const sch = normalizePatchText(hunk.search);
  if (!sel || sch === sel) {
    return false;
  }
  if (sel.includes(sch) && sch.length < sel.length) {
    if (hunk.replace.includes(sel)) {
      return true;
    }
    const prefix = extractInsertedPrefix(hunk.replace, hunk.search);
    if (prefix !== undefined && splitLines(prefix).some((line) => looksLikeCommentLine(line))) {
      return true;
    }
  }
  return false;
}

function retargetOntoSelection(
  hunk: PatchHunk,
  selectedText: string,
  commentOnly?: boolean
): PatchHunk | undefined {
  if (commentOnly) {
    return retargetDuplicateComment(hunk, selectedText) ?? coerceCommentOnlyHunk(hunk, selectedText);
  }
  const duplicateComment = retargetDuplicateComment(hunk, selectedText);
  if (duplicateComment) {
    return duplicateComment;
  }
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

function retargetDuplicateComment(hunk: PatchHunk, selectedText: string): PatchHunk | undefined {
  if (!replaceDuplicatesSearch(hunk.replace, hunk.search)) {
    return undefined;
  }
  const unique = extractUniqueCommentLines(hunk.replace, hunk.search);
  if (!unique) {
    return {
      search: selectedText,
      replace: selectedText
    };
  }
  const comment = indentCommentToSelection(unique, selectedText);
  return {
    search: selectedText,
    replace: `${comment}\n${selectedText}`
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
  commentOnly?: boolean;
}): PatchHunk | undefined {
  const selectedLines = options.selectedLines;
  const selectedText =
    (options.content && selectedLines
      ? selectionTextFromFile(options.content, selectedLines)
      : undefined) ||
    options.selectionText?.trimEnd() ||
    "";
  if (!selectedText.trim()) {
    return options.commentOnly ? coerceCommentOnlyHunk(options.hunk, options.hunk.search) : options.hunk;
  }
  if (options.commentOnly) {
    if (options.content && selectedLines) {
      const matches = findAllSearchMatches(options.content, options.hunk.search);
      const inside = matches.filter((hit) => rangesOverlap(hitLineRange(options.content!, hit), selectedLines));
      if (inside.length > 0) {
        if (hunkExpandsSelection(options.hunk, selectedText)) {
          return retargetOntoSelection(options.hunk, selectedText, true);
        }
        return coerceCommentOnlyHunk(options.hunk, selectedText);
      }
    } else if (options.hunk.search === selectedText) {
      return coerceCommentOnlyHunk(options.hunk, selectedText);
    }
    return retargetOntoSelection(options.hunk, selectedText, true);
  }
  if (options.content && selectedLines) {
    const matches = findAllSearchMatches(options.content, options.hunk.search);
    if (matches.length === 0) {
      return retargetOntoSelection(options.hunk, selectedText);
    }
    const inside = matches.filter((hit) => rangesOverlap(hitLineRange(options.content!, hit), selectedLines));
    if (inside.length > 0) {
      if (hunkExpandsSelection(options.hunk, selectedText)) {
        return retargetOntoSelection(options.hunk, selectedText);
      }
      return options.hunk;
    }
  } else if (options.hunk.search === selectedText) {
    if (hunkExpandsSelection(options.hunk, selectedText)) {
      return retargetOntoSelection(options.hunk, selectedText);
    }
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

export const COMMENT_ONLY_REWRITE_REJECTED_ERROR =
  "This edit asked for a comment only, but the patch rewrote the code. Nothing was changed. Ask again to add a comment above the highlighted lines — do not change the code.";

export function snapPatchSetToSelection(
  patches: ParsedPatchSet,
  options: {
    selectedLines?: LineRange;
    preferredFile?: string;
    selectionText?: string;
    commentOnly?: boolean;
    readContent: (relativePath: string) => string | undefined;
  }
): ParsedPatchSet {
  if (!options.selectedLines && !options.selectionText?.trim() && !options.commentOnly) {
    return patches;
  }
  const preferred = options.preferredFile?.replace(/\\/g, "/").replace(/^\.?\//, "");
  const onlyFile = patches.files.length === 1;
  return {
    files: patches.files
      .map((file) => {
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
        if (!content && !options.selectionText?.trim() && !options.commentOnly) {
          return file;
        }
        const hunks = file.hunks
          .map((hunk) =>
            snapHunkToSelection({
              content,
              selectionText: options.selectionText,
              hunk,
              selectedLines: options.selectedLines,
              commentOnly: options.commentOnly
            })
          )
          .filter((hunk): hunk is NonNullable<typeof hunk> => Boolean(hunk));
        return { relativePath: file.relativePath, hunks };
      })
      .filter((file) => file.hunks.length > 0)
  };
}

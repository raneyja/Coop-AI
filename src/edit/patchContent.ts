import type { PatchHunk } from "./patchParser";

export type ApplyHunkResult =
  | { ok: true; content: string }
  | { ok: false; error: string; reason: "not_found" | "ambiguous" };

type ParsedLine = {
  start: number;
  end: number;
  text: string;
};

type SearchMatch =
  | { ok: true; start: number; end: number; matched: string; fuzzy: boolean }
  | { ok: false; reason: "not_found" | "ambiguous" };

function parseLines(text: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length) {
      if (start < text.length || lines.length === 0) {
        lines.push({ start, end: i, text: text.slice(start, i) });
      }
      break;
    }
    if (text[i] === "\n") {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
      continue;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") {
      lines.push({ start, end: i, text: text.slice(start, i) });
      start = i + 2;
      i++;
    }
  }
  return lines;
}

function leadingWhitespace(line: string): string {
  const match = line.match(/^(\s*)/);
  return match?.[1] ?? "";
}

function trimLine(text: string): string {
  return text.trim();
}

function findFuzzyLineBlock(content: string, search: string): SearchMatch {
  const searchLines = parseLines(search);
  if (searchLines.length === 0 || searchLines.every((line) => trimLine(line.text) === "")) {
    return { ok: false, reason: "not_found" };
  }

  const normalizedSearch = searchLines.map((line) => trimLine(line.text));
  const contentLines = parseLines(content);
  const matches: number[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matchesBlock = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (trimLine(contentLines[i + j]!.text) !== normalizedSearch[j]) {
        matchesBlock = false;
        break;
      }
    }
    if (matchesBlock) {
      matches.push(i);
    }
  }

  if (matches.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }

  const startLine = matches[0]!;
  const first = contentLines[startLine]!;
  const last = contentLines[startLine + searchLines.length - 1]!;
  const matched = content.slice(first.start, last.end);
  return { ok: true, start: first.start, end: last.end, matched, fuzzy: true };
}

export function findSearchMatch(content: string, search: string): SearchMatch {
  if (!search) {
    return { ok: false, reason: "not_found" };
  }

  const exactIndex = content.indexOf(search);
  if (exactIndex !== -1) {
    const nextIndex = content.indexOf(search, exactIndex + 1);
    if (nextIndex !== -1) {
      return { ok: false, reason: "ambiguous" };
    }
    return {
      ok: true,
      start: exactIndex,
      end: exactIndex + search.length,
      matched: search,
      fuzzy: false
    };
  }

  return findFuzzyLineBlock(content, search);
}

function adjustReplaceIndent(replace: string, search: string, matched: string): string {
  const searchLines = parseLines(search);
  const matchedLines = parseLines(matched);
  const replaceLines = parseLines(replace);
  if (!searchLines.length || !matchedLines.length || !replaceLines.length) {
    return replace;
  }

  return replaceLines
    .map((line, idx) => {
      if (trimLine(line.text) === "") {
        return line.text;
      }
      const searchLine = searchLines[Math.min(idx, searchLines.length - 1)]!;
      const matchedLine = matchedLines[Math.min(idx, matchedLines.length - 1)]!;
      const searchLead = leadingWhitespace(searchLine.text);
      const matchedLead = leadingWhitespace(matchedLine.text);
      const lineLead = leadingWhitespace(line.text);

      if (line.text.startsWith(searchLead)) {
        return matchedLead + line.text.slice(searchLead.length);
      }

      const relativeIndent = lineLead.slice(searchLead.length);
      return matchedLead + relativeIndent + line.text.trimStart();
    })
    .join("\n");
}

export function applyHunkToContent(content: string, hunk: PatchHunk): ApplyHunkResult {
  const { search, replace } = hunk;
  const match = findSearchMatch(content, search);
  if (!match.ok) {
    const error =
      match.reason === "ambiguous"
        ? "SEARCH block matches multiple locations"
        : "SEARCH block not found in file";
    return { ok: false, error, reason: match.reason };
  }

  const nextContent =
    match.fuzzy && match.matched !== search
      ? adjustReplaceIndent(replace, search, match.matched)
      : replace;

  return {
    ok: true,
    content: content.slice(0, match.start) + nextContent + content.slice(match.end)
  };
}

export function applyHunksToContent(content: string, hunks: PatchHunk[]): ApplyHunkResult {
  let current = content;
  for (const hunk of hunks) {
    const result = applyHunkToContent(current, hunk);
    if (!result.ok) {
      return result;
    }
    current = result.content;
  }
  return { ok: true, content: current };
}

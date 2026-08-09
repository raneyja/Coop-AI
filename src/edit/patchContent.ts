import type { PatchHunk } from "./patchParser";

export type ApplyHunkResult =
  | { ok: true; content: string }
  | { ok: false; error: string; reason: "not_found" | "ambiguous" | "no_selection" };

export type SearchMatchHit = {
  start: number;
  end: number;
  matched: string;
  fuzzy: boolean;
};

export type SearchMatch =
  | { ok: true; start: number; end: number; matched: string; fuzzy: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "ambiguous"; matches: SearchMatchHit[] };

export type ApplyHunkOptions = {
  /**
   * When SEARCH matches multiple places, apply only these match indices (0-based).
   * Required for ambiguous SEARCH — empty/missing → no_selection / ambiguous error.
   */
  matchIndices?: readonly number[];
};

type ParsedLine = {
  start: number;
  end: number;
  text: string;
};

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

/**
 * Normalize trivial Python/JS self-kwargs (`request=request` → `request`) so a model that
 * drops keyword form still fuzzy-matches the live buffer.
 */
function normalizeLineForFuzzyCompare(text: string): string {
  return trimLine(text)
    .replace(/\b([A-Za-z_][\w]*)\s*=\s*\1\b/g, "$1")
    .replace(/\s+/g, " ");
}

function linesMatchFuzzy(a: string, b: string): boolean {
  const left = trimLine(a);
  const right = trimLine(b);
  if (left === right) {
    return true;
  }
  return normalizeLineForFuzzyCompare(left) === normalizeLineForFuzzyCompare(right);
}

function findExactMatches(content: string, search: string): SearchMatchHit[] {
  const hits: SearchMatchHit[] = [];
  let from = 0;
  while (from <= content.length) {
    const index = content.indexOf(search, from);
    if (index === -1) {
      break;
    }
    hits.push({
      start: index,
      end: index + search.length,
      matched: search,
      fuzzy: false
    });
    from = index + Math.max(search.length, 1);
  }
  return hits;
}

function findFuzzyLineMatches(content: string, search: string): SearchMatchHit[] {
  const searchLines = parseLines(search);
  if (searchLines.length === 0 || searchLines.every((line) => trimLine(line.text) === "")) {
    return [];
  }

  const contentLines = parseLines(content);
  const hits: SearchMatchHit[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matchesBlock = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (!linesMatchFuzzy(contentLines[i + j]!.text, searchLines[j]!.text)) {
        matchesBlock = false;
        break;
      }
    }
    if (matchesBlock) {
      const first = contentLines[i]!;
      const last = contentLines[i + searchLines.length - 1]!;
      hits.push({
        start: first.start,
        end: last.end,
        matched: content.slice(first.start, last.end),
        fuzzy: true
      });
    }
  }

  return hits;
}

/** All exact or fuzzy SEARCH matches in file order (never collapses ambiguous). */
export function findAllSearchMatches(content: string, search: string): SearchMatchHit[] {
  if (!search) {
    return [];
  }
  const exact = findExactMatches(content, search);
  if (exact.length > 0) {
    return exact;
  }
  return findFuzzyLineMatches(content, search);
}

export function findSearchMatch(content: string, search: string): SearchMatch {
  const matches = findAllSearchMatches(content, search);
  if (matches.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous", matches };
  }
  const only = matches[0]!;
  return {
    ok: true,
    start: only.start,
    end: only.end,
    matched: only.matched,
    fuzzy: only.fuzzy
  };
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

function replaceAtHit(content: string, hunk: PatchHunk, hit: SearchMatchHit): string {
  const nextContent =
    hit.fuzzy && hit.matched !== hunk.search
      ? adjustReplaceIndent(hunk.replace, hunk.search, hit.matched)
      : hunk.replace;
  return content.slice(0, hit.start) + nextContent + content.slice(hit.end);
}

type PlannedReplacement = {
  start: number;
  end: number;
  hunk: PatchHunk;
  hit: SearchMatchHit;
};

type PlanHunkResult =
  | { ok: true; ops: PlannedReplacement[] }
  | { ok: false; error: string; reason: "not_found" | "ambiguous" | "no_selection" };

function planHunkReplacements(
  content: string,
  hunk: PatchHunk,
  matchIndices?: readonly number[]
): PlanHunkResult {
  const matches = findAllSearchMatches(content, hunk.search);

  if (matches.length === 0) {
    return { ok: false, error: "SEARCH block not found in file", reason: "not_found" };
  }

  if (matches.length === 1) {
    return { ok: true, ops: [{ start: matches[0]!.start, end: matches[0]!.end, hunk, hit: matches[0]! }] };
  }

  if (!matchIndices || matchIndices.length === 0) {
    return {
      ok: false,
      error: "SEARCH block matches multiple locations — select where to apply",
      reason: "no_selection"
    };
  }

  const ops: PlannedReplacement[] = [];
  for (const index of [...new Set(matchIndices)]) {
    if (!Number.isInteger(index) || index < 0 || index >= matches.length) {
      continue;
    }
    const hit = matches[index]!;
    ops.push({ start: hit.start, end: hit.end, hunk, hit });
  }

  if (ops.length === 0) {
    return {
      ok: false,
      error: "SEARCH block matches multiple locations — select where to apply",
      reason: "no_selection"
    };
  }

  return { ok: true, ops };
}

function applyPlannedReplacements(content: string, ops: PlannedReplacement[]): ApplyHunkResult {
  const sorted = [...ops].sort((a, b) => b.start - a.start);
  let next = content;
  for (const op of sorted) {
    next = replaceAtHit(next, op.hunk, op.hit);
  }
  return { ok: true, content: next };
}

/**
 * Apply a hunk. For unique SEARCH, applies once. For ambiguous SEARCH, requires
 * `matchIndices` (one or more). Multiple indices are applied high-offset-first
 * so earlier offsets stay valid.
 */
export function applyHunkToContent(
  content: string,
  hunk: PatchHunk,
  options?: ApplyHunkOptions
): ApplyHunkResult {
  const planned = planHunkReplacements(content, hunk, options?.matchIndices);
  if (!planned.ok) {
    return planned;
  }
  return applyPlannedReplacements(content, planned.ops);
}

export type ApplyHunksOptions = {
  /** Per-hunk-index match selections (for ambiguous SEARCH). */
  matchIndicesByHunk?: { [hunkIndex: number]: readonly number[] };
};

/**
 * Apply hunks against the original buffer's match offsets, then splice
 * high-to-low. Prevents "Option 1 / L15" on a later hunk from silently
 * targeting a different line after an earlier hunk shifted indices.
 */
export function applyHunksToContent(
  content: string,
  hunks: PatchHunk[],
  options?: ApplyHunksOptions
): ApplyHunkResult {
  const allOps: PlannedReplacement[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const planned = planHunkReplacements(content, hunks[i]!, options?.matchIndicesByHunk?.[i]);
    if (!planned.ok) {
      return planned;
    }
    allOps.push(...planned.ops);
  }

  // Same file span cannot receive two different edits in one apply.
  const bySpan = new Map<string, PlannedReplacement>();
  for (const op of allOps) {
    const key = `${op.start}:${op.end}`;
    const existing = bySpan.get(key);
    if (existing && existing.hunk.replace !== op.hunk.replace) {
      return {
        ok: false,
        error: "Two edits target the same location — pick one change per place",
        reason: "ambiguous"
      };
    }
    if (!existing) {
      bySpan.set(key, op);
    }
  }

  return applyPlannedReplacements(content, [...bySpan.values()]);
}

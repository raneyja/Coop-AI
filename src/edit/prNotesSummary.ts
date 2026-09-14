/**
 * Cheap OpenAI mini summary for Create PR notes.
 * Comment-only / empty diffs skip the model (deterministic notes from +/- lines).
 * Fail-open: empty notes if the model errors or times out — never invent a refactor.
 */
import { getFeatureModelAssignment } from "../config/featureModelAssignments";
import type { LlmProviderPreference } from "../chat/types";

export const PR_NOTES_TIMEOUT_MS = 5000;
export const PR_NOTES_MAX_TOKENS = 500;
export const PR_NOTES_MAX_CHARS = 2200;
export const PR_TITLE_MAX_CHARS = 72;

export type PrNotesCompleteParams = {
  message: string;
  model: string;
  provider: LlmProviderPreference;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
};

export type PrNotesCompleteFn = (params: PrNotesCompleteParams) => Promise<string>;

export type PrNotesFileSection = {
  path: string;
  notes: string;
};

export type ParsedPrNotes = {
  title?: string;
  notes?: string;
};

export function resolvePrNotesModel(): { provider: LlmProviderPreference; model: string } {
  const assignment = getFeatureModelAssignment("prSummary");
  return {
    provider: assignment.provider,
    model: assignment.model
  };
}

export function prFileBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return (slash >= 0 ? normalized.slice(slash + 1) : normalized) || path;
}

function normalizePrPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
}

function uniqueFilePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const path = normalizePrPath(raw);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }
  return result;
}

/** First line of each compact diff section is the repo path. */
export function filePathsFromPrDiff(diff: string): string[] {
  const paths: string[] = [];
  for (const section of diff.split(/\n{2,}/)) {
    const first = section.split("\n")[0]?.trim() ?? "";
    if (!first || first.startsWith("+") || first.startsWith("-") || first.startsWith("(")) {
      continue;
    }
    if (/\s/.test(first) && !first.includes("/") && !first.includes("\\")) {
      continue;
    }
    paths.push(first);
  }
  return uniqueFilePaths(paths);
}

export function resolvePrNotesFiles(options: { files?: readonly string[]; diff: string }): string[] {
  const explicit = uniqueFilePaths(options.files ?? []);
  if (explicit.length > 0) {
    return explicit;
  }
  return filePathsFromPrDiff(options.diff);
}

export type PrDiffFileChanges = {
  path: string;
  added: string[];
  removed: string[];
};

export type PrDiffAnalysis = {
  files: PrDiffFileChanges[];
  /** True when the preview has no real +/- lines (empty, placeholder, path-only). */
  weakPreview: boolean;
  /** All non-blank +/- lines are comments; at least one comment changed. */
  commentOnly: boolean;
  hasImportChange: boolean;
  hasFunctionChange: boolean;
  /** Non-comment, non-blank +/- lines. */
  codeChangeCount: number;
};

const PLACEHOLDER_DIFF_LINE =
  /^\((?:no line preview|editor changes|no diff preview)\)$/i;

function stripCompactDiffMark(line: string): { kind: "add" | "remove"; text: string } | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return undefined;
  }
  if (/^\+(?:\s|$)/.test(line)) {
    return { kind: "add", text: line.replace(/^\+\s?/, "") };
  }
  if (/^-(?:\s|$)/.test(line)) {
    return { kind: "remove", text: line.replace(/^-\s?/, "") };
  }
  return undefined;
}

function isPrDiffPathHeader(line: string): boolean {
  const first = line.trim();
  if (!first || first.startsWith("+") || first.startsWith("-") || first.startsWith("(")) {
    return false;
  }
  if (/\s/.test(first) && !first.includes("/") && !first.includes("\\")) {
    return false;
  }
  return true;
}

/** Compact PR-notes diff: path header, then `+` / `-` lines (see compactPatchDiffForPrNotes). */
export function parseCompactPrDiff(diff: string): PrDiffFileChanges[] {
  const files: PrDiffFileChanges[] = [];
  for (const section of diff.split(/\n{2,}/)) {
    const rawLines = section.split("\n");
    const header = rawLines[0] ?? "";
    if (!isPrDiffPathHeader(header)) {
      continue;
    }
    const added: string[] = [];
    const removed: string[] = [];
    for (const line of rawLines.slice(1)) {
      if (PLACEHOLDER_DIFF_LINE.test(line.trim())) {
        continue;
      }
      const marked = stripCompactDiffMark(line);
      if (!marked) {
        continue;
      }
      if (marked.kind === "add") {
        added.push(marked.text);
      } else {
        removed.push(marked.text);
      }
    }
    files.push({ path: normalizePrPath(header), added, removed });
  }
  return files;
}

export function isCommentLine(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  return (
    t.startsWith("#") ||
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*/") ||
    /^\*(?:\s|$)/.test(t) ||
    t.startsWith("--") ||
    t.startsWith("<!--") ||
    t.startsWith("'''") ||
    t.startsWith('"""')
  );
}

function isImportLine(text: string): boolean {
  const t = text.trim();
  return /^(from\s+\S+\s+import\b|import\s+|export\s+\{|export\s+\*\s+from\b|require\s*\(|using\s+\w)/.test(
    t
  );
}

function isFunctionLine(text: string): boolean {
  const t = text.trim();
  return /^(export\s+|export\s+default\s+)?(async\s+)?(function\b|class\b|def\b|fn\b|func\b|pub\s+fn\b)/.test(
    t
  );
}

function contentLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.trim().length > 0);
}

export function analyzePrDiff(diff: string): PrDiffAnalysis {
  const files = parseCompactPrDiff(diff);
  const added = files.flatMap((file) => file.added);
  const removed = files.flatMap((file) => file.removed);
  const changed = contentLines([...added, ...removed]);
  const weakPreview = changed.length === 0;
  const commentLines = changed.filter(isCommentLine);
  const codeLines = changed.filter((line) => !isCommentLine(line));
  const commentOnly = changed.length > 0 && commentLines.length === changed.length;
  return {
    files,
    weakPreview,
    commentOnly,
    hasImportChange: codeLines.some(isImportLine),
    hasFunctionChange: codeLines.some(isFunctionLine),
    codeChangeCount: codeLines.length
  };
}

export function commentTextFromLine(text: string): string {
  return text
    .trim()
    .replace(/^<!--\s?/, "")
    .replace(/\s?-->$/, "")
    .replace(/^\/\*+\s?/, "")
    .replace(/\s?\*+\/$/, "")
    .replace(/^\/\/\s?/, "")
    .replace(/^#\s?/, "")
    .replace(/^--\s?/, "")
    .replace(/^\*\s?/, "")
    .replace(/^["']{3}\s?/, "")
    .replace(/\s?["']{3}$/, "")
    .trim();
}

const SHORT_QUOTE_MAX = 80;

function quoteShort(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SHORT_QUOTE_MAX || /\n/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function describeAddedLines(path: string, added: readonly string[], kind: "comment" | "line"): string {
  const quoted = added
    .map((line) => (kind === "comment" ? commentTextFromLine(line) : line.trim()))
    .map((line) => quoteShort(line))
    .filter((line): line is string => Boolean(line));
  const noun = kind === "comment" ? "comment" : "line";
  if (quoted.length === 1) {
    return `Adds a ${noun} in \`${path}\`: "${quoted[0]}".`;
  }
  if (quoted.length > 1) {
    return `Adds ${noun}s in \`${path}\`: ${quoted.map((line) => `"${line}"`).join(", ")}.`;
  }
  return `Adds a ${noun} in \`${path}\`.`;
}

function deterministicTitle(options: {
  files: readonly string[];
  fallback: string;
  commentOnly: boolean;
  quotes: readonly string[];
}): string | undefined {
  const names = options.files.map(prFileBasename).filter(Boolean);
  const first = names[0];
  const quote = options.quotes.length === 1 ? options.quotes[0] : undefined;
  let raw: string | undefined;
  if (options.commentOnly && first) {
    if (names.length === 1 && quote && quote.length <= 40) {
      raw = `Add "${quote}" comment in ${first}`;
    } else if (names.length === 1) {
      raw = `Add comment in ${first}`;
    } else {
      raw = `Add comments in ${names.slice(0, 3).join(", ")}`;
    }
  } else if (first && quote && names.length === 1 && quote.length <= 40) {
    raw = `Add "${quote}" in ${first}`;
  } else if (first && names.length === 1) {
    raw = `Update ${first}`;
  }
  return sanitizePrTitle(raw, { fallback: options.fallback, files: options.files });
}

/** Honest notes from the actual +/- lines — no model. */
export function buildDeterministicPrNotes(options: {
  title: string;
  diff: string;
  files?: readonly string[];
}): ParsedPrNotes {
  const files = resolvePrNotesFiles({ files: options.files, diff: options.diff });
  const analysis = analyzePrDiff(options.diff);
  const byPath = new Map(analysis.files.map((file) => [normalizePrPath(file.path), file]));

  if (analysis.commentOnly) {
    const sections: PrNotesFileSection[] = (files.length > 0 ? files : analysis.files.map((file) => file.path)).map(
      (path) => {
        const normalized = normalizePrPath(path);
        const added = contentLines(byPath.get(normalized)?.added ?? []).filter(isCommentLine);
        return { path: normalized, notes: describeAddedLines(normalized, added, "comment") };
      }
    );
    const quotes = sections.flatMap((section) => {
      const added = contentLines(byPath.get(normalizePrPath(section.path))?.added ?? []).filter(isCommentLine);
      return added
        .map(commentTextFromLine)
        .map(quoteShort)
        .filter((line): line is string => Boolean(line));
    });
    const body =
      sections.length <= 1
        ? (sections[0]?.notes ?? "")
        : formatPrNotesBody({
            summary: `Adds comments in ${sections.length} files.`,
            files: sections
          });
    return {
      title: deterministicTitle({
        files: sections.map((section) => section.path),
        fallback: options.title,
        commentOnly: true,
        quotes
      }),
      notes: sanitizePrNotes(body)
    };
  }

  if (!analysis.weakPreview) {
    const paths = files.length > 0 ? files : analysis.files.map((file) => file.path);
    const sections: PrNotesFileSection[] = paths.map((path) => {
      const normalized = normalizePrPath(path);
      const added = contentLines(byPath.get(normalized)?.added ?? []);
      const notes =
        added.length > 0
          ? describeAddedLines(normalized, added, "line")
          : `Updates \`${normalized}\`.`;
      return { path: normalized, notes };
    });
    const quotes = analysis.files.flatMap((file) =>
      contentLines(file.added)
        .map((line) => quoteShort(line.trim()))
        .filter((line): line is string => Boolean(line))
    );
    const body =
      sections.length <= 1
        ? (sections[0]?.notes ?? "")
        : formatPrNotesBody({
            summary: `Updates ${sections.length} files.`,
            files: sections
          });
    return {
      title: deterministicTitle({
        files: paths,
        fallback: options.title,
        commentOnly: false,
        quotes
      }),
      notes: sanitizePrNotes(body)
    };
  }

  if (files.length === 1) {
    const path = normalizePrPath(files[0]);
    return {
      title: sanitizePrTitle(options.title, { fallback: `Update ${prFileBasename(path)}`, files }),
      notes: sanitizePrNotes(`Updates \`${path}\`.`)
    };
  }
  if (files.length > 1) {
    return {
      title: sanitizePrTitle(options.title, { files }),
      notes: sanitizePrNotes(`Updates ${files.length} files.`)
    };
  }
  return {
    title: sanitizePrTitle(options.title, { files }),
    notes: undefined
  };
}

const HALLUCINATED_IMPORTS_RE =
  /\boptimiz(?:e|ed|ing)\s+imports?\b|\boptimized import\b|\bstreamline(?:d|s)? dependencies\b/i;
const HALLUCINATED_REFACTOR_RE =
  /\breadability\b|\bcode structure\b|\brefactor(?:ed|ing|s)?\b|\bmaintainability\b|\benhance(?:s|d)? performance\b|\bimproved inline documentation\b/i;

/**
 * True when notes claim a refactor / readability / import cleanup the diff does not show.
 */
export function prNotesInventUnsupportedChanges(notes: string, analysis: PrDiffAnalysis): boolean {
  const text = notes.trim();
  if (!text) {
    return false;
  }
  const claimsImports = HALLUCINATED_IMPORTS_RE.test(text);
  const claimsRefactor = HALLUCINATED_REFACTOR_RE.test(text);
  if (!claimsImports && !claimsRefactor) {
    return false;
  }
  if (analysis.commentOnly || analysis.weakPreview) {
    return true;
  }
  if (claimsImports && !analysis.hasImportChange) {
    return true;
  }
  if (claimsRefactor && !analysis.hasFunctionChange && analysis.codeChangeCount < 4) {
    return true;
  }
  return false;
}

function shouldSkipPrNotesLlm(analysis: PrDiffAnalysis): boolean {
  return analysis.commentOnly || analysis.weakPreview;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWeakPrTitle(title: string, files: readonly string[] = []): boolean {
  if (/^coop patch$/i.test(title) || /^update \d+ files\b/i.test(title)) {
    return true;
  }
  const names = files.map(prFileBasename).filter(Boolean);
  if (names.some((name) => new RegExp(`^update ${escapeRegExp(name)}$`, "i").test(title))) {
    return true;
  }
  if (files.some((path) => title.replace(/\\/g, "/") === `Update ${path}`)) {
    return true;
  }
  return false;
}

export function sanitizePrTitle(
  raw: string | undefined,
  options?: { fallback?: string; files?: readonly string[] }
): string | undefined {
  const cleaned = (raw ?? "")
    .replace(/^\s*title:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();
  if (cleaned.length < 8 || isWeakPrTitle(cleaned, options?.files)) {
    return options?.fallback?.trim() || undefined;
  }
  if (cleaned.length <= PR_TITLE_MAX_CHARS) {
    return cleaned;
  }
  const sliced = cleaned.slice(0, PR_TITLE_MAX_CHARS - 1);
  const cut = sliced.lastIndexOf(" ");
  return `${(cut >= 24 ? sliced.slice(0, cut) : sliced).trimEnd()}…`;
}

export function formatPrNotesBody(options: {
  summary?: string;
  files: readonly PrNotesFileSection[];
}): string {
  const summary = options.summary?.trim() ?? "";
  const files = options.files.filter((file) => file.path.trim());
  if (files.length <= 1) {
    const fileNotes = files[0]?.notes.trim() ?? "";
    const path = files[0]?.path.trim();
    const parts = [summary, fileNotes].filter(Boolean);
    if (parts.length === 0) {
      return "";
    }
    if (parts.length === 1 && path && !parts[0].includes(path) && !parts[0].includes(prFileBasename(path))) {
      return `${parts[0]}\n\n\`${path}\``;
    }
    return parts.join("\n\n");
  }

  const lines: string[] = [];
  if (summary) {
    lines.push("## Summary", summary);
  } else {
    lines.push(
      "## Summary",
      `This pull request updates ${files.length} files.`
    );
  }
  for (const file of files) {
    const path = normalizePrPath(file.path);
    const base = prFileBasename(path);
    lines.push("", `## ${base}`);
    if (base !== path) {
      lines.push(`\`${path}\``);
    }
    const notes = file.notes.trim();
    lines.push(notes || "See Summary.");
  }
  return lines.join("\n").trim();
}

function asFileSections(value: unknown): PrNotesFileSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const notes =
      typeof record.notes === "string"
        ? record.notes
        : typeof record.change === "string"
          ? record.change
          : "";
    return path ? [{ path, notes }] : [];
  });
}

function matchFileSections(
  requested: readonly string[],
  fromModel: readonly PrNotesFileSection[]
): PrNotesFileSection[] {
  if (requested.length === 0) {
    return [...fromModel];
  }
  return requested.map((path) => {
    const normalized = normalizePrPath(path);
    const exact = fromModel.find((file) => normalizePrPath(file.path) === normalized);
    if (exact) {
      return { path: normalized, notes: exact.notes };
    }
    const base = prFileBasename(normalized);
    const byBase = fromModel.find((file) => prFileBasename(file.path) === base);
    return { path: normalized, notes: byBase?.notes ?? "" };
  });
}

function stripFence(raw: string): string {
  return raw
    .replace(/^\s*```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  const cleaned = stripFence(raw);
  const tryParse = (text: string): Record<string, unknown> | undefined => {
    try {
      const value = JSON.parse(text) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      /* not JSON */
    }
    return undefined;
  };
  const direct = tryParse(cleaned);
  if (direct) {
    return direct;
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(cleaned.slice(start, end + 1));
  }
  return undefined;
}

function hasFileHeadings(notes: string, files: readonly string[]): boolean {
  if (!/^#{1,3}\s+/m.test(notes)) {
    return false;
  }
  return files.some((path) => {
    const base = prFileBasename(path);
    return notes.includes(base) || notes.includes(path);
  });
}

export function parsePrNotesResponse(
  raw: string,
  options: { files?: readonly string[]; fallbackTitle?: string } = {}
): ParsedPrNotes {
  const files = uniqueFilePaths(options.files ?? []);
  const json = extractJsonObject(raw);
  if (json) {
    const title = sanitizePrTitle(typeof json.title === "string" ? json.title : undefined, {
      fallback: options.fallbackTitle,
      files
    });
    const summary = typeof json.summary === "string" ? json.summary : undefined;
    const notes = sanitizePrNotes(
      formatPrNotesBody({
        summary,
        files: matchFileSections(files, asFileSections(json.files))
      })
    );
    return { title, notes };
  }

  let text = stripFence(raw);
  let title: string | undefined;
  const titleLine = text.match(/^title:\s*(.+)\s*$/im);
  if (titleLine && titleLine.index === 0) {
    title = sanitizePrTitle(titleLine[1], { fallback: options.fallbackTitle, files });
    text = text.slice(titleLine[0].length).trim();
  } else {
    title = sanitizePrTitle(undefined, { fallback: options.fallbackTitle, files });
  }
  if (files.length >= 2 && text && !hasFileHeadings(text, files)) {
    text = formatPrNotesBody({
      summary: text,
      files: files.map((path) => ({ path, notes: "" }))
    });
  }
  return { title, notes: sanitizePrNotes(text) };
}

export function buildPrNotesUserMessage(options: {
  title: string;
  diff: string;
  files?: readonly string[];
}): string {
  const files = resolvePrNotesFiles({ files: options.files, diff: options.diff });
  const fileList =
    files.length > 0 ? files.map((path) => `- ${path}`).join("\n") : "- (see Diff)";
  const multi = files.length > 1;
  return [
    "Write pull request notes a reviewer can scan in 10 seconds.",
    "Reply with JSON only (no markdown fence):",
    "{",
    '  "title": "imperative, ≤72 chars, what changed",',
    '  "summary": "1–2 sentences covering every file",',
    '  "files": [{ "path": "exact path from Files", "notes": "what this file now does differently" }]',
    "}",
    "Rules:",
    "- Title: what changed, not 'Update N files' or a raw path. No trailing period.",
    multi
      ? "- Include one files[] entry for every path in Files. Do not merge two files into one entry."
      : "- Include the one file in files[].",
    "- File notes: concrete behavior a reviewer would verify. No 'improved readability' or 'refactored for clarity'.",
    "- Quote added comments verbatim. Never claim a refactor, readability improvement, optimized imports, or improved structure unless those lines appear in Diff.",
    "- If Diff is missing or has no +/- lines, do not invent a story.",
    "- Do not invent tickets, reviewers, tests, or motivation missing from the diff.",
    `- Keep the JSON under ${PR_NOTES_MAX_CHARS} characters.`,
    `Fallback title: ${options.title.trim() || "Coop patch"}`,
    "",
    "Files:",
    fileList,
    "",
    "Diff:",
    options.diff.trim().slice(0, 4000) || "(no diff preview)"
  ].join("\n");
}

export function sanitizePrNotes(raw: string): string | undefined {
  const cleaned = stripFence(raw).replace(/^["']|["']$/g, "").trim();
  if (!cleaned || cleaned.length < 12) {
    return undefined;
  }
  if (cleaned.length > PR_NOTES_MAX_CHARS) {
    return `${cleaned.slice(0, PR_NOTES_MAX_CHARS - 1).trimEnd()}…`;
  }
  return cleaned;
}

export async function summarizePrNotes(options: {
  title: string;
  diff: string;
  files?: readonly string[];
  complete: PrNotesCompleteFn;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ParsedPrNotes | undefined> {
  if (!options.diff.trim() && !options.title.trim()) {
    return undefined;
  }

  const files = resolvePrNotesFiles({ files: options.files, diff: options.diff });
  const analysis = analyzePrDiff(options.diff);
  if (shouldSkipPrNotesLlm(analysis)) {
    const deterministic = buildDeterministicPrNotes({
      title: options.title,
      diff: options.diff,
      files
    });
    if (!deterministic.notes && !deterministic.title) {
      return undefined;
    }
    return deterministic;
  }

  const timeoutMs = options.timeoutMs ?? PR_NOTES_TIMEOUT_MS;
  const model = resolvePrNotesModel();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = combineAbortSignals(options.signal, timeoutController.signal);

  try {
    const raw = await options.complete({
      message: buildPrNotesUserMessage({
        title: options.title,
        diff: options.diff,
        files
      }),
      model: model.model,
      provider: model.provider,
      maxTokens: PR_NOTES_MAX_TOKENS,
      temperature: 0.2,
      signal
    });
    const parsed = parsePrNotesResponse(raw, { files, fallbackTitle: options.title });
    const titleHallucinated = Boolean(
      parsed.title && prNotesInventUnsupportedChanges(parsed.title, analysis)
    );
    const notesHallucinated = Boolean(
      parsed.notes && prNotesInventUnsupportedChanges(parsed.notes, analysis)
    );
    if (notesHallucinated || titleHallucinated) {
      const deterministic = buildDeterministicPrNotes({
        title: options.title,
        diff: options.diff,
        files
      });
      if (notesHallucinated && !deterministic.notes) {
        return parsed.title && !titleHallucinated ? { title: parsed.title } : undefined;
      }
      return {
        title: titleHallucinated ? deterministic.title : parsed.title ?? deterministic.title,
        notes: notesHallucinated ? deterministic.notes : parsed.notes ?? deterministic.notes
      };
    }
    if (!parsed.notes && !parsed.title) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineAbortSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) {
    return b;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }
  const combined = new AbortController();
  const forward = () => combined.abort();
  if (a.aborted || b.aborted) {
    combined.abort();
    return combined.signal;
  }
  a.addEventListener("abort", forward, { once: true });
  b.addEventListener("abort", forward, { once: true });
  return combined.signal;
}

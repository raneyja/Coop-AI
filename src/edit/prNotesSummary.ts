/**
 * Cheap OpenAI mini summary for Create PR notes.
 * Fail-open: empty notes if the model errors or times out.
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

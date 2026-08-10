/**
 * Universal Sources expand policy helpers.
 *
 * Product law for every Sources / evidence card (Trace, Blast, Owner, Gaps,
 * Understand, integrations):
 * - Expanded panels show a short overview/preview only — never full commit,
 *   PR, Slack, or **file** bodies.
 * - Always prefer an outbound / Open file link for the deep read.
 * - Prefer AI overview when present; fail open to a deterministic excerpt.
 */

export const EVIDENCE_PREVIEW_MAX_CHARS = 360;
export const EVIDENCE_PREVIEW_MAX_LINES = 4;
/** Bodies shorter than this stay as-is (subject + tiny body) without an AI call. */
export const EVIDENCE_PREVIEW_AI_MIN_CHARS = 280;

/** First line / subject of a commit-style message. */
export function evidenceSubjectLine(text: string): string {
  const first = (text.split(/\r?\n/, 1)[0] ?? "").replace(/\s+/g, " ").trim();
  return first.slice(0, 200);
}

/**
 * Deterministic short preview for Sources expands.
 * Subject + up to a few following lines, hard-capped.
 */
export function buildDeterministicEvidencePreview(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return "";
  }
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const subject = lines[0] ?? "";
  const rest = lines.slice(1, EVIDENCE_PREVIEW_MAX_LINES);
  const joined = [subject, ...rest].join("\n").trim();
  if (joined.length <= EVIDENCE_PREVIEW_MAX_CHARS) {
    return joined;
  }
  return `${joined.slice(0, EVIDENCE_PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

/** Resolve what the expanded panel should show. */
export function resolveEvidenceBodyPreview(options: {
  overview?: string;
  rawText?: string;
}): string {
  const overview = options.overview?.trim();
  if (overview) {
    return overview.length <= EVIDENCE_PREVIEW_MAX_CHARS
      ? overview
      : `${overview.slice(0, EVIDENCE_PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
  }
  return buildDeterministicEvidencePreview(options.rawText ?? "");
}

export function shouldRequestEvidenceAiPreview(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length < EVIDENCE_PREVIEW_AI_MIN_CHARS) {
    return false;
  }
  // Multi-line or oversized single-line bodies benefit from AI.
  return trimmed.includes("\n") || trimmed.length >= EVIDENCE_PREVIEW_AI_MIN_CHARS;
}

/** Max lines shown in Sources “Code under investigation” expand. */
export const CODE_SNIPPET_PREVIEW_MAX_LINES = 16;

/**
 * Short code preview for Sources expands — never dump a whole file.
 * Prefers a window around a named symbol / class; else the first N lines.
 */
export function buildCodeSnippetPreview(
  snippet: string,
  options?: { focusTerms?: string[]; maxLines?: number }
): { preview: string; truncated: boolean; startLine: number } {
  const maxLines = options?.maxLines ?? CODE_SNIPPET_PREVIEW_MAX_LINES;
  const normalized = snippet.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) {
    return { preview: normalized.trimEnd(), truncated: false, startLine: 1 };
  }

  const focus = (options?.focusTerms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);

  let anchor = -1;
  for (const term of focus) {
    const classHit = lines.findIndex((line) =>
      new RegExp(`\\b(class|type|interface|enum|def|function)\\s+${escapeRegExp(term)}\\b`).test(line)
    );
    if (classHit >= 0) {
      anchor = classHit;
      break;
    }
    const anyHit = lines.findIndex((line) =>
      new RegExp(`\\b${escapeRegExp(term)}\\b`).test(line)
    );
    if (anyHit >= 0) {
      anchor = anyHit;
      break;
    }
  }

  if (anchor < 0) {
    // Prefer first type/class definition over license header when possible.
    const defHit = lines.findIndex((line) =>
      /^\s*(export\s+)?(class|type|interface|enum|def|function)\b/.test(line)
    );
    anchor = defHit >= 0 ? defHit : 0;
  }

  const half = Math.floor(maxLines / 2);
  let start = Math.max(0, anchor - Math.min(4, half));
  let end = start + maxLines;
  if (end > lines.length) {
    end = lines.length;
    start = Math.max(0, end - maxLines);
  }
  const slice = lines.slice(start, end);
  const preview = slice.join("\n").trimEnd();
  return {
    preview: preview.length > 1200 ? `${preview.slice(0, 1199).trimEnd()}…` : preview,
    truncated: true,
    startLine: start + 1
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

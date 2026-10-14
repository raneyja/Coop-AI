/** Canonical browser-safe citation locator parsing shared by maintained chat surfaces. */

export type CodeCitationLocator = {
  path: string;
  /** Present when the model emitted real line integers. */
  startLine?: number;
  endLine?: number;
};

const NUMERIC_LOCATOR_RE = /^(\d+):(\d+):(.+)$/;
/** Models sometimes paste the prompt template literally. */
const PLACEHOLDER_LOCATOR_RE =
  /^(?:startLine|start)\s*:\s*(?:endLine|end)\s*:\s*(.+)$/i;
/**
 * Cursor path:range form — `apps/web/foo.tsx:4-14` (not `start:end:path`).
 */
const PATH_RANGE_LOCATOR_RE = /^(.+):(\d+)-(\d+)$/;
/** `apps/web/foo.tsx:42` */
const PATH_LINE_LOCATOR_RE = /^(.+):(\d+)$/;
/**
 * First-line path-only locators (no line range).
 * Requires a slash and a file extension so prose sentences do not match.
 */
const PATH_ONLY_LOCATOR_RE =
  /^(?:\.\/)?(?:[\w.@+-]+\/)+[\w.@+-]+\.[A-Za-z0-9]{1,12}$/;

const LANGUAGE_TAG_RE = /^[A-Za-z][A-Za-z0-9_+#-]*$/;

/** Models often tag TypeScript as javascript (and vice versa). */

/** Fences that must stay anonymous / edit — never upgrade to cite via active file. */

export function looksLikeRepoFilePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || /\s/.test(trimmed) || /^\d+\s*\|/.test(trimmed)) {
    return false;
  }
  // `.dockerignore` globs and ignore patterns are not repo paths.
  if (/[*?[\]]/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("http:") || trimmed.startsWith("https:")) {
    return false;
  }
  // `4:14:apps/foo.tsx` is a locator, not a path.
  if (/^\d+:\d+:/.test(trimmed)) {
    return false;
  }
  return PATH_ONLY_LOCATOR_RE.test(trimmed) || /\/[^/]+\.[A-Za-z0-9]{1,12}$/.test(trimmed);
}

function unwrapLocatorText(value: string): string {
  let trimmed = value.trim().replace(/[.,;:]+$/, "").trim();
  const bold = trimmed.match(/^\*\*(.+)\*\*$/);
  if (bold) {
    trimmed = bold[1]!.trim();
  }
  const tick = trimmed.match(/^`([^`]+)`$/);
  if (tick) {
    trimmed = tick[1]!.trim();
  }
  const comment = trimmed.match(/^(?:\/\/|#)\s+(.*)$/);
  if (comment) {
    trimmed = comment[1]!.trim();
  }
  return trimmed.replace(/[.,;:]+$/, "").trim();
}

/** Explicit coordinates admit any clean file name; bare prose inference stays narrow. */
function isExplicitFilePath(path: string): boolean {
  if (!path || path !== path.trim() || /[\u0000-\u001f\u007f:*?\[\]`|\\]/.test(path)) return false;
  const normalized = path.replace(/^\.\//, "").replace(/^\//, "");
  return normalized.split("/").every(segment => Boolean(segment) && segment !== "." && segment !== "..");
}

function locatorFromPathAndLines(
  path: string,
  startRaw: string,
  endRaw?: string
): CodeCitationLocator | null {
  // Explicit line coordinates disambiguate root files from ordinary prose.
  // Keep bare path inference slash-only so a domain is never a source label.
  if (!isExplicitFilePath(path)) {
    return null;
  }
  const startLine = Number(startRaw);
  const endLine = endRaw == null || endRaw === "" ? startLine : Number(endRaw);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) {
    return null;
  }
  return { startLine, endLine, path: path.replace(/^\.\//, "") };
}

function parseLocatorCore(trimmed: string): CodeCitationLocator | null {
  if (!trimmed) {
    return null;
  }
  if (LANGUAGE_TAG_RE.test(trimmed) && !trimmed.includes("/")) {
    return null;
  }

  const numeric = trimmed.match(NUMERIC_LOCATOR_RE);
  if (numeric) {
    return locatorFromPathAndLines(numeric[3]!.trim(), numeric[1]!, numeric[2]);
  }

  const placeholder = trimmed.match(PLACEHOLDER_LOCATOR_RE);
  if (placeholder) {
    const path = placeholder[1]!.trim();
    if (!looksLikeRepoFilePath(path)) {
      return null;
    }
    return { path: path.replace(/^\.\//, "") };
  }

  const pathRange = trimmed.match(PATH_RANGE_LOCATOR_RE);
  if (pathRange) {
    return locatorFromPathAndLines(pathRange[1]!.trim(), pathRange[2]!, pathRange[3]);
  }

  const pathLine = trimmed.match(PATH_LINE_LOCATOR_RE);
  if (pathLine) {
    return locatorFromPathAndLines(pathLine[1]!.trim(), pathLine[2]!);
  }

  if (looksLikeRepoFilePath(trimmed)) {
    return { path: trimmed.replace(/^\.\//, "") };
  }

  return null;
}

/**
 * Parse a citation locator from a fence info-string, first body line, or a
 * prose line sitting above a fence (`4:14:path` / `path:4-14`).
 * Returns null when the value is an ordinary language tag or unrelated text.
 */
export function tryParseCitationLocator(value: string): CodeCitationLocator | null {
  const trimmed = unwrapLocatorText(value);
  if (!trimmed) {
    return null;
  }
  return parseLocatorCore(trimmed);
}

/** A malformed explicit locator must never borrow a nearby source label. */
export function isMalformedCitationLocator(value: string): boolean {
  const text = unwrapLocatorText(value).replace(/^([A-Za-z][A-Za-z0-9_+#-]*)\s+/, "");
  const pathCoordinate = text.match(/^(.+):\d+(?:-\d+)?$/);
  const path = pathCoordinate?.[1] ?? "";
  const explicitPath = isExplicitFilePath(path);
  return (/^\d+:\d+:.+/.test(text) || Boolean(pathCoordinate && explicitPath)) && !tryParseCitationLocator(text);
}

/**
 * Fence info-string locators, including `tsx 4:14:path` / `typescript path`.
 * Do not use on prose — words like "See" match the language-tag pattern.
 */
export function tryParseFenceInfoLocator(value: string): CodeCitationLocator | null {
  const trimmed = unwrapLocatorText(value);
  if (!trimmed) {
    return null;
  }
  const direct = parseLocatorCore(trimmed);
  if (direct) {
    return direct;
  }
  const langPrefixed = trimmed.match(/^([A-Za-z][A-Za-z0-9_+#-]*)\s+(.+)$/);
  if (langPrefixed && LANGUAGE_TAG_RE.test(langPrefixed[1]!) && !langPrefixed[1]!.includes("/")) {
    return parseLocatorCore(unwrapLocatorText(langPrefixed[2]!));
  }
  return null;
}

/** Whole-line locator (optional wrapping backticks / bold / File: prefix). List markers do not count. */
export function locatorFromProseLine(line: string): CodeCitationLocator | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
    return null;
  }
  const filePrefixed = trimmed.match(/^File:\s+(.+)$/i);
  if (filePrefixed) {
    return tryParseCitationLocator(filePrefixed[1]!);
  }
  return tryParseCitationLocator(trimmed);
}

/** Numeric / path:range locators are unambiguous even without a wrapping fence. */
/** Shared bounded body scan for rendering, grounding, and source extraction. */
/** Stop metadata recovery once the fence has entered source code. */
function* citationPreamble(body: string[]): Generator<{ line: string; index: number }> {
  for (let index = 0; index < Math.min(body.length, 6); index++) {
    const line = body[index]!;
    if (/^\s*\d+\s*\|/.test(line)) break;
    // An explicit locator can name arbitrary clean files. Unambiguous declarations
    // and opening delimiters end the preamble so integer object properties remain code.
    if (!tryParseCitationLocator(line) && !isMalformedCitationLocator(line) && /^\s*(?:(?:export\s+)?(?:const|let|var|function|class)\s|(?:async\s+)?def\s|[\[({]\s*$)/.test(line)) break;
    yield { line, index };
  }
}

/** Inspect the same preamble window without treating source tails as metadata. */
export function hasMalformedCitationInFenceBody(body: string[]): boolean {
  return [...citationPreamble(body)].some(({ line }) => isMalformedCitationLocator(line));
}

export function citationLocatorInFenceBody(body: string[]): { locator: CodeCitationLocator; codeStart: number } | null {
  for (const { line, index } of citationPreamble(body)) {
    const locator = locatorFromProseLine(line) ?? tryParseCitationLocator(line.trim());
    if (locator) return { locator, codeStart: index + 1 };
  }
  return null;
}

/** Recover numbered read_file rows with an explicit trailing `: path` label.
 * Split omitted source lines into separate citations so gutters remain truthful.
 * This only recovers syntax; grounding still verifies each slice against source.
 */
export function normalizeNumberedCitationFences(markdown: string, policy: {
  shouldNeverUpgradeLanguageFence: (language: string | undefined) => boolean;
  isOrdinaryLanguageTag: (language: string | undefined) => boolean;
}): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i]!.match(/^\s*```(.*)$/);
    if (!opening) {
      out.push(lines[i]!);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && !/^\s*```/.test(lines[end]!)) end++;
    const original = lines.slice(i, Math.min(end + 1, lines.length));
    const info = opening[1]!.trim();
    const body = lines.slice(i + 1, end);
    while (body.at(-1)?.trim() === "") body.pop();
    const label = body.at(-1)?.match(/^\s*:\s*(.+?)\s*$/);
    const rows = body.slice(0, -1).map(line => line.match(/^\s*(\d+)(\s*)\|(.*)$/));
    const validRows = rows.length > 0 && rows.every((row, index) => row &&
      Number.isSafeInteger(Number(row[1])) && Number(row[1]) > 0 &&
      (index === 0 || Number(row[1]) > Number(rows[index - 1]![1])));
    // A footer has no explicit coordinates of its own; retain its narrow
    // legacy file-label inference instead of interpreting prose as a path.
    const labelPath = label ? unwrapLocatorText(label[1]!) : "";
    const fileLabel = looksLikeRepoFilePath(labelPath) || /^(?:\.\/)?(?:[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,12}|\.[\w.-]+|Dockerfile|Makefile)$/.test(labelPath);
    const locator = label && validRows && fileLabel
      ? tryParseCitationLocator(`${rows[0]![1]}:${rows.at(-1)![1]}:${labelPath}`)
      : null;
    if (end === lines.length || !locator || tryParseFenceInfoLocator(info) ||
        isMalformedCitationLocator(info) || policy.shouldNeverUpgradeLanguageFence(info) ||
        (info && !policy.isOrdinaryLanguageTag(info))) {
      out.push(...original);
    } else {
      let start = 0;
      while (start < rows.length) {
        let stop = start + 1;
        while (stop < rows.length && Number(rows[stop]![1]) === Number(rows[stop - 1]![1]) + 1) stop++;
        out.push(`\`\`\`${rows[start]![1]}:${rows[stop - 1]![1]}:${locator.path}`);
        for (const row of rows.slice(start, stop)) {
          // `N|source` is read_file's exact format. `N | source` adds a separator space.
          out.push(row![2] && row![3]!.startsWith(" ") ? row![3]!.slice(1) : row![3]!);
        }
        out.push("```");
        start = stop;
      }
    }
    i = end;
  }
  return out.join("\n");
}

export function isUnfencedCitationStartLine(line: string): boolean {
  const locator = locatorFromProseLine(line);
  return locator != null && locator.startLine != null;
}

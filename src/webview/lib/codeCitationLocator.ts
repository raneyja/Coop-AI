/**
 * Shared citation-locator parsing for chat prose fences.
 * Keep in sync with admin/website copies (see chat-code-surfaces rule).
 */

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
const JS_TS_FAMILY = new Set([
  "javascript",
  "typescript",
  "js",
  "ts",
  "jsx",
  "tsx",
  "mjs",
  "cjs",
  "node"
]);

/** Fences that must stay anonymous / edit — never upgrade to cite via active file. */
const NEVER_UPGRADE_LANGS = new Set([
  "patch",
  "diff",
  "bash",
  "sh",
  "shell",
  "zsh",
  "powershell",
  "ps1",
  "console",
  "text",
  "plaintext",
  "markdown",
  "md",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "dockerfile",
  "makefile",
  "sql"
]);

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

function locatorFromPathAndLines(
  path: string,
  startRaw: string,
  endRaw?: string
): CodeCitationLocator | null {
  // Explicit line coordinates disambiguate root files from ordinary prose.
  // Keep bare path inference slash-only so a domain is never a source label.
  if (!looksLikeRepoFilePath(path) && !/^(?:\.\/)?(?:[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,12}|\.[\w.-]+|Dockerfile|Makefile)$/.test(path)) {
    return null;
  }
  const startLine = Number(startRaw);
  const endLine = endRaw == null || endRaw === "" ? startLine : Number(endRaw);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine < 1 || endLine < startLine) {
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
  const explicitPath = looksLikeRepoFilePath(path) || /^(?:\.\/)?(?:[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,12}|\.[\w.-]+|Dockerfile|Makefile)$/.test(path);
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
/** Inspect the same preamble window without treating numbered source tails as metadata. */
export function hasMalformedCitationInFenceBody(body: string[]): boolean {
  for (const line of body.slice(0, 6)) {
    if (/^\s*\d+\s*\|/.test(line)) return false;
    if (isMalformedCitationLocator(line)) return true;
  }
  return false;
}

export function citationLocatorInFenceBody(body: string[]): { locator: CodeCitationLocator; codeStart: number } | null {
  for (let i = 0; i < Math.min(body.length, 6); i++) {
    // read_file rows contain source, including path literals, not locators.
    if (/^\s*\d+\s*\|/.test(body[i] ?? "")) break;
    const locator = locatorFromProseLine(body[i] ?? "") ?? tryParseCitationLocator((body[i] ?? "").trim());
    if (locator) return { locator, codeStart: i + 1 };
  }
  return null;
}

/** Recover numbered read_file rows with an explicit trailing `: path` label.
 * Split omitted source lines into separate citations so gutters remain truthful.
 * This only recovers syntax; grounding still verifies each slice against source.
 */
export function normalizeNumberedCitationFences(markdown: string): string {
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
    const locator = label && validRows
      ? tryParseCitationLocator(`${rows[0]![1]}:${rows.at(-1)![1]}:${unwrapLocatorText(label[1]!)}`)
      : null;
    if (end === lines.length || !locator || tryParseFenceInfoLocator(info) ||
        isMalformedCitationLocator(info) || shouldNeverUpgradeLanguageFence(info) ||
        (info && !isOrdinaryLanguageTag(info))) {
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

/** Infer highlight language from a file path extension. */
export function languageFromFilePath(path: string): string | undefined {
  const fileName = path.split("/").filter(Boolean).pop() ?? path;
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!ext) {
    return undefined;
  }
  if (ext === "ts" || ext === "tsx") {
    return "typescript";
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return "javascript";
  }
  if (ext === "py" || ext === "pyi") {
    return "python";
  }
  if (ext === "json" || ext === "jsonc") {
    return "json";
  }
  if (ext === "rs") {
    return "rust";
  }
  if (ext === "go") {
    return "go";
  }
  if (ext === "rb") {
    return "ruby";
  }
  if (ext === "java") {
    return "java";
  }
  if (ext === "kt" || ext === "kts") {
    return "kotlin";
  }
  if (ext === "swift") {
    return "swift";
  }
  if (ext === "cs") {
    return "csharp";
  }
  if (ext === "cpp" || ext === "cc" || ext === "cxx" || ext === "hpp" || ext === "h" || ext === "c") {
    return ext === "c" || ext === "h" ? "c" : "cpp";
  }
  if (ext === "php") {
    return "php";
  }
  if (ext === "scala") {
    return "scala";
  }
  return ext;
}

function fileBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** True when a fence language tag matches the active file's extension family. */
export function languageTagMatchesPath(language: string | undefined, path: string | undefined): boolean {
  const lang = language?.trim().toLowerCase();
  if (!lang || !path?.trim()) {
    return false;
  }
  const fromPath = languageFromFilePath(path)?.toLowerCase();
  if (!fromPath) {
    return false;
  }
  if (lang === fromPath) {
    return true;
  }
  if (lang === "ts" && fromPath === "typescript") {
    return true;
  }
  if (lang === "js" && fromPath === "javascript") {
    return true;
  }
  if ((lang === "py" || lang === "python3") && fromPath === "python") {
    return true;
  }
  // Models constantly label .ts/.tsx as javascript.
  if (JS_TS_FAMILY.has(lang) && JS_TS_FAMILY.has(fromPath)) {
    return true;
  }
  return false;
}

export function isOrdinaryLanguageTag(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return Boolean(trimmed) && LANGUAGE_TAG_RE.test(trimmed) && !trimmed.includes("/");
}

export function shouldNeverUpgradeLanguageFence(language: string | undefined): boolean {
  const lang = language?.trim().toLowerCase() ?? "";
  return NEVER_UPGRADE_LANGS.has(lang);
}

/**
 * Resolve a cite path for a mistaken ```lang dump of repo code.
 * Prefer nearby prose paths, then active file when language family matches
 * (including js↔ts), then active file when its basename appears near the fence.
 */
export function resolveCitePathForLanguageFence(options: {
  language: string | undefined;
  code: string;
  lines: string[];
  fenceStartIndex: number;
  activeFilePath?: string;
}): string | undefined {
  if (!options.code.trim() || shouldNeverUpgradeLanguageFence(options.language)) {
    return undefined;
  }

  const nearby = findRepoPathNearFence(options.lines, options.fenceStartIndex, options.activeFilePath);
  if (nearby) {
    return nearby;
  }

  const activePath = options.activeFilePath?.trim();
  if (!activePath) {
    return undefined;
  }

  if (languageTagMatchesPath(options.language, activePath)) {
    return activePath;
  }

  // Basename mentioned in nearby prose (e.g. "in send-signing-email.ts") with open file.
  const base = fileBasename(activePath);
  if (base && proseNearFenceMentionsBasename(options.lines, options.fenceStartIndex, base)) {
    return activePath;
  }

  return undefined;
}

function proseNearFenceMentionsBasename(
  lines: string[],
  fenceStartIndex: number,
  basename: string
): boolean {
  const needle = basename.toLowerCase();
  let seen = 0;
  for (let i = fenceStartIndex - 1; i >= 0 && seen < 24; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line) {
      continue;
    }
    seen += 1;
    if (line.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function locatorFromToken(
  token: string,
  activeFilePath?: string,
  activeBase?: string
): CodeCitationLocator | null {
  const cleaned = token.replace(/^[("'\[]+|[)"'\],]+$/g, "").trim();
  if (!cleaned) {
    return null;
  }
  const locator = tryParseCitationLocator(cleaned);
  if (locator) {
    return locator;
  }
  if (activeFilePath && activeBase && cleaned === activeBase) {
    return { path: activeFilePath.trim() };
  }
  return null;
}

/**
 * Pull a citation locator from prose near a code fence (whole line, backticks,
 * or path tokens). Prefers numeric locators so later consumer dumps keep line ranges.
 */
export function findCitationNearFence(
  lines: string[],
  fenceStartIndex: number,
  activeFilePath?: string
): CodeCitationLocator | undefined {
  const activeBase = activeFilePath?.trim() ? fileBasename(activeFilePath.trim()) : undefined;
  let seen = 0;
  for (let i = fenceStartIndex - 1; i >= 0 && seen < 24; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line) {
      continue;
    }
    seen += 1;

    const wholeLine = locatorFromProseLine(line);
    if (wholeLine) {
      return wholeLine;
    }

    const tickMatches = line.matchAll(/`([^`\n]+)`/g);
    for (const match of tickMatches) {
      const inner = locatorFromToken(match[1] ?? "", activeFilePath, activeBase);
      if (inner) {
        return inner;
      }
    }

    for (const token of line.split(/\s+/)) {
      const fromToken = locatorFromToken(token, activeFilePath, activeBase);
      if (fromToken) {
        return fromToken;
      }
    }
  }
  return undefined;
}

/**
 * Pull a repo path from prose near a code fence (backticks or bare path tokens).
 * Also recovers active-file path when its basename is mentioned without a slash.
 */
export function findRepoPathNearFence(
  lines: string[],
  fenceStartIndex: number,
  activeFilePath?: string
): string | undefined {
  return findCitationNearFence(lines, fenceStartIndex, activeFilePath)?.path;
}

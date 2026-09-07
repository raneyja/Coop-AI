/**
 * Keep in sync with src/webview/lib/codeCitationLocator.ts (chat-code-surfaces rule).
 */

export type CodeCitationLocator = {
  path: string;
  startLine?: number;
  endLine?: number;
};

const NUMERIC_LOCATOR_RE = /^(\d+):(\d+):(.+)$/;
const PLACEHOLDER_LOCATOR_RE =
  /^(?:startLine|start)\s*:\s*(?:endLine|end)\s*:\s*(.+)$/i;
const PATH_RANGE_LOCATOR_RE = /^(.+):(\d+)-(\d+)$/;
const PATH_LINE_LOCATOR_RE = /^(.+):(\d+)$/;
const PATH_ONLY_LOCATOR_RE =
  /^(?:\.\/)?(?:[\w.@+-]+\/)+[\w.@+-]+\.[A-Za-z0-9]{1,12}$/;
const LANGUAGE_TAG_RE = /^[A-Za-z][A-Za-z0-9_+#-]*$/;
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
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("http:") || trimmed.startsWith("https:")) {
    return false;
  }
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
  return trimmed.replace(/[.,;:]+$/, "").trim();
}

function locatorFromPathAndLines(
  path: string,
  startRaw: string,
  endRaw?: string
): CodeCitationLocator | null {
  if (!looksLikeRepoFilePath(path)) {
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

export function tryParseCitationLocator(value: string): CodeCitationLocator | null {
  const trimmed = unwrapLocatorText(value);
  if (!trimmed) {
    return null;
  }
  return parseLocatorCore(trimmed);
}

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

export function isUnfencedCitationStartLine(line: string): boolean {
  const locator = locatorFromProseLine(line);
  return locator != null && locator.startLine != null;
}

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
  return ext;
}

function fileBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

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

export function findRepoPathNearFence(
  lines: string[],
  fenceStartIndex: number,
  activeFilePath?: string
): string | undefined {
  return findCitationNearFence(lines, fenceStartIndex, activeFilePath)?.path;
}

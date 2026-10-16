// Shared locator syntax; this surface retains its existing language/prose policy.
export * from "../../../src/shared/codeCitationLocator";
import { type CodeCitationLocator, tryParseCitationLocator, locatorFromProseLine, normalizeNumberedCitationFences as normalizeSharedCitationFences } from "../../../src/shared/codeCitationLocator";

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

/** Retain this surface's language policy while using the shared syntax owner. */
export function normalizeNumberedCitationFences(markdown: string): string {
  return normalizeSharedCitationFences(markdown, { shouldNeverUpgradeLanguageFence, isOrdinaryLanguageTag });
}

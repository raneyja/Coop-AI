// Shared locator syntax; this surface retains its existing language/prose policy.
export * from "../../shared/codeCitationLocator";
import { type CodeCitationLocator, tryParseCitationLocator, locatorFromProseLine, normalizeNumberedCitationFences as normalizeSharedCitationFences } from "../../shared/codeCitationLocator";

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

/** Retain this surface's language policy while using the shared syntax owner. */
export function normalizeNumberedCitationFences(markdown: string): string {
  return normalizeSharedCitationFences(markdown, { shouldNeverUpgradeLanguageFence, isOrdinaryLanguageTag });
}

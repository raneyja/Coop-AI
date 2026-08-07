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
  return PATH_ONLY_LOCATOR_RE.test(trimmed) || /\/[^/]+\.[A-Za-z0-9]{1,12}$/.test(trimmed);
}

export function tryParseCitationLocator(value: string): CodeCitationLocator | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (LANGUAGE_TAG_RE.test(trimmed) && !trimmed.includes("/")) {
    return null;
  }
  const numeric = trimmed.match(NUMERIC_LOCATOR_RE);
  if (numeric) {
    const path = numeric[3]!.trim();
    if (!looksLikeRepoFilePath(path)) {
      return null;
    }
    const startLine = Number(numeric[1]);
    const endLine = Number(numeric[2]);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine < 1 || endLine < startLine) {
      return null;
    }
    return { startLine, endLine, path };
  }
  const placeholder = trimmed.match(PLACEHOLDER_LOCATOR_RE);
  if (placeholder) {
    const path = placeholder[1]!.trim();
    if (!looksLikeRepoFilePath(path)) {
      return null;
    }
    return { path };
  }
  if (looksLikeRepoFilePath(trimmed)) {
    return { path: trimmed.replace(/^\.\//, "") };
  }
  return null;
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

export function findRepoPathNearFence(
  lines: string[],
  fenceStartIndex: number,
  activeFilePath?: string
): string | undefined {
  const activeBase = activeFilePath?.trim() ? fileBasename(activeFilePath.trim()) : undefined;
  let seen = 0;
  for (let i = fenceStartIndex - 1; i >= 0 && seen < 24; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line) {
      continue;
    }
    seen += 1;
    const tickMatches = line.matchAll(/`([^`\n]+)`/g);
    for (const match of tickMatches) {
      const inner = (match[1] ?? "").trim();
      const pathPart = inner.replace(/:\d+(?:-\d+)?$/, "");
      if (looksLikeRepoFilePath(pathPart)) {
        return pathPart.replace(/^\.\//, "");
      }
      if (activeFilePath && activeBase && pathPart === activeBase) {
        return activeFilePath.trim();
      }
    }
    for (const token of line.split(/\s+/)) {
      const cleaned = token.replace(/^[("'\[]+|[)"'\],.:;]+$/g, "");
      const pathPart = cleaned.replace(/:\d+(?:-\d+)?$/, "");
      if (looksLikeRepoFilePath(pathPart)) {
        return pathPart.replace(/^\.\//, "");
      }
      if (activeFilePath && activeBase && pathPart === activeBase) {
        return activeFilePath.trim();
      }
    }
  }
  return undefined;
}

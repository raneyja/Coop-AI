/**
 * Shared citation-locator parsing for chat prose fences.
 * Keep in sync with admin/website chatProseParser copies (see chat-code-surfaces rule).
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
 * First-line path-only locators (no line range).
 * Requires a slash and a file extension so prose sentences do not match.
 */
const PATH_ONLY_LOCATOR_RE =
  /^(?:\.\/)?(?:[\w.@+-]+\/)+[\w.@+-]+\.[A-Za-z0-9]{1,12}$/;

const LANGUAGE_TAG_RE = /^[A-Za-z][A-Za-z0-9_+#-]*$/;

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

/**
 * Parse a citation locator from a fence info-string or first body line.
 * Returns null when the value is an ordinary language tag or unrelated text.
 */
export function tryParseCitationLocator(value: string): CodeCitationLocator | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Ordinary language tags must never become citations.
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
  if (ext === "py") {
    return "python";
  }
  if (ext === "json" || ext === "jsonc") {
    return "json";
  }
  return ext;
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
  return false;
}

/**
 * Pull a repo path from prose near a code fence (backticks or bare path tokens).
 */
export function findRepoPathNearFence(lines: string[], fenceStartIndex: number): string | undefined {
  let seen = 0;
  for (let i = fenceStartIndex - 1; i >= 0 && seen < 4; i -= 1) {
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
    }

    for (const token of line.split(/\s+/)) {
      const cleaned = token.replace(/^[("'\[]+|[)"'\],.:;]+$/g, "");
      const pathPart = cleaned.replace(/:\d+(?:-\d+)?$/, "");
      if (looksLikeRepoFilePath(pathPart)) {
        return pathPart.replace(/^\.\//, "");
      }
    }
  }
  return undefined;
}

export function isOrdinaryLanguageTag(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return Boolean(trimmed) && LANGUAGE_TAG_RE.test(trimmed) && !trimmed.includes("/");
}

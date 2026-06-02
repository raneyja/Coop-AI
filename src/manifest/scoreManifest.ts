import type { EditorContext, ManifestFileEntry, ScoredManifestFile } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "we",
  "you",
  "they",
  "what",
  "which",
  "who",
  "how",
  "when",
  "where",
  "why",
  "with",
  "from",
  "as",
  "by",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "me",
  "my",
  "our",
  "your",
  "their",
  "he",
  "she",
  "him",
  "her",
  "them",
  "his",
  "hers",
  "theirs",
  "am",
  "if",
  "because",
  "while",
  "until",
  "although",
  "though",
  "since",
  "unless",
  "whether",
  "like",
  "get",
  "got",
  "use",
  "used",
  "using"
]);

const ACTIVE_FILE_BOOST = 80;
const OPEN_EDITOR_BOOST = 35;
const SAME_DIR_BOOST = 25;
const SYMBOL_MATCH_BOOST = 60;
const SELECTED_SYMBOL_BOOST = 90;
const PATH_TOKEN_BOOST = 40;
const FILENAME_BOOST = 30;
const EXTENSION_MATCH_BOOST = 10;

/**
 * Rank manifest file paths by relevance to the user query and editor context.
 * Returns paths sorted by descending score (ties broken by path).
 */
export function scoreManifest(
  query: string,
  editorContext: EditorContext,
  manifest: ManifestFileEntry[]
): ScoredManifestFile[] {
  const tokens = tokenizeQuery(query);
  const selectedSymbol = normalizeToken(editorContext.selectedSymbol ?? "");
  const activeFile = normalizePath(editorContext.activeFile);
  const openSet = new Set((editorContext.openEditors ?? []).map(normalizePath).filter(Boolean));

  const scored: ScoredManifestFile[] = [];
  for (const entry of manifest) {
    const path = normalizePath(entry.filePath);
    if (!path) {
      continue;
    }
    let score = 0;

    if (activeFile && path === activeFile) {
      score += ACTIVE_FILE_BOOST;
    } else if (activeFile && sameDirectory(activeFile, path)) {
      score += SAME_DIR_BOOST;
    }

    if (openSet.has(path)) {
      score += OPEN_EDITOR_BOOST;
    }

    for (const token of tokens) {
      if (pathIncludesToken(path, token)) {
        score += PATH_TOKEN_BOOST;
      }
      const baseName = pathBasename(path);
      if (baseName.includes(token)) {
        score += FILENAME_BOOST;
      }
      for (const symbol of entry.symbols) {
        const symbolName = normalizeToken(symbol.name);
        if (symbolName.includes(token) || token.includes(symbolName)) {
          score += SYMBOL_MATCH_BOOST;
          if (selectedSymbol && symbolName === selectedSymbol) {
            score += SELECTED_SYMBOL_BOOST;
          }
        }
      }
    }

    if (selectedSymbol) {
      for (const symbol of entry.symbols) {
        if (normalizeToken(symbol.name) === selectedSymbol) {
          score += SELECTED_SYMBOL_BOOST;
          break;
        }
      }
    }

    if (editorContext.languageId && pathExtension(path) === extensionForLanguage(editorContext.languageId)) {
      score += EXTENSION_MATCH_BOOST;
    }

    if (score > 0) {
      scored.push({ filePath: entry.filePath, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));
}

export function topManifestPaths(
  query: string,
  editorContext: EditorContext,
  manifest: ManifestFileEntry[],
  limit = 3
): string[] {
  return scoreManifest(query, editorContext, manifest)
    .slice(0, limit)
    .map((entry) => entry.filePath);
}

function tokenizeQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/[^a-z0-9_/.-]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !STOP_WORDS.has(part));
  return [...new Set(raw)];
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePath(filePath: string | undefined): string {
  return filePath?.replace(/\\/g, "/").replace(/^\/+/, "") ?? "";
}

function pathBasename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}

function pathExtension(filePath: string): string {
  const base = pathBasename(filePath);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

function sameDirectory(a: string, b: string): boolean {
  const dirA = a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "";
  const dirB = b.includes("/") ? b.slice(0, b.lastIndexOf("/")) : "";
  return Boolean(dirA && dirA === dirB);
}

function pathIncludesToken(path: string, token: string): boolean {
  return path.toLowerCase().includes(token);
}

function extensionForLanguage(languageId: string): string {
  switch (languageId) {
    case "typescript":
      return ".ts";
    case "typescriptreact":
      return ".tsx";
    case "javascript":
      return ".js";
    case "javascriptreact":
      return ".jsx";
    case "python":
      return ".py";
    case "go":
      return ".go";
    case "java":
      return ".java";
    case "ruby":
      return ".rb";
    default:
      return "";
  }
}

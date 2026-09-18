/**
 * One locate verdict: implementation site vs mention vs unrelated.
 *
 * A mention (docs, tests, string/comment talk, language-mismatch sample) must
 * not stop the hunt and must not be handed to the writer as evidence.
 */
import {
  isDocOrSpecPath,
  isSeedOrFixturePath,
  isTestPath
} from "../../indexing/evidencePathNoise";
import {
  contentLooksLikeDeclaration,
  isApiRejectAsk,
  queryHasNamedSymbol,
  queryNamesSourceFile,
  queryRoleHints,
  textMentionsNamedSymbol,
  textMentionsQueryRoles,
  textSatisfiesLocateQuery
} from "./searchQuery";

export type LocateEvidenceClass = "implementation" | "mention" | "unrelated";

type LocateReadInput = {
  path: string;
  body: string;
  query: string;
};

type LangFamily = "ts" | "py" | "go" | "java" | "rs" | "rb" | "other";

function locateVerdictApplies(query: string): boolean {
  if (isApiRejectAsk(query)) {
    return false;
  }
  return queryHasNamedSymbol(query) || queryRoleHints(query).length > 0;
}

function askedAboutTests(query: string): boolean {
  return /\b(tests?|specs?|unit\s*tests?|contract\s*tests?)\b/i.test(query);
}

function extensionOf(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

function langFamilyFromExt(ext: string): LangFamily {
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(ext)) {
    return "ts";
  }
  if (ext === "py") {
    return "py";
  }
  if (ext === "go") {
    return "go";
  }
  if (ext === "java") {
    return "java";
  }
  if (ext === "rs") {
    return "rs";
  }
  if (ext === "rb") {
    return "rb";
  }
  return "other";
}

function fileLangFamily(path: string): LangFamily {
  return langFamilyFromExt(extensionOf(path));
}

/** Go `func Ident(` or a source path whose language is not this file's. */
function hasLanguageMismatch(path: string, text: string): boolean {
  if (!text) {
    return false;
  }
  const family = fileLangFamily(path);
  if (family !== "go" && family !== "other" && /\bfunc\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text)) {
    return true;
  }
  const token = /(?:^|[^A-Za-z0-9_])(?:[\w.-]+\/)*[\w.-]+\.(go|rs|java|rb|py|ts|tsx|js|jsx)\b/gi;
  for (const match of text.matchAll(token)) {
    const ext = (match[1] ?? "").toLowerCase();
    const other = langFamilyFromExt(ext);
    if (other !== "other" && family !== "other" && other !== family) {
      return true;
    }
  }
  return false;
}

function hasNativeForExtension(path: string, text: string): boolean {
  if (!text) {
    return false;
  }
  switch (fileLangFamily(path)) {
    case "ts":
      return (
        /\bexport\b/.test(text) ||
        /\b(async\s+)?function\s+[A-Za-z_]/.test(text) ||
        /\bclass\s+[A-Za-z_]/.test(text)
      );
    case "py":
      return /\b(async\s+)?def\s+/.test(text) || /\bclass\s+[A-Za-z_]/.test(text);
    case "go":
      return /\bfunc\s+/.test(text) || /\btype\s+[A-Za-z_]/.test(text);
    case "java":
      return /\b(class|interface|enum)\s+[A-Za-z_]/.test(text);
    case "rs":
      return /\b(fn|struct|impl)\s+/.test(text);
    case "rb":
      return /\b(def|class|module)\s+/.test(text);
    default:
      return false;
  }
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    i += 1;
  }
  return source.length;
}

/** Drop strings, comments, and templates so leftover identifiers are real code. */
function stripStringsAndComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i + 2);
      out += end < 0 ? "" : "\n";
      i = end < 0 ? source.length : end;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(source[i - 1] ?? ""))) {
      const end = source.indexOf("\n", i + 1);
      out += end < 0 ? "" : "\n";
      i = end < 0 ? source.length : end;
      continue;
    }
    if (
      (ch === '"' && next === '"' && source[i + 2] === '"') ||
      (ch === "'" && next === "'" && source[i + 2] === "'")
    ) {
      const delim = source.slice(i, i + 3);
      const end = source.indexOf(delim, i + 3);
      out += " ";
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(source, i);
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function isLocatePathNoise(path: string, query: string): boolean {
  if (queryNamesSourceFile(path, query)) {
    return false;
  }
  if (isDocOrSpecPath(path) || isSeedOrFixturePath(path)) {
    return true;
  }
  return isTestPath(path) && !askedAboutTests(query);
}

function namedSymbolInCode(text: string, query: string): boolean {
  if (!queryHasNamedSymbol(query)) {
    return false;
  }
  return textMentionsNamedSymbol(text, query);
}

function roleOnlyInNonCode(path: string, body: string, query: string): boolean {
  const blob = `${path}\n${body}`;
  if (!textSatisfiesLocateQuery(blob, query)) {
    return false;
  }
  const code = `${path}\n${stripStringsAndComments(body)}`;
  return !textSatisfiesLocateQuery(code, query);
}

/**
 * Snippet ranking is conservative: docs/tests/fixtures and language-mismatch
 * are mentions; path+native is implementation; everything else may be read.
 */
function classifyLocateSnippet(path: string, snippet: string, query: string): LocateEvidenceClass | "uncertain" {
  if (queryNamesSourceFile(path, query)) {
    return "implementation";
  }
  if (!textSatisfiesLocateQuery(`${path}\n${snippet}`, query)) {
    // SCIP declarations have no snippet. Named-symbol hits are still worth a read;
    // role-only stays uncertain so mention-class stories cannot block fallbacks.
    if (!snippet.trim()) {
      return queryHasNamedSymbol(query) ? "implementation" : "uncertain";
    }
    return "unrelated";
  }
  if (isLocatePathNoise(path, query)) {
    return "mention";
  }
  if (hasLanguageMismatch(path, snippet)) {
    return "mention";
  }
  if (textMentionsQueryRoles(path, query) && hasNativeForExtension(path, snippet)) {
    return "implementation";
  }
  if (contentLooksLikeDeclaration(snippet, query)) {
    return "implementation";
  }
  if (namedSymbolInCode(stripStringsAndComments(snippet), query)) {
    return "implementation";
  }
  return "uncertain";
}

export function classifyLocateRead(input: LocateReadInput): LocateEvidenceClass {
  const { path, body, query } = input;
  if (queryNamesSourceFile(path, query) && body.trim()) {
    return "implementation";
  }
  if (!textSatisfiesLocateQuery(`${path}\n${body}`, query)) {
    return "unrelated";
  }
  if (!locateVerdictApplies(query)) {
    return "implementation";
  }
  if (isLocatePathNoise(path, query)) {
    return "mention";
  }
  if (hasLanguageMismatch(path, body)) {
    return "mention";
  }
  if (roleOnlyInNonCode(path, body, query)) {
    return "mention";
  }
  const code = stripStringsAndComments(body);
  if (namedSymbolInCode(code, query)) {
    return "implementation";
  }
  if (contentLooksLikeDeclaration(code, query)) {
    return "implementation";
  }
  if (textMentionsQueryRoles(path, query) && hasNativeForExtension(path, code)) {
    return "implementation";
  }
  return "mention";
}

export function locateReadCountsAsGrounding(input: LocateReadInput): boolean {
  if (!locateVerdictApplies(input.query)) {
    return textSatisfiesLocateQuery(`${input.path}\n${input.body}`, input.query);
  }
  return classifyLocateRead(input) === "implementation";
}

export function preferredHitsForLocate<T extends { fileName: string; content?: string }>(
  hits: T[],
  query: string
): T[] {
  if (!locateVerdictApplies(query)) {
    return hits;
  }
  const implementations: T[] = [];
  const uncertain: T[] = [];
  for (const hit of hits) {
    const cls = classifyLocateSnippet(hit.fileName, hit.content ?? "", query);
    if (cls === "implementation") {
      implementations.push(hit);
    } else if (cls === "uncertain") {
      uncertain.push(hit);
    }
  }
  if (implementations.length > 0) {
    return implementations;
  }
  if (uncertain.length > 0) {
    return uncertain;
  }
  return [];
}

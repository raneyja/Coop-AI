import type { AutocompleteSettings, ExtractedCodeContext, RankedCompletion } from "./types";
import { wantsMultiLineCompletion } from "./contextAnalyzer";

export type SymbolPlausibilityHints = {
  manifestSymbols?: ReadonlySet<string>;
};

const TRIVIAL_PATTERN = /^[\s;,.)}\]]+$/;
const FENCE_PATTERN = /^```[\w]*\n?|```$/g;
const SINGLE_LINE_CAP = 4;
const MULTI_LINE_CAP = 8;
const DECL_ASSIGNMENT_PREFIX = /\b(?:const|let|var)\s+\w+\s*=\s*$/;
const REDUNDANT_DECL_ASSIGNMENT = /^(?:const|let|var)\s+\w+\s*=\s*/;
const INLINE_STATEMENT_START =
  /^(?:const|let|var|function\*?\s|async\s+function|class\s|interface\s|type\s|enum\s|import\s|export\s)/;

const JS_LIKE_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact"
]);

const JS_KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

const JS_BUILTINS = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Record",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "console",
  "document",
  "fetch",
  "global",
  "process",
  "require",
  "window"
]);

const IDENTIFIER_PATTERN = /\b[A-Za-z_$][\w$]*\b/g;
const IMPORT_NAMED_PATTERN = /import\s+(?:type\s+)?\{([^}]+)\}/g;
const IMPORT_DEFAULT_PATTERN = /import\s+(?:type\s+)?(\w+)\s+from/g;
const IMPORT_NAMESPACE_PATTERN = /import\s+\*\s+as\s+(\w+)/g;

export function filterAndRankCompletions(
  raw: string[],
  context: ExtractedCodeContext,
  settings: AutocompleteSettings,
  fileTextSample?: string,
  symbolHints?: SymbolPlausibilityHints
): RankedCompletion[] {
  const seen = new Set<string>();
  const ranked: RankedCompletion[] = [];

  for (const item of raw) {
    const cleaned = sanitizeCompletionForContext(normalizeCompletionText(item, context), context);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);

    const quality = scoreCompletion(cleaned, context, settings, fileTextSample, symbolHints);
    if (!quality.include) {
      continue;
    }
    ranked.push({
      text: cleaned,
      score: quality.score,
      source: "llm"
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, settings.showMultipleSuggestions ? 3 : 1);
}

export function normalizeCompletionText(text: string, context?: ExtractedCodeContext): string {
  let value = text.trim();
  value = value.replace(FENCE_PATTERN, "").trim();
  if (value.startsWith("`") && value.endsWith("`")) {
    value = value.slice(1, -1);
  }
  const lineCap =
    context && wantsMultiLineCompletion(context) && !context.afterDot
      ? MULTI_LINE_CAP
      : SINGLE_LINE_CAP;
  const lines = value.split("\n");
  if (lines.length > lineCap) {
    value = lines.slice(0, lineCap).join("\n");
  }
  return value;
}

/** Strip duplicate declarations and drop statement restarts mid-line. */
export function sanitizeCompletionForContext(
  text: string,
  context: ExtractedCodeContext
): string {
  if (!text || !JS_LIKE_LANGUAGES.has(context.languageId)) {
    return text;
  }

  let value = text.trim();
  if (DECL_ASSIGNMENT_PREFIX.test(context.currentLinePrefix)) {
    value = value.replace(REDUNDANT_DECL_ASSIGNMENT, "").trimStart();
    value = value.split("\n")[0]?.trimEnd() ?? "";
  }

  if (context.afterDot) {
    value = sanitizeAfterDotCompletion(value);
    if (!value) {
      return "";
    }
  }

  if (rejectsInlineStatementStart(value, context)) {
    return "";
  }

  return value;
}

function sanitizeAfterDotCompletion(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  if (!firstLine || firstLine.includes("{")) {
    return "";
  }
  if (/^(?:function|class|if|for|while|return|onDid\w+)\b/.test(firstLine)) {
    return "";
  }
  const memberMatch = /^([\w$]+(?:\([^)]*\))?)/.exec(firstLine);
  if (!memberMatch) {
    return "";
  }
  return memberMatch[1];
}

function rejectsInlineStatementStart(text: string, context: ExtractedCodeContext): boolean {
  if (!JS_LIKE_LANGUAGES.has(context.languageId)) {
    return false;
  }

  if (context.afterDot) {
    return false;
  }

  const trimmed = text.trimStart();
  if (!INLINE_STATEMENT_START.test(trimmed)) {
    return false;
  }

  const prefix = context.currentLinePrefix;
  if (DECL_ASSIGNMENT_PREFIX.test(prefix)) {
    return true;
  }

  const trimmedPrefix = prefix.trimEnd();
  if (!trimmedPrefix || trimmedPrefix === context.indent) {
    return false;
  }

  if (/[{(\[]\s*$/.test(trimmedPrefix)) {
    return !/^\s+/.test(text);
  }

  return !/^\s+/.test(text);
}

export function buildKnownSymbolsFromContext(
  context: ExtractedCodeContext,
  fileTextSample?: string,
  manifestSymbols?: ReadonlySet<string>
): Set<string> {
  const known = new Set<string>();
  for (const keyword of JS_KEYWORDS) {
    known.add(keyword);
  }
  for (const builtin of JS_BUILTINS) {
    known.add(builtin);
  }

  collectIdentifiers(context.importsBlock, known);
  collectIdentifiers(context.parentSignature, known);
  collectIdentifiers(context.previousLines, known);
  collectIdentifiers(context.currentLinePrefix, known);
  collectIdentifiers(context.currentLineSuffix, known);
  collectIdentifiers(context.suffixWindow, known);
  if (fileTextSample) {
    collectIdentifiers(fileTextSample, known);
  }
  collectImportBindings(context.importsBlock, known);

  if (manifestSymbols) {
    for (const symbol of manifestSymbols) {
      known.add(symbol);
    }
  }

  return known;
}

export function extractSignificantIdentifiers(text: string, languageId: string): string[] {
  if (!JS_LIKE_LANGUAGES.has(languageId)) {
    return [];
  }

  const seen = new Set<string>();
  const significant: string[] = [];
  for (const match of text.matchAll(IDENTIFIER_PATTERN)) {
    const identifier = match[0];
    if (!identifier || seen.has(identifier) || JS_KEYWORDS.has(identifier)) {
      continue;
    }
    seen.add(identifier);
    if (isSignificantIdentifier(identifier)) {
      significant.push(identifier);
    }
  }
  return significant;
}

export function symbolPlausibilityAdjustment(
  text: string,
  context: ExtractedCodeContext,
  fileTextSample: string | undefined,
  hints?: SymbolPlausibilityHints
): number {
  const known = buildKnownSymbolsFromContext(context, fileTextSample, hints?.manifestSymbols);
  const references = extractSignificantIdentifiers(text, context.languageId);
  if (references.length === 0) {
    return 0;
  }

  let adjustment = 0;
  for (const identifier of references) {
    if (known.has(identifier)) {
      adjustment += 0.04;
    } else {
      adjustment -= 0.06;
    }
  }

  return Math.max(-0.2, Math.min(0.12, adjustment));
}

export function failsManifestSymbolPlausibility(
  text: string,
  context: ExtractedCodeContext,
  fileTextSample: string | undefined,
  hints?: SymbolPlausibilityHints
): boolean {
  if (!hints?.manifestSymbols?.size) {
    return false;
  }

  const known = buildKnownSymbolsFromContext(context, fileTextSample, hints.manifestSymbols);
  const references = extractSignificantIdentifiers(text, context.languageId);
  if (references.length < 2) {
    return false;
  }

  const unknown = references.filter((identifier) => !known.has(identifier));
  return unknown.length >= 2 && unknown.length === references.length;
}

function scoreCompletion(
  text: string,
  context: ExtractedCodeContext,
  settings: AutocompleteSettings,
  fileTextSample?: string,
  symbolHints?: SymbolPlausibilityHints
): { include: boolean; score: number } {
  if (text.length < 2) {
    return { include: false, score: 0 };
  }
  if (text.length > settings.maxSuggestionLength) {
    return { include: false, score: 0 };
  }
  if (TRIVIAL_PATTERN.test(text)) {
    return { include: false, score: 0 };
  }
  if (text === context.currentLinePrefix || context.currentLinePrefix.endsWith(text)) {
    return { include: false, score: 0 };
  }
  if (isAlreadyTyped(text, context)) {
    return { include: false, score: 0 };
  }
  if (failsManifestSymbolPlausibility(text, context, fileTextSample, symbolHints)) {
    return { include: false, score: 0 };
  }

  let score = 0.5;
  if (matchesIndentation(text, context.indent)) {
    score += 0.15;
  }
  if (parseLikelyValid(text, context.languageId)) {
    score += 0.2;
  } else {
    return { include: false, score: 0 };
  }
  if (fileTextSample && fileTextSample.includes(text.trim())) {
    score += 0.1;
  }
  if (isBoilerplate(text)) {
    score -= 0.1;
  }
  score += symbolPlausibilityAdjustment(text, context, fileTextSample, symbolHints);
  return { include: true, score };
}

function collectIdentifiers(source: string | undefined, target: Set<string>): void {
  if (!source) {
    return;
  }
  for (const match of source.matchAll(IDENTIFIER_PATTERN)) {
    if (match[0]) {
      target.add(match[0]);
    }
  }
}

function collectImportBindings(importsBlock: string | undefined, target: Set<string>): void {
  if (!importsBlock) {
    return;
  }

  for (const match of importsBlock.matchAll(IMPORT_NAMED_PATTERN)) {
    const clause = match[1];
    if (!clause) {
      continue;
    }
    for (const part of clause.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const alias = trimmed.split(/\s+as\s+/i).pop()?.trim();
      if (alias) {
        target.add(alias);
      }
    }
  }

  for (const match of importsBlock.matchAll(IMPORT_DEFAULT_PATTERN)) {
    if (match[1]) {
      target.add(match[1]);
    }
  }

  for (const match of importsBlock.matchAll(IMPORT_NAMESPACE_PATTERN)) {
    if (match[1]) {
      target.add(match[1]);
    }
  }
}

function isSignificantIdentifier(identifier: string): boolean {
  if (identifier.length >= 5) {
    return true;
  }
  return /^[A-Z]/.test(identifier);
}

function isAlreadyTyped(text: string, context: ExtractedCodeContext): boolean {
  const combined = context.currentLinePrefix + context.currentLineSuffix;
  return combined.includes(text) && context.currentLineSuffix.startsWith(text);
}

function matchesIndentation(text: string, indent: string): boolean {
  if (!indent) {
    return true;
  }
  const firstLine = text.split("\n")[0] ?? "";
  if (text.includes("\n")) {
    return text.split("\n").slice(1).every((line) => !line.trim() || line.startsWith(indent) || line.startsWith("\t"));
  }
  return !firstLine.startsWith(" ") || firstLine.startsWith(indent);
}

function parseLikelyValid(text: string, languageId: string): boolean {
  if (hasObviousQuoteMismatch(text, languageId)) {
    return false;
  }
  if (languageId === "python") {
    return !/\t/.test(text) || text.includes("\n");
  }
  if (/[{}();]/.test(text) || /\w/.test(text)) {
    return true;
  }
  return text.length >= 2;
}

function hasObviousQuoteMismatch(text: string, languageId: string): boolean {
  if (!JS_LIKE_LANGUAGES.has(languageId)) {
    return false;
  }
  for (const match of text.matchAll(/(['"`])([^\\]*?)(['"`])/g)) {
    if (match[1] !== match[3]) {
      return true;
    }
  }
  const singles = (text.match(/'/g) ?? []).length;
  const doubles = (text.match(/"/g) ?? []).length;
  return singles % 2 !== 0 || doubles % 2 !== 0;
}

function isBoilerplate(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower === "console.log()" ||
    lower === "todo" ||
    lower === "pass" ||
    lower === "return;" ||
    lower === ";"
  );
}

export function stripOverlapWithPrefix(prefix: string, completion: string): string {
  let result = completion;
  const maxOverlap = Math.min(prefix.length, result.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const tail = prefix.slice(-size);
    if (result.startsWith(tail)) {
      result = result.slice(size);
      break;
    }
  }
  return result;
}

export function toInlineInsertText(
  context: ExtractedCodeContext,
  completion: RankedCompletion
): string {
  let stripped = stripOverlapWithPrefix(context.currentLinePrefix, completion.text);
  if (!stripped) {
    return "";
  }
  stripped = ensureInsertSpacing(context.currentLinePrefix, stripped);
  if (context.currentLinePrefix.trim() === "" && context.indent && !stripped.startsWith(context.indent)) {
    return context.indent + stripped;
  }
  return stripped;
}

/** After `=` or `:`, ensure a space before the completion when the user has not typed one yet. */
export function ensureInsertSpacing(prefix: string, insert: string): string {
  if (!insert || /^\s/.test(insert)) {
    return insert;
  }
  const trimmedEnd = prefix.trimEnd();
  const trailingWhitespace = prefix.length - trimmedEnd.length;
  if (trailingWhitespace > 0) {
    return insert;
  }
  if (/[=:,]$/.test(trimmedEnd)) {
    return ` ${insert}`;
  }
  return insert;
}

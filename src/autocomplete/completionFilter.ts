import type { AutocompleteSettings, ExtractedCodeContext, RankedCompletion } from "./types";
import { wantsMultiLineCompletion } from "./contextAnalyzer";

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

export function filterAndRankCompletions(
  raw: string[],
  context: ExtractedCodeContext,
  settings: AutocompleteSettings,
  fileTextSample?: string
): RankedCompletion[] {
  const seen = new Set<string>();
  const ranked: RankedCompletion[] = [];

  for (const item of raw) {
    const cleaned = sanitizeCompletionForContext(normalizeCompletionText(item, context), context);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);

    const quality = scoreCompletion(cleaned, context, settings, fileTextSample);
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
    context && wantsMultiLineCompletion(context) ? MULTI_LINE_CAP : SINGLE_LINE_CAP;
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
  }

  if (rejectsInlineStatementStart(value, context)) {
    return "";
  }

  return value;
}

function rejectsInlineStatementStart(text: string, context: ExtractedCodeContext): boolean {
  if (!JS_LIKE_LANGUAGES.has(context.languageId)) {
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

function scoreCompletion(
  text: string,
  context: ExtractedCodeContext,
  settings: AutocompleteSettings,
  fileTextSample?: string
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
  return { include: true, score };
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

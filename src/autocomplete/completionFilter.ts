import type { AutocompleteSettings, ExtractedCodeContext, RankedCompletion } from "./types";

const TRIVIAL_PATTERN = /^[\s;,.)}\]]+$/;
const FENCE_PATTERN = /^```[\w]*\n?|```$/g;

export function filterAndRankCompletions(
  raw: string[],
  context: ExtractedCodeContext,
  settings: AutocompleteSettings,
  fileTextSample?: string
): RankedCompletion[] {
  const seen = new Set<string>();
  const ranked: RankedCompletion[] = [];

  for (const item of raw) {
    const cleaned = normalizeCompletionText(item);
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

export function normalizeCompletionText(text: string): string {
  let value = text.trim();
  value = value.replace(FENCE_PATTERN, "").trim();
  if (value.startsWith("`") && value.endsWith("`")) {
    value = value.slice(1, -1);
  }
  const lines = value.split("\n");
  if (lines.length > 4) {
    value = lines.slice(0, 4).join("\n");
  }
  return value;
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
  if (languageId === "python") {
    return !/\t/.test(text) || text.includes("\n");
  }
  if (/[{}();]/.test(text) || /\w/.test(text)) {
    return true;
  }
  return text.length >= 2;
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
  const stripped = stripOverlapWithPrefix(context.currentLinePrefix, completion.text);
  if (!stripped) {
    return "";
  }
  if (context.currentLinePrefix.trim() === "" && context.indent && !stripped.startsWith(context.indent)) {
    return context.indent + stripped;
  }
  return stripped;
}

import { sanitizeAtlassianContainsTerm } from "./docSearchQuery";
import { SEARCH_WORD_RETRY_STOP } from "../chat/intentPlanner/searchMeaningStop";

export type JobSearchAttemptKind = "exact" | "phrase" | "words";

export type JobSearchAttempt = {
  kind: JobSearchAttemptKind;
  /** Vendor-safe query text. Hyphens already turned into spaces. */
  text: string;
  tokens: string[];
};

const ISSUE_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/gi;
const FILE_NAME = /^[\w.-]+\.[A-Za-z0-9]{1,8}$/;

/** Ticket keys and file names are never rewritten. File names stay with the
 * locate job — they must not spend an integration try when a phrase exists.
 */
export function planJobSearchAttempts(terms: string[]): JobSearchAttempt[] {
  const phrases: string[] = [];
  for (const raw of terms) {
    ISSUE_KEY.lastIndex = 0;
    const withoutKeys = raw.replace(ISSUE_KEY, " ");
    const phrase = meaningPhrase(withoutKeys);
    if (phrase && !isFileName(phrase)) {
      phrases.push(phrase);
    }
  }

  const attempts: JobSearchAttempt[] = [];
  const phrase = pickPrimaryPhrase(phrases);
  if (phrase) {
    attempts.push({
      kind: "phrase",
      text: phrase,
      tokens: phrase.split(/\s+/)
    });
  }

  const wordText = distinctiveWordQuery(phrases.join(" ") || phrase || "");
  if (wordText && wordText.toLowerCase() !== phrase?.toLowerCase()) {
    attempts.push({
      kind: "words",
      text: wordText,
      tokens: wordText.split(/\s+/)
    });
  }

  if (attempts.length === 0) {
    const file = terms.map((term) => term.trim().split(/[/\\]/).pop() ?? "").find(isFileName);
    if (file) {
      attempts.push({ kind: "exact", text: file, tokens: [file] });
    }
  }

  return attempts.slice(0, 2);
}

/** Query shown on the activity chip — same first try the fetcher sends. */
export function jobSearchActivityQuery(terms: string[]): string | undefined {
  return planJobSearchAttempts(terms)[0]?.text;
}

export function exactIssueKeys(terms: string[]): string[] {
  const keys = new Set<string>();
  for (const term of terms) {
    ISSUE_KEY.lastIndex = 0;
    for (const match of term.matchAll(ISSUE_KEY)) {
      keys.add(match[0].toUpperCase());
    }
  }
  return [...keys];
}

function pickPrimaryPhrase(phrases: string[]): string | undefined {
  if (phrases.length === 0) {
    return undefined;
  }
  const named = phrases.filter(looksLikeNamedDocTitle);
  const pool = named.length > 0 ? named : phrases;
  return [...pool].sort((left, right) => right.length - left.length)[0];
}

/** Prefer "Architecture Overview" over a hyphen topic like coop-backend. */
function looksLikeNamedDocTitle(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (/\b(overview|architecture|adr|rfc)\b/i.test(trimmed)) {
    return true;
  }
  return /^(?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)+$/.test(trimmed);
}

function meaningPhrase(term: string): string | undefined {
  return sanitizeAtlassianContainsTerm(term);
}

function isFileName(term: string): boolean {
  return FILE_NAME.test(term.trim()) && !term.includes(" ");
}

function distinctiveWordQuery(phrase: string): string | undefined {
  const tokens = phrase
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SEARCH_WORD_RETRY_STOP.has(token.toLowerCase()));
  if (tokens.length === 0) {
    return undefined;
  }
  const rare = tokens.filter((token) => token.length >= 5);
  const picked = (rare.length > 0 ? rare : tokens).slice(0, 3);
  const text = picked.join(" ");
  if (text.toLowerCase() !== phrase.trim().toLowerCase()) {
    return text;
  }
  return [...tokens].sort((left, right) => right.length - left.length)[0];
}

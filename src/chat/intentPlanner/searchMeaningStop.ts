/**
 * One meaning-stop policy for job terms, front-door fallback, and word retry.
 * Recency/artifact shape words are never a search topic.
 * Parser-safety lists (Atlassian reserved words) stay elsewhere.
 */
export const SEARCH_MEANING_STOP = new Set(
  [
    "where",
    "what",
    "which",
    "who",
    "how",
    "does",
    "did",
    "already",
    "this",
    "that",
    "into",
    "in",
    "the",
    "and",
    "for",
    "from",
    "with",
    "about",
    "please",
    "find",
    "show",
    "check",
    "search",
    "list",
    "open",
    "recent",
    "latest",
    "newest",
    "most",
    "last",
    "post",
    "posts",
    "message",
    "messages",
    "ticket",
    "tickets",
    "page",
    "pages",
    "doc",
    "docs",
    "document",
    "documents",
    "discussion",
    "discussions",
    "thread",
    "threads",
    "conversation",
    "conversations",
    "item",
    "items",
    "say",
    "said",
    "repo",
    "repository",
    "pager",
    "oncall",
    "incident",
    "outage",
    "implemented",
    "defined",
    "located",
    "decide",
    "decided",
    "decision",
    "we",
    "our",
    "was",
    "were",
    "have",
    "has",
    "been",
    "not",
    "dont",
    "don't",
    "mix",
    "prs",
    "pr",
    "mrs",
    "mr",
    "pull",
    "request",
    "requests",
    "merge",
    "issue",
    "issues",
    "slack",
    "jira",
    "teams",
    "confluence",
    "notion",
    "google",
    "gdocs",
    "github",
    "gitlab",
    "bitbucket",
    "any",
    "to",
    "of",
    "a",
    "an",
    "on",
    "or"
  ].map((word) => word.toLowerCase())
);

export function isSearchMeaningStop(token: string): boolean {
  return SEARCH_MEANING_STOP.has(token.trim().toLowerCase());
}

/** Distinctive-word retry overlay — Atlassian `sql` alone is not the topic. */
export const SEARCH_WORD_RETRY_STOP = new Set<string>([...SEARCH_MEANING_STOP, "sql"]);

export function uniqueMeaningTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.replace(/\s+/g, " ").trim();
    if (!term || term.length < 2) {
      continue;
    }
    const key = term.toLowerCase();
    if (isSearchMeaningStop(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(term);
  }
  return out;
}

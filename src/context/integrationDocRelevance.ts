/**
 * Rank / filter org doc hits (Confluence, Notion, Google Docs) for the active Use-repo.
 * Prevents wrong-repo bleed (e.g. Coop-AI ADRs) when auditing another product.
 */

import {
  evidenceTextIsForeignToRepo,
  evidenceTextNamesActiveRepo,
  type TurnIsolationScenario
} from "../workspace/repoEvidenceIsolation";

export type DocPageLike = {
  title: string;
  excerpt?: string;
};

/**
 * Strip mojibake / Confluence highlight markup / control chars from org-doc snippets.
 * Pass: readable excerpt without replacement characters (�) or @@@hl@@@ markers.
 * Fail: leaving corrupted emoji/UTF-8 debris in Sources / reviewed-page lines.
 */
export function sanitizeIntegrationSnippet(text: string | undefined): string | undefined {
  if (text == null) {
    return undefined;
  }
  const cleaned = text
    .replace(/\uFFFD+/g, "")
    // Noncharacters / specials often left after emoji mis-decode (e.g. "�️")
    .replace(/[\uFFF0-\uFFFF]/g, "")
    .replace(/\uFE0F/g, "")
    .replace(/@@@hl@@@|@@@endhl@@@/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function haystackForPage(page: DocPageLike): string {
  return `${page.title} ${page.excerpt ?? ""}`.toLowerCase();
}

function turnScenario(options: { owner?: string; repo?: string }): TurnIsolationScenario {
  return { owner: options.owner, repo: options.repo };
}

function focusTermMatches(haystack: string, focusTerms: string[] | undefined): boolean {
  return (focusTerms ?? []).some((term) => {
    const normalized = term.trim().toLowerCase().replace(/[-–—]/g, " ");
    return normalized.length >= 4 && haystack.includes(normalized);
  });
}

/**
 * Score a doc page for Use-repo relevance (+ optional focus terms).
 * Higher is better. Negative scores are foreign-product bleed.
 */
export function scoreDocPageForUseRepo(
  page: DocPageLike,
  options: {
    owner?: string;
    repo?: string;
    focusTerms?: string[];
  }
): number {
  const haystack = haystackForPage(page);
  let score = 0;

  if (evidenceTextNamesActiveRepo(haystack, turnScenario(options))) {
    score += 50;
  }

  if (focusTermMatches(haystack, options.focusTerms)) {
    score += 25;
  }

  const askedByPhrase = focusTermMatches(haystack, options.focusTerms);
  if (
    evidenceTextIsForeignToRepo(haystack, turnScenario(options), {
      ignoreTicketKeys: askedByPhrase
    })
  ) {
    score -= 40;
  }

  return score;
}

/**
 * Keep pages that name this Use-repo. When none do, keep only positive focus matches.
 * Score-0 foreign and neutral pages do not fill the fallback. Always sanitizes excerpts.
 */
export function filterDocPagesForUseRepo<T extends DocPageLike>(
  pages: T[],
  options: {
    owner?: string;
    repo?: string;
    focusTerms?: string[];
    /** Max pages to keep after ranking (default 12). */
    limit?: number;
  }
): T[] {
  const limit = options.limit ?? 12;
  const scored = pages.map((page) => {
    const excerpt = sanitizeIntegrationSnippet(page.excerpt);
    const cleaned = {
      ...page,
      title: sanitizeIntegrationSnippet(page.title) ?? page.title,
      ...(excerpt ? { excerpt } : { excerpt: undefined })
    } as T;
    return {
      page: cleaned,
      score: scoreDocPageForUseRepo(cleaned, options)
    };
  });

  const scenario = turnScenario(options);
  const judged = scored.map((entry) => {
    const haystack = haystackForPage(entry.page);
    const askedByPhrase = focusTermMatches(haystack, options.focusTerms);
    const foreign = evidenceTextIsForeignToRepo(haystack, scenario, {
      ignoreTicketKeys: askedByPhrase
    });
    return {
      ...entry,
      foreign,
      namesRepo: evidenceTextNamesActiveRepo(haystack, scenario)
    };
  });

  judged.sort((a, b) => b.score - a.score);

  const named = judged.filter((entry) => !entry.foreign && entry.namesRepo);
  const focused = judged.filter((entry) => !entry.foreign && entry.score > 0);
  const pool = named.length > 0 ? named : focused;

  return pool.slice(0, limit).map((entry) => entry.page);
}

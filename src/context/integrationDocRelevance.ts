/**
 * Rank / filter org doc hits (Confluence, Notion, Google Docs) for the active Use-repo.
 * Prevents wrong-repo bleed (e.g. Coop-AI ADRs) when auditing another product.
 */

import { repoNameVariants } from "./docSearchQuery";

export type DocPageLike = {
  title: string;
  excerpt?: string;
};

/** Common foreign product labels that often dominate shared Confluence spaces. */
const FOREIGN_PRODUCT_MARKERS = [
  "coop-ai",
  "coop ai",
  "coopai",
  "coop ai —",
  "coop ai demo"
];

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

function pageMentionsRepo(haystack: string, owner?: string, repo?: string): boolean {
  const repoName = repo?.trim();
  if (!repoName) {
    return false;
  }
  for (const variant of repoNameVariants(repoName)) {
    if (haystack.includes(variant.toLowerCase())) {
      return true;
    }
  }
  const ownerName = owner?.trim();
  if (ownerName) {
    for (const variant of repoNameVariants(repoName)) {
      if (haystack.includes(`${ownerName.toLowerCase()}/${variant.toLowerCase()}`)) {
        return true;
      }
    }
  }
  return false;
}

function pageLooksLikeForeignProduct(haystack: string, activeRepo?: string): boolean {
  const repo = activeRepo?.trim().toLowerCase() ?? "";
  const activeIsCoop = /coop/.test(repo);
  for (const marker of FOREIGN_PRODUCT_MARKERS) {
    if (activeIsCoop && marker.includes("coop")) {
      continue;
    }
    if (haystack.includes(marker)) {
      return true;
    }
  }
  return false;
}

/** COOP-101 ADRs belong to Coop-AI, not plane. */
function pageLooksLikeForeignTicket(haystack: string, activeRepo?: string): boolean {
  const repo = activeRepo?.trim().toLowerCase() ?? "";
  if (/coop/.test(repo)) {
    return false;
  }
  return /\bcoop-\d+\b/i.test(haystack);
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

  if (pageMentionsRepo(haystack, options.owner, options.repo)) {
    score += 50;
  }

  if (pageLooksLikeForeignProduct(haystack, options.repo)) {
    score -= 40;
  }
  if (pageLooksLikeForeignTicket(haystack, options.repo)) {
    score -= 40;
  }

  for (const term of options.focusTerms ?? []) {
    const normalized = term.trim().toLowerCase();
    if (normalized.length >= 4 && haystack.includes(normalized)) {
      score += 10;
    }
  }

  return score;
}

/**
 * Keep Use-repo-linked pages when any exist; otherwise drop clear foreign-product hits.
 * Always sanitizes excerpts.
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

  scored.sort((a, b) => b.score - a.score);

  const repoLinked = scored.filter((entry) => entry.score >= 50);
  const pool = repoLinked.length > 0 ? repoLinked : scored.filter((entry) => entry.score >= 0);

  return pool.slice(0, limit).map((entry) => entry.page);
}

import type { MentionSearchResult } from "./types";

/** Sentinel repoId for workspace-local @ mentions (not indexed remote graph). */
export const WORKSPACE_LOCAL_REPO_ID = "workspace:local";

/** Section title when the @ typeahead shows workspace-local hits only. */
export const LOCAL_WORKSPACE_MENTION_TITLE = "Local Workspace";

/** Section title for deep-indexed / graph search hits (workspace repos). */
export const INDEXED_REPOS_MENTION_TITLE = "Indexed repos";

export const MENTION_SEARCH_LIMIT = 12;

export type MentionSearchMergeOptions = {
  /** When set, indexed hits from this repo win over workspace-local duplicates. */
  preferRepoId?: string;
};

function matchesActiveRepo(item: MentionSearchResult, preferRepoId?: string): boolean {
  if (!preferRepoId || isLocalMentionResult(item)) {
    return false;
  }
  return item.repoId?.toLowerCase() === preferRepoId.toLowerCase();
}

export function localPathsToMentionResults(
  paths: string[],
  options?: MentionSearchMergeOptions
): MentionSearchResult[] {
  const activeRepoId = options?.preferRepoId?.trim();
  if (activeRepoId) {
    return paths.map((path) => ({
      repoId: activeRepoId,
      path,
      source: "indexed" as const
    }));
  }
  return paths.map((path) => ({
    repoId: WORKSPACE_LOCAL_REPO_ID,
    path,
    source: "local" as const
  }));
}

export function graphHitsToMentionResults(
  hits: Array<{ repoId?: string; path?: string; sha?: string; score?: number }>,
  fallbackRepoId: string,
  isNoisyPath: (path: string) => boolean
): MentionSearchResult[] {
  const items: MentionSearchResult[] = [];
  for (const hit of hits) {
    if (!hit.path || isNoisyPath(hit.path)) {
      continue;
    }
    items.push({
      repoId: hit.repoId ?? fallbackRepoId,
      path: hit.path,
      lineNumber: hit.sha ? Number(hit.sha) : undefined,
      score: hit.score,
      source: "indexed"
    });
  }
  return items;
}

function normalizeMentionPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function isLocalMentionResult(item: MentionSearchResult): boolean {
  return item.repoId === WORKSPACE_LOCAL_REPO_ID || item.source === "local";
}

/** Dedupe by path; prefer active-repo indexed hits, else local workspace over foreign indexed. */
export function dedupeHybridMentionResults(
  items: MentionSearchResult[],
  options?: MentionSearchMergeOptions
): MentionSearchResult[] {
  const preferRepoId = options?.preferRepoId;
  const byPath = new Map<string, MentionSearchResult>();
  for (const item of items) {
    const key = normalizeMentionPath(item.path);
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, item);
      continue;
    }
    if (matchesActiveRepo(item, preferRepoId) && isLocalMentionResult(existing)) {
      byPath.set(key, item);
      continue;
    }
    if (matchesActiveRepo(existing, preferRepoId) && isLocalMentionResult(item)) {
      continue;
    }
    const itemLocal = isLocalMentionResult(item);
    const existingLocal = isLocalMentionResult(existing);
    if (itemLocal && !existingLocal) {
      byPath.set(key, item);
      continue;
    }
    if (!itemLocal && existingLocal) {
      continue;
    }
    if ((item.score ?? 0) > (existing.score ?? 0)) {
      byPath.set(key, item);
    }
  }
  return [...byPath.values()];
}

export function scoreMentionResult(
  item: MentionSearchResult,
  query: string,
  options?: MentionSearchMergeOptions
): number {
  const path = item.path.toLowerCase();
  const base = path.split("/").pop() ?? path;
  let score = item.score ?? 0;

  if (item.content && item.content.toLowerCase().includes(query)) {
    score += 30;
  }
  if (base === query) {
    score += 50;
  } else if (base.startsWith(query)) {
    score += 35;
  } else if (path.includes(`/${query}/`) || path.startsWith(`${query}/`)) {
    score += 25;
  } else if (path.endsWith(`/${query}`)) {
    score += 20;
  } else if (path.includes(query)) {
    score += 10;
  }

  if (matchesActiveRepo(item, options?.preferRepoId)) {
    score += 12;
  } else if (isLocalMentionResult(item) && !options?.preferRepoId) {
    score += 5;
  }

  const depth = path.split("/").length;
  score -= Math.max(0, depth - 4);

  return score;
}

export function rankMentionSearchResults(
  items: MentionSearchResult[],
  query: string,
  options?: MentionSearchMergeOptions
): MentionSearchResult[] {
  const needle = query.trim().toLowerCase();
  return [...items].sort(
    (left, right) => scoreMentionResult(right, needle, options) - scoreMentionResult(left, needle, options)
  );
}

/**
 * Merge up to MENTION_SEARCH_LIMIT hits per source, dedupe by path (active repo wins), rank, cap total.
 */
export function mergeHybridMentionSearchResults(
  graphItems: MentionSearchResult[],
  localItems: MentionSearchResult[],
  query: string,
  options?: MentionSearchMergeOptions
): MentionSearchResult[] {
  const merged = [...graphItems.slice(0, MENTION_SEARCH_LIMIT), ...localItems.slice(0, MENTION_SEARCH_LIMIT)];
  return rankMentionSearchResults(dedupeHybridMentionResults(merged, options), query, options).slice(
    0,
    MENTION_SEARCH_LIMIT
  );
}

/** Pro+ resolution: prefer on-disk workspace content over indexed remote fetch. */
export function preferMentionFileContent(
  localContent: string | undefined,
  remoteContent: string | undefined,
  existingSnippet: string | undefined
): string {
  const local = localContent?.trim();
  if (local) {
    return local;
  }
  const remote = remoteContent?.trim();
  if (remote) {
    return remote;
  }
  return existingSnippet?.trim() ?? "";
}

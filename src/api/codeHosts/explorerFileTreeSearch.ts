/** Rank repository file paths for remote workspace search (tree fallback). */
export function rankExplorerFilePaths(paths: string[], query: string, limit: number): string[] {
  const normalizedQuery = query.trim().toLowerCase().replace(/^\/+/, "");
  if (!normalizedQuery) {
    return [];
  }
  const queryBaseName = normalizedQuery.split("/").pop() ?? normalizedQuery;
  const queryStem = queryBaseName.replace(/\.[a-z0-9]+$/i, "");
  const queryHasPathSep = normalizedQuery.includes("/");

  const scored = paths
    .map((path) => ({
      path,
      score: scoreExplorerPath(
        path.toLowerCase(),
        normalizedQuery,
        queryBaseName,
        queryStem,
        queryHasPathSep
      )
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  return scored.slice(0, Math.max(limit, 1)).map((entry) => entry.path);
}

/**
 * Re-order existing search hits without dropping unmatched paths.
 * Use after host/cloud search so path-typed queries surface the exact file first.
 */
export function sortExplorerSearchHitsByQuery<T extends { path: string }>(
  hits: T[],
  query: string
): T[] {
  const normalizedQuery = query.trim().toLowerCase().replace(/^\/+/, "");
  if (!normalizedQuery || hits.length <= 1) {
    return hits;
  }
  const queryBaseName = normalizedQuery.split("/").pop() ?? normalizedQuery;
  const queryStem = queryBaseName.replace(/\.[a-z0-9]+$/i, "");
  const queryHasPathSep = normalizedQuery.includes("/");

  return [...hits].sort((a, b) => {
    const scoreA = scoreExplorerPath(
      a.path.toLowerCase(),
      normalizedQuery,
      queryBaseName,
      queryStem,
      queryHasPathSep
    );
    const scoreB = scoreExplorerPath(
      b.path.toLowerCase(),
      normalizedQuery,
      queryBaseName,
      queryStem,
      queryHasPathSep
    );
    return scoreB - scoreA || a.path.localeCompare(b.path);
  });
}

export function scoreExplorerPath(
  lowerPath: string,
  normalizedQuery: string,
  queryBaseName: string,
  queryStem: string,
  queryHasPathSep: boolean
): number {
  const fileName = lowerPath.split("/").pop() ?? "";

  // Exact full path always wins — including when the user pasted a full path.
  if (lowerPath === normalizedQuery) {
    return 100;
  }
  // Query is a trailing path suffix (e.g. "app/permissions/workspace.py").
  if (lowerPath.endsWith(`/${normalizedQuery}`)) {
    return 95;
  }
  if (!queryHasPathSep && lowerPath.endsWith(normalizedQuery) && fileName === normalizedQuery) {
    // Basename-only query that equals the filename (same as exact basename below).
    return 90;
  }
  if (queryHasPathSep && lowerPath.includes(normalizedQuery)) {
    return 85;
  }
  if (!queryHasPathSep && lowerPath.includes(`/${normalizedQuery}`)) {
    return 70;
  }

  if (queryHasPathSep) {
    // User typed a path: basename-only collisions are weak, not winners.
    if (fileName === queryBaseName) {
      return 40;
    }
    if (queryStem.length >= 3 && fileName.includes(queryStem)) {
      return 20;
    }
    return 0;
  }

  if (fileName === queryBaseName) {
    return 90;
  }
  if (queryStem.length >= 3 && fileName.includes(queryStem)) {
    return 60;
  }
  return 0;
}

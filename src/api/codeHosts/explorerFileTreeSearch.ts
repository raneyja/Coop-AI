/** Rank repository file paths for remote workspace search (tree fallback). */
export function rankExplorerFilePaths(paths: string[], query: string, limit: number): string[] {
  const normalizedQuery = query.trim().toLowerCase().replace(/^\/+/, "");
  if (!normalizedQuery) {
    return [];
  }
  const queryBaseName = normalizedQuery.split("/").pop() ?? normalizedQuery;
  const queryStem = queryBaseName.replace(/\.[a-z0-9]+$/i, "");

  const scored = paths
    .map((path) => ({
      path,
      score: scoreExplorerPath(path.toLowerCase(), normalizedQuery, queryBaseName, queryStem)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  return scored.slice(0, Math.max(limit, 1)).map((entry) => entry.path);
}

function scoreExplorerPath(
  lowerPath: string,
  normalizedQuery: string,
  queryBaseName: string,
  queryStem: string
): number {
  const fileName = lowerPath.split("/").pop() ?? "";
  if (fileName === queryBaseName) {
    return 100;
  }
  if (lowerPath === normalizedQuery) {
    return 98;
  }
  if (lowerPath.endsWith(`/${normalizedQuery}`) || lowerPath.endsWith(normalizedQuery)) {
    return 95;
  }
  if (lowerPath.includes(normalizedQuery)) {
    return 80;
  }
  if (queryStem.length >= 3 && fileName.includes(queryStem)) {
    return 60;
  }
  return 0;
}

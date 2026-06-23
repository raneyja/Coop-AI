/** Shared @-mention path scoring for lightningSearch and unit tests. */

export function mentionPathMinScore(_query: string): number {
  // Keyword @-mentions (e.g. @plugin) must match filename/path substrings, not only /plugin/ dirs.
  return 50;
}

export function scoreMentionPath(filePath: string, query: string): number {
  const path = filePath.toLowerCase();
  const needle = query.toLowerCase();
  if (path === needle) {
    return 100;
  }
  if (path.startsWith(`${needle}/`) || path.startsWith(needle)) {
    return 95;
  }
  if (path.endsWith(`/${needle}`) || path.endsWith(needle)) {
    return 90;
  }

  const queryParts = needle.split("/").filter(Boolean);
  const pathParts = path.split("/");
  let pathIdx = 0;
  let matchedSegments = 0;
  for (const part of queryParts) {
    while (pathIdx < pathParts.length) {
      const segment = pathParts[pathIdx];
      if (segment === part || segment.includes(part) || part.includes(segment)) {
        matchedSegments += 1;
        pathIdx += 1;
        break;
      }
      pathIdx += 1;
    }
  }
  if (queryParts.length > 0 && matchedSegments === queryParts.length) {
    return 75 + matchedSegments * 5;
  }

  if (path.includes(needle)) {
    return 50;
  }

  const queryBase = queryParts[queryParts.length - 1] ?? needle;
  const pathBase = pathParts[pathParts.length - 1] ?? "";
  if (pathBase === queryBase) {
    return 60;
  }
  if (pathBase.startsWith(queryBase)) {
    return 72;
  }

  return 0;
}

function rankMentionPathHits(
  hits: Array<{ repoId: string; path: string; content: string; lineNumber: number; score: number; source: string }>,
  query: string,
  limit: number
): typeof hits {
  const byPath = new Map<string, (typeof hits)[number]>();
  for (const hit of hits) {
    const key = `${hit.repoId}:${hit.path}`;
    const existing = byPath.get(key);
    if (!existing || scoreMentionPath(hit.path, query) > scoreMentionPath(existing.path, query)) {
      byPath.set(key, hit);
    }
  }
  return [...byPath.values()]
    .sort(
      (left, right) =>
        scoreMentionPath(right.path, query) - scoreMentionPath(left.path, query) ||
        left.path.localeCompare(right.path)
    )
    .slice(0, limit);
}

export { rankMentionPathHits };

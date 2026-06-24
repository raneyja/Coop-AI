/** Case and separator variants for a repository slug (e.g. Coop-AI → coop-ai). */
export function repoNameVariants(repoName: string): string[] {
  const trimmed = repoName.trim();
  if (!trimmed) {
    return [];
  }
  const variants = new Set<string>([trimmed, trimmed.toLowerCase()]);
  const hyphenated = trimmed.replace(/_/g, "-");
  const underscored = trimmed.replace(/-/g, "_");
  for (const candidate of [hyphenated, underscored]) {
    variants.add(candidate);
    variants.add(candidate.toLowerCase());
  }
  return [...variants];
}

/** Shared repo-scoped search terms for documentation integrations. */
export function buildRepoSearchTerms(owner: string | undefined, repo: string | undefined): string[] {
  const repoName = repo?.trim();
  if (!repoName) {
    return [];
  }
  const terms = new Set<string>();
  const ownerName = owner?.trim();
  for (const variant of repoNameVariants(repoName)) {
    if (ownerName) {
      terms.add(`${ownerName}/${variant}`);
      terms.add(`github:${ownerName}/${variant}`);
    }
    terms.add(variant);
  }
  return [...terms];
}

export function buildRepoOrQuery(
  owner: string | undefined,
  repo: string | undefined,
  extraTerms: string[] = []
): string | undefined {
  const terms = [...buildRepoSearchTerms(owner, repo), ...extraTerms.map((term) => term.trim()).filter(Boolean)];
  const uniqueTerms = [...new Set(terms)].slice(0, 16);
  return uniqueTerms.length > 0 ? uniqueTerms.join(" OR ") : undefined;
}

/** Split a joined `term1 OR term2` string for APIs that require one term per request. */
export function splitOrJoinedSearchTerms(query: string): string[] {
  return [...new Set(query.split(/\s+OR\s+/i).map((term) => term.trim()).filter(Boolean))];
}

export function buildConfluenceCql(
  owner: string | undefined,
  repo: string | undefined,
  extraTerms: string[] = []
): string | undefined {
  const terms = [...buildRepoSearchTerms(owner, repo), ...extraTerms.map((term) => term.trim()).filter(Boolean)];
  const uniqueTerms = [...new Set(terms)].slice(0, 16);
  if (uniqueTerms.length === 0) {
    return undefined;
  }
  const clauses = uniqueTerms.map((term) => `text ~ "${escapeCql(term)}"`);
  return `type=page AND (${clauses.join(" OR ")}) ORDER BY lastModified DESC`;
}

function escapeCql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Shared repo-scoped search terms for documentation integrations. */
export function buildRepoSearchTerms(owner: string | undefined, repo: string | undefined): string[] {
  const repoName = repo?.trim();
  if (!repoName) {
    return [];
  }
  const terms: string[] = [];
  const ownerName = owner?.trim();
  if (ownerName) {
    terms.push(`${ownerName}/${repoName}`);
    terms.push(`github:${ownerName}/${repoName}`);
  }
  terms.push(repoName);
  return terms;
}

export function buildRepoOrQuery(owner: string | undefined, repo: string | undefined): string | undefined {
  const terms = buildRepoSearchTerms(owner, repo);
  return terms.length > 0 ? terms.join(" OR ") : undefined;
}

export function buildConfluenceCql(owner: string | undefined, repo: string | undefined): string | undefined {
  const terms = buildRepoSearchTerms(owner, repo);
  if (terms.length === 0) {
    return undefined;
  }
  const clauses = terms.map((term) => `text ~ "${escapeCql(term)}"`);
  return `type=page AND (${clauses.join(" OR ")}) ORDER BY lastModified DESC`;
}

function escapeCql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

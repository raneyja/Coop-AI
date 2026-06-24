import type { CodeHostProvider } from "./types";

/**
 * Build a GitHub code-search query for the remote workspace file picker.
 * Prefer `path:` / `filename:` qualifiers — bare terms with `in:path` often 422.
 */
export function buildExplorerFileSearchQuery(query: string, provider: CodeHostProvider): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (provider === "github") {
    if (trimmed.includes("/")) {
      return `path:${trimmed}`;
    }
    if (/\.[a-z0-9]+$/i.test(trimmed)) {
      return `filename:${trimmed}`;
    }
    return `path:${trimmed}`;
  }
  return trimmed;
}

/** Quote repo slugs for GitHub code search when they contain hyphens or dots. */
export function formatGithubRepoSearchClause(owner: string, repo: string): string {
  const slug = `${owner}/${repo}`;
  if (/[-.]/.test(slug)) {
    return `repo:"${slug}"`;
  }
  return `repo:${slug}`;
}

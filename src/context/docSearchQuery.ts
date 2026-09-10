import {
  CODE_HOST_PROVIDERS,
  codeHostPrefixedRepoIds,
  isCodeHostProvider,
  type CodeHostProvider
} from "../api/codeHosts/types";

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

function canonicalRepoSlugs(repoName: string): string[] {
  return [...new Set([repoName.trim(), repoName.trim().toLowerCase()].filter(Boolean))];
}

function hostsForSearch(preferHost?: CodeHostProvider): readonly CodeHostProvider[] {
  if (!preferHost) {
    return CODE_HOST_PROVIDERS;
  }
  return [preferHost, ...CODE_HOST_PROVIDERS.filter((host) => host !== preferHost)];
}

/**
 * Shared repo-scoped search terms for Slack, Teams, Jira, Confluence, Notion, Google Docs.
 * Prefixed ids (`github:` / `gitlab:` / `bitbucket:`) cover every shipped host.
 * Underscore/hyphen mutations stay unprefixed so JQL/CQL does not explode.
 */
export function buildRepoSearchTerms(
  owner: string | undefined,
  repo: string | undefined,
  options?: { preferHost?: CodeHostProvider }
): string[] {
  const repoName = repo?.trim();
  if (!repoName) {
    return [];
  }
  const terms = new Set<string>();
  const ownerName = owner?.trim();
  for (const variant of repoNameVariants(repoName)) {
    terms.add(variant);
    if (ownerName) {
      terms.add(`${ownerName}/${variant}`);
    }
  }
  if (ownerName) {
    const preferHost = isCodeHostProvider(options?.preferHost) ? options.preferHost : undefined;
    const prefixed = canonicalRepoSlugs(repoName).flatMap((slug) =>
      codeHostPrefixedRepoIds(ownerName, slug)
    );
    for (const host of hostsForSearch(preferHost)) {
      for (const id of prefixed) {
        if (id.startsWith(`${host}:`)) {
          terms.add(id);
        }
      }
    }
  }
  return [...terms];
}

export function buildRepoOrQuery(
  owner: string | undefined,
  repo: string | undefined,
  extraTerms: string[] = []
): string | undefined {
  const extras = extraTerms.map((term) => term.trim()).filter(Boolean);
  const terms = [...extras, ...buildRepoSearchTerms(owner, repo)];
  const uniqueTerms = [...new Set(terms)].slice(0, 16);
  return uniqueTerms.length > 0 ? uniqueTerms.join(" OR ") : undefined;
}

/** Split a joined `term1 OR term2` string for APIs that require one term per request. */
export function splitOrJoinedSearchTerms(query: string): string[] {
  return [...new Set(query.split(/\s+OR\s+/i).map((term) => term.trim()).filter(Boolean))];
}

/**
 * Build Confluence CQL for Use-repo (+ optional focus/file extras).
 *
 * When both repo and non-repo extras exist, require (repo) AND (extras) so a
 * vague focus token like "documentation" cannot surface foreign Coop-AI ADRs
 * as equal-weight OR hits for another Use-repo (e.g. documenso).
 */
export function buildConfluenceCql(
  owner: string | undefined,
  repo: string | undefined,
  extraTerms: string[] = [],
  options?: { andExtrasWithRepo?: boolean }
): string | undefined {
  const repoTerms = buildRepoSearchTerms(owner, repo);
  const repoKeys = new Set(repoTerms.map((term) => term.toLowerCase()));
  const extras = [
    ...new Set(extraTerms.map((term) => term.trim()).filter(Boolean))
  ]
    .filter((term) => !repoKeys.has(term.toLowerCase()))
    .slice(0, 12);

  if (repoTerms.length === 0 && extras.length === 0) {
    return undefined;
  }

  const clause = (term: string): string => `text ~ "${escapeCql(term)}"`;
  const andExtras = options?.andExtrasWithRepo !== false;

  if (andExtras && repoTerms.length > 0 && extras.length > 0) {
    const repoClause = repoTerms.map(clause).join(" OR ");
    const extraClause = extras.map(clause).join(" OR ");
    return `type=page AND (${repoClause}) AND (${extraClause}) ORDER BY lastModified DESC`;
  }

  const uniqueTerms = [...repoTerms, ...extras].slice(0, 16);
  return `type=page AND (${uniqueTerms.map(clause).join(" OR ")}) ORDER BY lastModified DESC`;
}

/** Repo-only Confluence CQL (fallback when repo∩focus returns no pages). */
export function buildConfluenceRepoOnlyCql(
  owner: string | undefined,
  repo: string | undefined
): string | undefined {
  return buildConfluenceCql(owner, repo, [], { andExtrasWithRepo: false });
}

function escapeCql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

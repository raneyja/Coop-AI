import { cloneHostForProvider, parseRepoId } from "../server/gitCloneService";

/**
 * Zoekt repository name is tenant-scoped.
 * `zoekt-webserver -index` loads only `*.zoekt` files that are direct children
 * of that directory (`filepath.Glob`, not a recursive walk). Shard filenames
 * are `url.QueryEscape(Repository.Name)_v{version}.{n}.zoekt`, so a name prefix
 * stays a single flat file and still isolates orgs.
 *
 * Name: `{orgId}__{host}/{owner}/{repo}`
 * Example: `3f2a…__github.com/acme/app`
 * File: `{ZOEKT_INDEX_PATH}/3f2a…__github.com%2Facme%2Fapp_v16.00000.zoekt`
 *
 * Two orgs indexing the same slug get two shards. Search filters `repo:` to
 * that name, so one org cannot match the other's shard.
 */
export const ZOEKT_ORG_SEPARATOR = "__";

export function zoektRepoName(orgId: string, repoId: string): string {
  const parsed = parseRepoId(repoId);
  const host = cloneHostForProvider(parsed.provider);
  return `${orgId}${ZOEKT_ORG_SEPARATOR}${host}/${parsed.owner}/${parsed.repo}`;
}

export function buildZoektRepoFilter(orgId: string, repoIds: string[]): string {
  if (!orgId || repoIds.length === 0) {
    return "";
  }
  const repoNames = repoIds.map((repoId) => zoektRepoName(orgId, repoId));
  return repoNames.length === 1
    ? `repo:${quoteZoektToken(repoNames[0])}`
    : `(${repoNames.map((name) => `repo:${quoteZoektToken(name)}`).join(" or ")})`;
}

/** Empty string means "do not query Zoekt" — never an unscoped `q=`. */
export function buildZoektScopedQuery(orgId: string, query: string, repoIds: string[]): string {
  const repoFilter = buildZoektRepoFilter(orgId, repoIds);
  if (!repoFilter) {
    return "";
  }
  return `${repoFilter} ${query}`.trim();
}

export function repoIdFromZoektRepo(
  repository: string | undefined,
  orgId: string,
  repoIds: string[]
): string {
  if (!repository || !orgId) {
    return "";
  }
  const normalizedRepo = repository.toLowerCase();
  const exact = repoIds.find((id) => zoektRepoName(orgId, id).toLowerCase() === normalizedRepo);
  return exact ?? "";
}

/** Match Go's `url.QueryEscape` for shard filenames (slash → %2F, unreserved left alone). */
export function goQueryEscape(value: string): string {
  let encoded = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-_.~]/.test(char)) {
      encoded += char;
      continue;
    }
    if (char === " ") {
      encoded += "+";
      continue;
    }
    encoded += encodeURIComponent(char);
  }
  return encoded;
}

export function zoektShardFilePrefix(orgId: string, repoId: string): string {
  return goQueryEscape(zoektRepoName(orgId, repoId));
}

export function zoektOrgShardPrefix(orgId: string): string {
  return goQueryEscape(`${orgId}${ZOEKT_ORG_SEPARATOR}`);
}

function quoteZoektToken(value: string): string {
  return value.includes(" ") ? `"${value.replace(/"/g, '\\"')}"` : value;
}

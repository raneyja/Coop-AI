import type { ResolvedIntegrationScope } from "./types";

export function isGoogleDocsScopeBlocked(scope: ResolvedIntegrationScope | undefined): boolean {
  if (!scope?.enforced) {
    return false;
  }
  return !scope.allowed;
}

export function googleDocsScopeBlockMessage(scope: ResolvedIntegrationScope | undefined): string {
  return (
    scope?.reason ??
    "Google Docs scope is not configured. Your organization admin must select folders or shared drives in the admin portal."
  );
}

/** Build a Drive API `q` clause restricting files to allowlisted parent folders. */
export function buildDriveParentsClause(expandedFolderIds: string[]): string {
  const ids = expandedFolderIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    return "";
  }
  if (ids.length === 1) {
    return `'${escapeDriveQuery(ids[0]!)}' in parents`;
  }
  return `(${ids.map((id) => `'${escapeDriveQuery(id)}' in parents`).join(" or ")})`;
}

/** Append Drive parent-folder filters so queries only hit allowlisted folders. */
export function applyGoogleDocsFolderScope(
  queries: string[],
  expandedFolderIds: string[]
): string[] {
  const clause = buildDriveParentsClause(expandedFolderIds);
  if (!clause) {
    return queries;
  }
  return queries.map((query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return clause;
    }
    return `(${trimmed}) and (${clause})`;
  });
}

export function filterGoogleDocsHitsByFolder<T extends { parents?: string[] }>(
  hits: T[],
  allowedFolderIds: Set<string>
): T[] {
  if (allowedFolderIds.size === 0) {
    return hits;
  }
  return hits.filter((hit) => {
    const parents = hit.parents ?? [];
    return parents.some((parentId) => allowedFolderIds.has(parentId.trim()));
  });
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

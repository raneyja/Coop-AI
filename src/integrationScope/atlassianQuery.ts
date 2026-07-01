import type { ResolvedIntegrationScope } from "./types";

export function isJiraScopeBlocked(scope: ResolvedIntegrationScope | undefined): boolean {
  if (!scope?.enforced) {
    return false;
  }
  if (!scope.allowed) {
    return true;
  }
  return (scope.atlassian?.jiraProjectIds.length ?? 0) === 0;
}

export function isConfluenceScopeBlocked(scope: ResolvedIntegrationScope | undefined): boolean {
  if (!scope?.enforced) {
    return false;
  }
  if (!scope.allowed) {
    return true;
  }
  return (scope.atlassian?.confluenceSpaceIds.length ?? 0) === 0;
}

export function jiraScopeBlockMessage(scope: ResolvedIntegrationScope | undefined): string {
  return (
    scope?.reason ??
    "Jira scope is not configured. Your organization admin must select Jira projects in the admin portal."
  );
}

export function confluenceScopeBlockMessage(scope: ResolvedIntegrationScope | undefined): string {
  return (
    scope?.reason ??
    "Confluence scope is not configured. Your organization admin must select Confluence spaces in the admin portal."
  );
}

/** Append Jira `project in (...)` filters so queries only hit allowlisted projects. */
export function applyJiraProjectScope(
  queries: string[],
  projectIds: string[],
  projectKeys: string[]
): string[] {
  void projectIds;
  const keys = projectKeys.map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) {
    return queries;
  }
  const keyList = keys.map((key) => `"${escapeJqlString(key)}"`).join(", ");
  const scopeClause = `project in (${keyList})`;
  return queries.map((query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return scopeClause;
    }
    return `(${trimmed}) AND (${scopeClause})`;
  });
}

/** Append Confluence `space in (...)` filters so queries only hit allowlisted spaces. */
export function applyConfluenceSpaceScope(
  queries: string[],
  spaceIds: string[],
  spaceKeys: string[]
): string[] {
  void spaceIds;
  const keys = spaceKeys.map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) {
    return queries;
  }
  const keyList = keys.map((key) => `"${escapeCqlString(key)}"`).join(", ");
  const scopeClause = `space in (${keyList})`;
  return queries.map((query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return scopeClause;
    }
    return `(${trimmed}) AND (${scopeClause})`;
  });
}

export function filterJiraIssuesByProject<T extends { key: string }>(
  issues: T[],
  allowedProjectKeys: Set<string>
): T[] {
  if (allowedProjectKeys.size === 0) {
    return issues;
  }
  return issues.filter((issue) => {
    const projectKey = issue.key.split("-")[0]?.toUpperCase();
    return projectKey ? allowedProjectKeys.has(projectKey) : false;
  });
}

function escapeJqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeCqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

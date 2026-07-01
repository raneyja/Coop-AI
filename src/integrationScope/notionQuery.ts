import type { ResolvedIntegrationScope } from "./types";

export function isNotionScopeBlocked(scope: ResolvedIntegrationScope | undefined): boolean {
  if (!scope?.enforced) {
    return false;
  }
  return !scope.allowed;
}

export function notionScopeBlockMessage(scope: ResolvedIntegrationScope | undefined): string {
  return (
    scope?.reason ??
    "Notion scope is not configured. Your organization admin must select pages and databases in the admin portal."
  );
}

export function filterNotionPagesByScope<T extends { id: string; parentId?: string }>(
  pages: T[],
  allowedResourceIds: Set<string>
): T[] {
  if (allowedResourceIds.size === 0) {
    return pages;
  }
  return pages.filter((page) => {
    if (allowedResourceIds.has(page.id)) {
      return true;
    }
    const parentId = page.parentId?.trim();
    return parentId ? allowedResourceIds.has(parentId) : false;
  });
}

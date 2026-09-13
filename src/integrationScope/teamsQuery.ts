import type { ResolvedIntegrationScope } from "./types";

export function isTeamsScopeBlocked(scope: ResolvedIntegrationScope | undefined): boolean {
  if (!scope?.enforced) {
    return false;
  }
  if (!scope.allowed) {
    return true;
  }
  return (scope.teams?.channelIds.length ?? 0) === 0;
}

export function teamsScopeBlockMessage(scope: ResolvedIntegrationScope | undefined): string {
  return (
    scope?.reason ??
    "Teams scope is not configured. Your organization admin must select Teams channels in the admin portal."
  );
}

export function filterTeamsHitsByChannel<T extends { channelId?: string }>(
  hits: T[],
  allowedChannelIds: Set<string>
): T[] {
  if (allowedChannelIds.size === 0) {
    return hits;
  }
  return hits.filter((hit) => {
    const id = hit.channelId?.trim();
    return !id || allowedChannelIds.has(id);
  });
}

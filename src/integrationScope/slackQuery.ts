import type { ResolvedIntegrationScope } from "./types";

export function isSlackScopeBlocked(scope: ResolvedIntegrationScope | undefined): boolean {
  if (!scope?.enforced) {
    return false;
  }
  return !scope.allowed;
}

export function slackScopeBlockMessage(scope: ResolvedIntegrationScope | undefined): string {
  return (
    scope?.reason ??
    "Slack scope is not configured. Your organization admin must select channels in the admin portal."
  );
}

/** Append Slack search `in:channel` filters so queries only hit allowlisted channels. */
export function applySlackChannelScope(
  queries: string[],
  channelIds: string[],
  channelNames: string[]
): string[] {
  if (channelIds.length === 0) {
    return queries;
  }
  const filters = new Set<string>();
  for (const id of channelIds) {
    const trimmed = id.trim();
    if (trimmed) {
      filters.add(`in:${trimmed}`);
    }
  }
  for (const name of channelNames) {
    const trimmed = name.trim().replace(/^#/, "");
    if (trimmed) {
      filters.add(`in:${trimmed}`);
    }
  }
  if (filters.size === 0) {
    return queries;
  }
  const scopeClause = [...filters].join(" OR ");
  return queries.map((query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return scopeClause;
    }
    return `(${trimmed}) (${scopeClause})`;
  });
}

export function filterSlackHitsByChannel<T extends { channelId?: string }>(
  hits: T[],
  allowedChannelIds: Set<string>
): T[] {
  if (allowedChannelIds.size === 0) {
    return hits;
  }
  return hits.filter((hit) => {
    const channelId = hit.channelId?.trim();
    return channelId ? allowedChannelIds.has(channelId) : false;
  });
}

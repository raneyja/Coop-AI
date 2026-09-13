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

/**
 * Job-scoped Slack searches: phrase, then the empty retry. Not one call per channel.
 * The retry counts against this cap — do not add a third call to cover more channels.
 */
export const MAX_JOB_SCOPED_SLACK_QUERIES = 2;

/** User-supplied modifiers that can point Slack at a channel the admin did not allow. */
const SLACK_JOB_OPERATOR =
  /\b(?:in|from|has|is):(?:<[^>]+>|"[^"]*"|'[^']*'|[^\s]+)/gi;

/**
 * Drop Slack search operators from a job term before it is sent.
 * `in:` / `from:` / `has:` / `is:` are not words — they redirect the search.
 */
export function stripSlackSearchOperators(term: string): string {
  return term.replace(SLACK_JOB_OPERATOR, " ").replace(/\s+/g, " ").trim();
}

/**
 * Slack search has no boolean OR. One `in:<#id>` query per allowlisted channel.
 * Parentheses and the word OR become required words and zero the result.
 */
export function applySlackChannelScope(
  queries: string[],
  channelIds: string[],
  channelNames: string[]
): string[] {
  const modifiers = slackChannelModifiers(channelIds, channelNames);
  if (modifiers.length === 0) {
    return queries;
  }
  const expanded: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    for (const modifier of modifiers) {
      const next = trimmed ? `${trimmed} ${modifier}` : modifier;
      if (!expanded.includes(next)) {
        expanded.push(next);
      }
    }
  }
  return expanded;
}

/**
 * Restrict job Slack queries to an allowlist without fanning out one call per channel.
 * Enforced: every returned query includes one allowlisted `in:` (id, or name fallback).
 * Spend the cap on the meaning phrase across allowlisted channels, and stop the caller
 * early if that hits. The empty retry uses the same allowlist and only runs if a call
 * remains — it must not add a third request, and it must not drop the `in:`.
 * Unenforced: return the meaning queries unchanged. Do not invent channels.
 */
export function scopeJobSlackSearchQueries(
  queries: string[],
  channelIds: string[],
  channelNames: string[],
  options?: { enforced?: boolean; maxCalls?: number; allowEmpty?: boolean }
): string[] {
  const maxCalls = options?.maxCalls ?? MAX_JOB_SCOPED_SLACK_QUERIES;
  const base = [
    ...new Set(
      queries
        .map((query) => stripSlackSearchOperators(query))
        .map((query) => query.trim())
        .filter(Boolean)
    )
  ].slice(0, maxCalls);
  if (!options?.enforced) {
    return base;
  }
  const modifiers = slackChannelModifiers(channelIds, channelNames);
  if (modifiers.length === 0) {
    return [];
  }
  const primary = base[0];
  const retry = base[1];
  if (!primary && options.allowEmpty) {
    return modifiers.slice(0, maxCalls);
  }
  if (!primary) {
    return [];
  }
  const picked: string[] = [];
  const push = (query: string): void => {
    if (picked.length >= maxCalls || picked.includes(query)) {
      return;
    }
    picked.push(query);
  };
  for (const modifier of modifiers) {
    push(`${primary} ${modifier}`);
  }
  if (retry) {
    push(`${retry} ${modifiers[0]}`);
  }
  return picked;
}

function slackChannelModifiers(channelIds: string[], channelNames: string[]): string[] {
  const modifiers: string[] = [];
  for (const id of channelIds) {
    const trimmed = id.trim();
    if (!trimmed) {
      continue;
    }
    modifiers.push(trimmed.startsWith("<#") ? `in:${trimmed}` : `in:<#${trimmed}>`);
  }
  if (modifiers.length === 0) {
    for (const name of channelNames) {
      const trimmed = name.trim().replace(/^#/, "");
      if (trimmed) {
        modifiers.push(`in:#${trimmed}`);
      }
    }
  }
  return modifiers;
}

export { textSearchTerm as slackSearchTerm } from "../context/integrationSearchTerms";

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

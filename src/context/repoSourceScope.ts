import type { IntegrationChatProvider } from "../chat/types";
import { detectExplicitlyNamedTools } from "../chat/intentPlanner/planChatJobs";

/** User constraints outrank inferred tools and slash/quick-action heuristics. */
export type RepoSourceScope = {
  repositoryOnly: boolean;
  excludedIntegrations: IntegrationChatProvider[];
};

export function resolveRepoSourceScope(query = ""): RepoSourceScope {
  const text = query.replace(/[’]/g, "'").replace(/[`\"]/g, "");
  const repository = "(?:repo(?:sitory)?|codebase)";
  const selected = "(?:(?:the|this|our)\\s+)?(?:(?:selected|remote|indexed|active|current)\\s+)*(?:[\\w.-]+/[\\w.-]+\\s+)?";
  const repositoryOnly = new RegExp([
    `\\b${repository}[- ]only\\b`,
    `\\b(?:only|exclusively|solely)\\s+(?:(?:use|using|from|within|consult|search|in)\\s+)?(?:(?:the\\s+)?(?:files?|context|sources?)\\s+(?:in|from|within)\\s+)?${selected}${repository}\\b`,
    `\\b(?:using|from|within|in)\\s+${selected}${repository}\\s+(?:(?:context|sources?|files?)\\s+)?(?:only|exclusively)\\b`,
    "\\b(?:do not|don't|never|without|no|exclude|avoid)\\s+(?:use\\s+|search\\s+|consult\\s+)?(?:any\\s+)?external\\s+(?:sources?|integrations?|tools?)\\b",
    "\\b(?:(?:do not|don't|never|without|exclude|avoid)\\s+(?:use\\s+|search\\s+|consult\\s+)?(?:any\\s+)?|(?:use\\s+)?no\\s+)(?:integrations?|external\\s+tools?)\\b"
  ].join("|"), "i").test(text);
  const excluded = new Set<IntegrationChatProvider>();
  // Keep negation scoped to its clause: a later positive request is independent.
  for (const clause of text.split(/[.;!?\n]|\b(?:then|but)\b|,?\s+and\s+(?=(?:search|consult|read|use|check|look)\b)/i)) {
    const negative = clause.match(/\b(?:do not|don't|never|without|exclude|avoid|no)\b([\s\S]*)/i);
    if (!negative) continue;
    for (const provider of detectExplicitlyNamedTools(negative[1])) excluded.add(provider);
  }
  return { repositoryOnly, excludedIntegrations: [...excluded] };
}

export function scopeAllowsIntegration(scope: RepoSourceScope, provider: IntegrationChatProvider): boolean {
  return !scope.repositoryOnly && !scope.excludedIntegrations.includes(provider);
}

export function scopedIntegrations(
  providers: IntegrationChatProvider[], scope: RepoSourceScope
): IntegrationChatProvider[] {
  return providers.filter((provider) => scopeAllowsIntegration(scope, provider));
}

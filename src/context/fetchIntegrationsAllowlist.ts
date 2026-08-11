/**
 * Request param helper — Phase 1 tool allowlist.
 * When `fetchIntegrations` includes a provider, shouldFetch* must return true
 * even if the user never said "Slack" / "Jira".
 */
import type { IntegrationChatProvider } from "../chat/types";
import type { ContextFetchRequest } from "./requestBatcher";

export function normalizeFetchIntegrations(
  value: unknown
): IntegrationChatProvider[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: IntegrationChatProvider[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const key = item.trim().toLowerCase();
    if (
      key !== "jira" &&
      key !== "slack" &&
      key !== "teams" &&
      key !== "confluence" &&
      key !== "notion" &&
      key !== "google-docs"
    ) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key as IntegrationChatProvider);
  }
  return out;
}

/** True when this request's plan allowlist forces a fetch for `provider`. */
export function requestAllowsIntegrationFetch(
  request: ContextFetchRequest,
  provider: IntegrationChatProvider
): boolean {
  if (request.params.integrationProvider === provider) {
    return true;
  }
  const allowlist = normalizeFetchIntegrations(request.params.fetchIntegrations);
  return allowlist.includes(provider);
}

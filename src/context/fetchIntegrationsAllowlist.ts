/**
 * Request param helper — Phase 1 tool allowlist.
 *
 * When `fetchIntegrations` is non-empty it is a hard restrict list for that turn:
 * only listed providers may fetch (planner said "Jira only" must not pull Slack).
 * When empty/undefined, existing heuristics apply; `requestAllowsIntegrationFetch`
 * still force-includes a provider that appears on the list or as integrationProvider.
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

/** Non-empty planner/slash allowlist for this request, if any. */
export function fetchIntegrationsAllowlist(
  request: ContextFetchRequest
): IntegrationChatProvider[] {
  return normalizeFetchIntegrations(request.params.fetchIntegrations);
}

/**
 * When an allowlist is set, only listed providers may fetch.
 * Returns:
 * - `"allow"` — no restrict list; caller runs normal heuristics
 * - `"include"` — restrict list is active and this provider is on it
 * - `"exclude"` — restrict list is active and this provider is not on it
 */
export function integrationFetchGate(
  request: ContextFetchRequest,
  provider: IntegrationChatProvider
): "allow" | "include" | "exclude" {
  if (request.params.integrationProvider === provider) {
    return "include";
  }
  const allowlist = fetchIntegrationsAllowlist(request);
  if (allowlist.length === 0) {
    return "allow";
  }
  return allowlist.includes(provider) ? "include" : "exclude";
}

/** True when this request's plan allowlist forces a fetch for `provider`. */
export function requestAllowsIntegrationFetch(
  request: ContextFetchRequest,
  provider: IntegrationChatProvider
): boolean {
  return integrationFetchGate(request, provider) === "include";
}

/**
 * Shared shouldFetch* entry: honor restrict list, otherwise run heuristics.
 * Pass `heuristic` only when gate is `"allow"`.
 */
export function shouldFetchIntegrationWithAllowlist(
  request: ContextFetchRequest,
  provider: IntegrationChatProvider,
  heuristic: () => boolean
): boolean {
  const gate = integrationFetchGate(request, provider);
  if (gate === "exclude") {
    return false;
  }
  if (gate === "include") {
    return true;
  }
  return heuristic();
}

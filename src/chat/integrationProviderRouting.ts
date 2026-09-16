import type { IntegrationChatProvider } from "./types";
import { isIncidentShapedQuery } from "../context/incidentIntent";
import { isTeamsComingSoon } from "../integrations/teamsAvailability";
import { detectNamedTools } from "./intentPlanner/planChatIntent";

/**
 * Plain-chat integration single-routing.
 *
 * Incident / on-call asks often say “Jira tickets and Slack threads” — that must
 * NOT steal the turn into Jira-only synthesis (which skips incident reconstruction).
 * Integrations still fetch via shouldFetchIncidentIntegrations on chat_context.
 *
 * When the user names 2+ tools, never single-route — multi-tool allowlist owns the turn.
 * Named-product list only (plus ticket keys for Jira). Not “tickets/pages/docs in this repo”.
 */
export function resolvePlainChatIntegrationProvider(options: {
  message: string;
  isConnected: (provider: IntegrationChatProvider) => boolean;
}): IntegrationChatProvider | undefined {
  const message = options.message?.trim() ?? "";
  if (!message) {
    return undefined;
  }
  if (isIncidentShapedQuery(message)) {
    return undefined;
  }

  const named = detectNamedTools(message);
  if (named.length >= 2) {
    return undefined;
  }
  const provider = named[0];
  if (!provider) {
    return undefined;
  }
  if (provider === "teams" && isTeamsComingSoon()) {
    return undefined;
  }
  if (options.isConnected(provider) || named.length === 1) {
    return provider;
  }
  return undefined;
}

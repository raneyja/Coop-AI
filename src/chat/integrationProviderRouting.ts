import type { IntegrationChatProvider } from "./types";
import { isIncidentShapedQuery } from "../context/incidentIntent";
import { wantsJiraContext } from "../context/jiraContext";
import { wantsSlackContext } from "../context/slackContext";
import { wantsTeamsContext } from "../context/teamsContext";
import { wantsConfluenceContext } from "../context/confluenceContext";
import { wantsNotionContext } from "../context/notionContext";
import { wantsGoogleDocsContext } from "../context/googleDocsContext";

/**
 * Plain-chat integration single-routing.
 *
 * Incident / on-call asks often say “Jira tickets and Slack threads” — that must
 * NOT steal the turn into Jira-only synthesis (which skips incident reconstruction).
 * Integrations still fetch via shouldFetchIncidentIntegrations on chat_context.
 *
 * When the user names 2+ tools, never single-route — multi-tool allowlist owns the turn.
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

  const named: IntegrationChatProvider[] = [];
  const pushIf = (provider: IntegrationChatProvider, wants: boolean): void => {
    if (wants) {
      named.push(provider);
    }
  };
  pushIf("jira", wantsJiraContext(message));
  pushIf("slack", wantsSlackContext(message));
  pushIf("teams", wantsTeamsContext(message));
  pushIf("confluence", wantsConfluenceContext(message));
  pushIf("notion", wantsNotionContext(message));
  pushIf("google-docs", wantsGoogleDocsContext(message));
  if (named.length >= 2) {
    return undefined;
  }

  for (const provider of named) {
    if (options.isConnected(provider) || named.length === 1) {
      // Single named tool: route even when disconnected so Sources can show not-connected.
      return provider;
    }
  }
  return undefined;
}

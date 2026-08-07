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
  if (options.isConnected("jira") && wantsJiraContext(message)) {
    return "jira";
  }
  if (options.isConnected("slack") && wantsSlackContext(message)) {
    return "slack";
  }
  if (options.isConnected("teams") && wantsTeamsContext(message)) {
    return "teams";
  }
  if (options.isConnected("confluence") && wantsConfluenceContext(message)) {
    return "confluence";
  }
  if (options.isConnected("notion") && wantsNotionContext(message)) {
    return "notion";
  }
  if (options.isConnected("google-docs") && wantsGoogleDocsContext(message)) {
    return "google-docs";
  }
  return undefined;
}

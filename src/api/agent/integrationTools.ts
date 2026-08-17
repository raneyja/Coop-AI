import type { IntegrationChatProvider } from "../../chat/types";
import type { AgentToolName } from "./agentTypes";

/** Agent tool ↔ planner allowlist provider. */
export const AGENT_INTEGRATION_TOOLS = {
  search_slack: "slack",
  search_jira: "jira",
  search_teams: "teams",
  search_notion: "notion",
  search_confluence: "confluence",
  search_google_docs: "google-docs"
} as const satisfies Record<string, IntegrationChatProvider>;

export type AgentIntegrationToolName = keyof typeof AGENT_INTEGRATION_TOOLS;

export const AGENT_INTEGRATION_TOOL_NAMES = Object.keys(
  AGENT_INTEGRATION_TOOLS
) as AgentIntegrationToolName[];

export function isAgentIntegrationTool(tool: string): tool is AgentIntegrationToolName {
  return tool in AGENT_INTEGRATION_TOOLS;
}

export function providerForAgentIntegrationTool(
  tool: AgentIntegrationToolName
): IntegrationChatProvider {
  return AGENT_INTEGRATION_TOOLS[tool];
}

export function agentToolForIntegrationProvider(
  provider: IntegrationChatProvider
): AgentIntegrationToolName | undefined {
  for (const [tool, mapped] of Object.entries(AGENT_INTEGRATION_TOOLS) as Array<
    [AgentIntegrationToolName, IntegrationChatProvider]
  >) {
    if (mapped === provider) {
      return tool;
    }
  }
  return undefined;
}

/** Bundle data keys used by synthesis formatters. */
export const INTEGRATION_BUNDLE_KEY: Record<IntegrationChatProvider, string> = {
  slack: "slackSearch",
  jira: "jiraSearch",
  teams: "teamsSearch",
  notion: "notionSearch",
  confluence: "confluenceSearch",
  "google-docs": "googleDocsSearch"
};

export function integrationToolLabel(tool: AgentIntegrationToolName): string {
  switch (tool) {
    case "search_slack":
      return "Slack";
    case "search_jira":
      return "Jira";
    case "search_teams":
      return "Teams";
    case "search_notion":
      return "Notion";
    case "search_confluence":
      return "Confluence";
    case "search_google_docs":
      return "Google Docs";
    default:
      return tool;
  }
}

export function allowedIntegrationToolSet(
  providers: IntegrationChatProvider[] | undefined
): Set<AgentToolName> {
  const allowed = new Set<AgentToolName>();
  for (const provider of providers ?? []) {
    const tool = agentToolForIntegrationProvider(provider);
    if (tool) {
      allowed.add(tool);
    }
  }
  return allowed;
}

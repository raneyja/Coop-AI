import { JiraClient } from "../jira/jiraClient";
import { SlackClient } from "../slack/slackClient";
import { TeamsClient } from "../teams/teamsClient";
import type { IntegrationSecrets } from "./integrationSecrets";

export type DecisionIntegrationProvider = "slack" | "jira" | "teams";

export async function testDecisionIntegration(
  provider: DecisionIntegrationProvider,
  secrets: IntegrationSecrets
): Promise<{ ok: boolean; message: string }> {
  const creds = await secrets.getCredentials();
  switch (provider) {
    case "slack": {
      if (!creds.slackToken) {
        return { ok: false, message: "Slack token is not configured. Add a token in settings." };
      }
      return new SlackClient({ token: creds.slackToken }).testConnection();
    }
    case "jira": {
      if (!creds.jiraEmail || !creds.jiraToken) {
        return { ok: false, message: "Jira email and API token are required." };
      }
      return new JiraClient({
        baseUrl: creds.jiraBaseUrl ?? "https://your-domain.atlassian.net",
        email: creds.jiraEmail,
        apiToken: creds.jiraToken
      }).testConnection();
    }
    case "teams": {
      if (!creds.teamsToken) {
        return { ok: false, message: "Microsoft Teams (Graph) token is not configured." };
      }
      return new TeamsClient({ accessToken: creds.teamsToken }).testConnection();
    }
    default:
      return { ok: false, message: `Unknown integration: ${provider}` };
  }
}

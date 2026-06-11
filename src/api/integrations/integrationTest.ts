import { ConfluenceClient } from "../confluence/confluenceClient";
import {
  confluenceSiteHostname,
  confluenceSiteUrlError,
  resolveConfluenceAuth,
  resolveConfluenceBaseUrl,
  type ConfluenceAuth
} from "../confluence/resolveConfluenceBaseUrl";
import { GoogleDocsClient } from "../googleDocs/googleDocsClient";
import { JiraClient } from "../jira/jiraClient";
import { NotionClient } from "../notion/notionClient";
import { SlackClient } from "../slack/slackClient";
import { TeamsClient } from "../teams/teamsClient";
import {
  createConfluenceClientFromCredentials,
  createJiraClientFromCredentials
} from "./buildIntegrationClients";
import type { IntegrationSecrets } from "./integrationSecrets";
import type { IntegrationChatProvider } from "../../chat/types";

export type DecisionIntegrationProvider = Extract<
  IntegrationChatProvider,
  "slack" | "jira" | "teams"
>;

export type IntegrationTestDraft = {
  email?: string;
  token?: string;
  baseUrl?: string;
};

export async function testDecisionIntegration(
  provider: DecisionIntegrationProvider,
  secrets: IntegrationSecrets
): Promise<{ ok: boolean; message: string }> {
  return testIntegrationChat(provider, secrets);
}

export async function testIntegrationChat(
  provider: IntegrationChatProvider,
  secrets: IntegrationSecrets,
  draft?: IntegrationTestDraft
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
      const email = draft?.email?.trim() || creds.jiraEmail;
      const token = draft?.token?.trim() || creds.jiraToken;
      const client =
        draft?.email || draft?.token
          ? new JiraClient({
              baseUrl: draft?.baseUrl?.trim() || creds.jiraBaseUrl || "https://your-domain.atlassian.net",
              email,
              apiToken: token
            })
          : createJiraClientFromCredentials(creds);
      if (!client) {
        return { ok: false, message: "Jira is not connected. Connect Atlassian in settings." };
      }
      return client.testConnection();
    }
    case "teams": {
      if (!creds.teamsToken) {
        return { ok: false, message: "Microsoft Teams (Graph) token is not configured." };
      }
      return new TeamsClient({ accessToken: creds.teamsToken }).testConnection();
    }
    case "confluence": {
      const { baseUrl, derivedFromJira } = resolveConfluenceBaseUrl({
        confluenceBaseUrl: draft?.baseUrl?.trim() || creds.confluenceBaseUrl,
        jiraBaseUrl: creds.jiraBaseUrl
      });
      const siteError = confluenceSiteUrlError(baseUrl);
      if (siteError) {
        return { ok: false, message: siteError };
      }
      const host = confluenceSiteHostname(baseUrl);

      const oauthClient =
        !draft?.email && !draft?.token ? createConfluenceClientFromCredentials(creds, baseUrl) : undefined;
      if (oauthClient && creds.atlassianCloudId) {
        const oauthResult = await oauthClient.testConnection();
        if (oauthResult.ok) {
          return {
            ok: true,
            message: `Confluence connection successful at ${host} (organization OAuth).`
          };
        }
        return oauthResult;
      }

      const tryAuth = async (auth: ConfluenceAuth) =>
        new ConfluenceClient({
          baseUrl,
          email: auth.email,
          apiToken: auth.apiToken
        }).testConnection();

      const primary = resolveConfluenceAuth(creds, draft);
      if (!primary) {
        return {
          ok: false,
          message: "Confluence is not connected. Connect Atlassian in settings."
        };
      }

      let auth = primary;
      let result = await tryAuth(auth);

      // Saved Confluence token may be stale/wrong while Jira token still works (same Atlassian account).
      if (
        !result.ok &&
        auth.credentialSource === "confluence" &&
        creds.jiraEmail &&
        creds.jiraToken &&
        creds.jiraToken !== auth.apiToken
      ) {
        auth = { email: creds.jiraEmail, apiToken: creds.jiraToken, credentialSource: "jira" };
        result = await tryAuth(auth);
        if (result.ok) {
          return {
            ok: true,
            message:
              `Confluence connection successful at ${host} using Jira credentials. ` +
              `Click "Use Jira credentials" in Confluence settings to save them here.`
          };
        }
      }

      if (result.ok) {
        const via =
          auth.credentialSource === "jira"
            ? " (via Jira credentials)"
            : derivedFromJira
              ? " (site URL derived from Jira settings)"
              : "";
        return { ok: true, message: `Confluence connection successful at ${host}.${via}` };
      }

      return {
        ok: false,
        message:
          `${result.message} [${auth.email} @ ${host}, token length ${auth.apiToken.length}, source: ${auth.credentialSource}] ` +
          `If Jira works, click "Use Jira credentials" or Clear and re-paste the token from scripts/.env.`
      };
    }
    case "notion": {
      if (!creds.notionToken) {
        return { ok: false, message: "Notion integration token is not configured." };
      }
      return new NotionClient({ token: creds.notionToken }).testConnection();
    }
    case "google-docs": {
      if (!creds.googleDocsToken) {
        return { ok: false, message: "Google Docs access token is not configured." };
      }
      return new GoogleDocsClient({ accessToken: creds.googleDocsToken }).testConnection();
    }
    default:
      return { ok: false, message: `Unknown integration: ${provider}` };
  }
}

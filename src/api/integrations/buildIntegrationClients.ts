import { GoogleDocsClient } from "../googleDocs/googleDocsClient";
import { NotionClient } from "../notion/notionClient";
import { TeamsClient } from "../teams/teamsClient";
import { SlackClient } from "../slack/slackClient";
import { ConfluenceClient } from "../confluence/confluenceClient";
import { JiraClient } from "../jira/jiraClient";
import type { IntegrationCredentials } from "./integrationSecrets";

export function createJiraClientFromCredentials(
  creds: IntegrationCredentials,
  extra?: { signal?: AbortSignal }
): JiraClient | undefined {
  if (creds.proxy) return new JiraClient({ baseUrl: "", proxy: creds.proxy, signal: extra?.signal });
  if (creds.atlassianCloudId && creds.jiraToken) {
    return new JiraClient({
      baseUrl: creds.jiraBaseUrl ?? "https://your-domain.atlassian.net",
      oauthAccessToken: creds.jiraToken,
      cloudId: creds.atlassianCloudId,
      signal: extra?.signal
    });
  }
  if (creds.jiraEmail && creds.jiraToken) {
    return new JiraClient({
      baseUrl: creds.jiraBaseUrl ?? "https://your-domain.atlassian.net",
      email: creds.jiraEmail,
      apiToken: creds.jiraToken,
      signal: extra?.signal
    });
  }
  return undefined;
}

export function createConfluenceClientFromCredentials(
  creds: IntegrationCredentials,
  baseUrlOverride?: string,
  extra?: { signal?: AbortSignal }
): ConfluenceClient | undefined {
  if (creds.proxy) return new ConfluenceClient({ baseUrl: "", proxy: creds.proxy, signal: extra?.signal });
  if (creds.atlassianCloudId && (creds.confluenceToken || creds.jiraToken)) {
    const token = creds.confluenceToken ?? creds.jiraToken!;
    const baseUrl =
      baseUrlOverride?.trim() ||
      creds.confluenceBaseUrl ||
      (creds.jiraBaseUrl ? `${creds.jiraBaseUrl.replace(/\/+$/, "")}/wiki` : undefined) ||
      "https://your-domain.atlassian.net/wiki";
    return new ConfluenceClient({
      baseUrl,
      oauthAccessToken: token,
      cloudId: creds.atlassianCloudId,
      signal: extra?.signal
    });
  }
  const email = creds.confluenceEmail ?? creds.jiraEmail;
  const token = creds.confluenceToken ?? creds.jiraToken;
  const baseUrl =
    baseUrlOverride?.trim() ||
    creds.confluenceBaseUrl ||
    (creds.jiraBaseUrl ? `${creds.jiraBaseUrl.replace(/\/+$/, "")}/wiki` : undefined) ||
    "https://your-domain.atlassian.net/wiki";
  if (!email || !token) {
    return undefined;
  }
  return new ConfluenceClient({ baseUrl, email, apiToken: token, signal: extra?.signal });
}

export function createSlackClientFromCredentials(creds: IntegrationCredentials, extra?: { signal?: AbortSignal }): SlackClient | undefined {
  if (!creds.proxy && !creds.slackToken) return undefined;
  return new SlackClient({ token: creds.slackToken ?? "", proxy: creds.proxy, signal: extra?.signal });
}

export function createTeamsClientFromCredentials(creds: IntegrationCredentials, extra?: { signal?: AbortSignal }): TeamsClient | undefined {
  if (!creds.proxy && !creds.teamsToken) return undefined;
  return new TeamsClient({ accessToken: creds.teamsToken ?? "", proxy: creds.proxy, signal: extra?.signal });
}

export function createNotionClientFromCredentials(creds: IntegrationCredentials, extra?: { signal?: AbortSignal }): NotionClient | undefined {
  if (!creds.proxy && !creds.notionToken) return undefined;
  return new NotionClient({ token: creds.notionToken ?? "", proxy: creds.proxy, signal: extra?.signal });
}

export function createGoogleDocsClientFromCredentials(creds: IntegrationCredentials, extra?: { signal?: AbortSignal }): GoogleDocsClient | undefined {
  if (!creds.proxy && !creds.googleDocsToken) return undefined;
  return new GoogleDocsClient({ accessToken: creds.googleDocsToken ?? "", proxy: creds.proxy, signal: extra?.signal });
}

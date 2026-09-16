import { ConfluenceClient } from "../confluence/confluenceClient";
import { JiraClient } from "../jira/jiraClient";
import type { IntegrationCredentials } from "./integrationSecrets";

export function createJiraClientFromCredentials(
  creds: IntegrationCredentials,
  extra?: { signal?: AbortSignal }
): JiraClient | undefined {
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

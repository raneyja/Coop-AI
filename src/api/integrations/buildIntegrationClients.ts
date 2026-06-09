import { ConfluenceClient } from "../confluence/confluenceClient";
import { JiraClient } from "../jira/jiraClient";
import type { IntegrationCredentials } from "./integrationSecrets";

export function createJiraClientFromCredentials(creds: IntegrationCredentials): JiraClient | undefined {
  if (creds.atlassianCloudId && creds.jiraToken) {
    return new JiraClient({
      baseUrl: creds.jiraBaseUrl ?? "https://your-domain.atlassian.net",
      oauthAccessToken: creds.jiraToken,
      cloudId: creds.atlassianCloudId
    });
  }
  if (creds.jiraEmail && creds.jiraToken) {
    return new JiraClient({
      baseUrl: creds.jiraBaseUrl ?? "https://your-domain.atlassian.net",
      email: creds.jiraEmail,
      apiToken: creds.jiraToken
    });
  }
  return undefined;
}

export function createConfluenceClientFromCredentials(
  creds: IntegrationCredentials,
  baseUrlOverride?: string
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
      cloudId: creds.atlassianCloudId
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
  return new ConfluenceClient({ baseUrl, email, apiToken: token });
}

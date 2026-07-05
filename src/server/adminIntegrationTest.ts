import { BitbucketClient } from "../api/codeHosts/bitbucketClient";
import { GitHubClient } from "../api/codeHosts/githubClient";
import { GitLabClient } from "../api/codeHosts/gitlabClient";
import { GoogleDocsClient } from "../api/googleDocs/googleDocsClient";
import { JiraClient } from "../api/jira/jiraClient";
import { NotionClient } from "../api/notion/notionClient";
import { SlackClient } from "../api/slack/slackClient";
import { TeamsClient } from "../api/teams/teamsClient";
import { resolveCodeHostTokenForOrg } from "./codeHostCredentialResolver";
import { isGithubOAuthInstallation } from "./codeHostConnectors/githubOAuthConnector";
import { getConnector } from "./codeHostConnectors/registry";
import type { IntegrationProvider } from "./integrationConnectionStore";
import { resolveOrgIntegrationAccessToken, type IntegrationApiDeps } from "./integrationApi";
import type { AdminApiDeps } from "./adminApiShared";

const CODE_HOST_PROVIDERS = ["github", "gitlab", "bitbucket"] as const;
type CodeHostProvider = (typeof CODE_HOST_PROVIDERS)[number];

const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  "slack",
  "atlassian",
  "notion",
  "google-docs",
  "teams"
];

export type AdminIntegrationProvider = CodeHostProvider | IntegrationProvider;

export type AdminIntegrationTestDeps = AdminApiDeps & IntegrationApiDeps;

export async function testAdminIntegration(
  orgId: string,
  provider: AdminIntegrationProvider,
  deps: AdminIntegrationTestDeps
): Promise<{ ok: boolean; message: string }> {
  if (CODE_HOST_PROVIDERS.includes(provider as CodeHostProvider)) {
    return testCodeHost(orgId, provider as CodeHostProvider, deps);
  }
  if (INTEGRATION_PROVIDERS.includes(provider as IntegrationProvider)) {
    return testIntegrationProvider(orgId, provider as IntegrationProvider, deps);
  }
  return { ok: false, message: `Unknown provider: ${provider}` };
}

async function testCodeHost(
  orgId: string,
  provider: CodeHostProvider,
  deps: AdminIntegrationTestDeps
): Promise<{ ok: boolean; message: string }> {
  if (!deps.orgStore) {
    return { ok: false, message: "Organization database is not configured." };
  }

  const token = await resolveCodeHostTokenForOrg(orgId, provider, {
    orgStore: deps.orgStore,
    connector: getConnector(provider),
    allowPatFallback: deps.serverConfig.devMode
  });
  if (!token) {
    return { ok: false, message: `${provider} is not connected for this organization.` };
  }

  switch (provider) {
    case "github": {
      const installation = await deps.orgStore.getCodeHostInstallation(orgId, "github");
      const client = new GitHubClient({ token });
      if (!installation || isGithubOAuthInstallation(orgId, installation.installationId)) {
        return client.testConnection();
      }
      return client.testInstallationConnection();
    }
    case "gitlab":
      return new GitLabClient({ token }).testConnection();
    case "bitbucket":
      return new BitbucketClient({ token }).testConnection();
    default:
      return { ok: false, message: `Unknown code host: ${provider}` };
  }
}

async function testIntegrationProvider(
  orgId: string,
  provider: IntegrationProvider,
  deps: AdminIntegrationTestDeps
): Promise<{ ok: boolean; message: string }> {
  if (!deps.integrationStore) {
    return { ok: false, message: "Integration store is not configured." };
  }

  const connection = await deps.integrationStore.get(orgId, provider);
  if (!connection) {
    return { ok: false, message: `${provider} is not connected for this organization.` };
  }

  const accessToken = await resolveOrgIntegrationAccessToken(orgId, provider, deps);
  if (!accessToken) {
    return { ok: false, message: `${provider} is not connected for this organization.` };
  }

  switch (provider) {
    case "slack":
      return new SlackClient({ token: accessToken }).testConnection();
    case "atlassian": {
      const cloudId = String(connection.metadata.cloudId ?? "").trim();
      const siteUrl = String(connection.metadata.siteUrl ?? "").trim() || "https://your-domain.atlassian.net";
      const client = new JiraClient({
        baseUrl: siteUrl,
        oauthAccessToken: accessToken,
        cloudId: cloudId || undefined
      });
      return client.testConnection();
    }
    case "notion":
      return new NotionClient({ token: accessToken }).testConnection();
    case "google-docs":
      return new GoogleDocsClient({ accessToken }).testConnection();
    case "teams":
      return new TeamsClient({ accessToken }).testConnection();
    default:
      return { ok: false, message: `Unknown integration: ${provider}` };
  }
}

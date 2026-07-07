import type { CodeHostProviderPreference, IntegrationChatProvider } from "../../../chat/types";
import type {
  MemberToolStatus,
  OrgIntegrationProvider,
  OrgIntegrationStatusEntry
} from "../../../chat/integrationStatusTypes";
import type { Preferences } from "./types";

const SCOPABLE_ORG_PROVIDERS = new Set<OrgIntegrationProvider>([
  "slack",
  "atlassian",
  "notion",
  "google-docs"
]);

export function memberToolsReadOnly(
  prefs: Pick<Preferences, "devMode" | "canInstallIntegrations">
): boolean {
  return !prefs.devMode && prefs.canInstallIntegrations === false;
}

export function findOrgIntegrationStatus(
  prefs: Pick<Preferences, "orgIntegrationStatuses">,
  provider: OrgIntegrationProvider
): OrgIntegrationStatusEntry | undefined {
  return prefs.orgIntegrationStatuses?.find((entry) => entry.provider === provider);
}

export function integrationToOrgProvider(provider: IntegrationChatProvider): OrgIntegrationProvider {
  if (provider === "jira" || provider === "confluence") {
    return "atlassian";
  }
  return provider;
}

export function resolveMemberToolStatus(
  prefs: Preferences,
  provider: OrgIntegrationProvider
): MemberToolStatus {
  const entry = findOrgIntegrationStatus(prefs, provider);
  if (!entry) {
    return prefs.orgIntegrationStatuses === undefined ? "unavailable" : "not_enabled";
  }
  if (!entry.installed) {
    return "not_enabled";
  }
  if (entry.needsReconnect || entry.scopeNeedsReconnect) {
    return "pending_admin_setup";
  }
  if (
    prefs.plan === "enterprise" &&
    SCOPABLE_ORG_PROVIDERS.has(provider) &&
    entry.scopeStatus === "required"
  ) {
    return "pending_admin_setup";
  }
  return "ready";
}

export function memberToolStatusLabel(status: MemberToolStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending_admin_setup":
      return "Pending admin setup";
    case "not_enabled":
      return "Not enabled";
    case "unavailable":
      return "Unavailable";
  }
}

export function memberToolStatusMeta(
  prefs: Preferences,
  provider: OrgIntegrationProvider
): string | undefined {
  const status = resolveMemberToolStatus(prefs, provider);
  if (status === "not_enabled") {
    return "Not connected for your organization";
  }
  if (status === "unavailable") {
    return "Status unavailable — sign in and refresh settings";
  }
  if (status === "pending_admin_setup") {
    const entry = findOrgIntegrationStatus(prefs, provider);
    if (entry?.scopeStatus === "required") {
      return "Connected — admin must finish access setup";
    }
    if (entry?.needsReconnect || entry?.scopeNeedsReconnect) {
      return "Connected — admin must reconnect";
    }
    return "Connected — waiting on admin setup";
  }

  if (provider === "github" && prefs.githubNeedsReconnect) {
    return "Reconnect GitHub — access expired";
  }
  if (provider === "slack" && prefs.slackTeamName) {
    return `Connected to ${prefs.slackTeamName}`;
  }
  if (provider === "atlassian" && prefs.atlassianSiteName) {
    return `Connected to ${prefs.atlassianSiteName}`;
  }
  if (provider === "notion" && prefs.notionWorkspaceName) {
    return `Connected to ${prefs.notionWorkspaceName}`;
  }
  if (provider === "teams" && prefs.teamsDisplayName) {
    return `Connected as ${prefs.teamsDisplayName}`;
  }
  if (provider === "google-docs" && prefs.googleDocsDisplayName) {
    return `Connected as ${prefs.googleDocsDisplayName}`;
  }

  const entry = findOrgIntegrationStatus(prefs, provider);
  if (entry?.scopeSummary?.trim()) {
    return entry.scopeSummary.trim();
  }
  return "Ready for your organization";
}

export function codeHostReady(
  prefs: Preferences,
  provider: CodeHostProviderPreference | "github" | "gitlab" | "bitbucket"
): boolean {
  if (prefs.devMode) {
    return codeHostConfiguredFromFlags(prefs, provider);
  }
  return resolveMemberToolStatus(prefs, provider) === "ready";
}

export function integrationReady(prefs: Preferences, provider: IntegrationChatProvider): boolean {
  if (prefs.devMode) {
    return integrationConfiguredFromFlags(prefs, provider);
  }
  return resolveMemberToolStatus(prefs, integrationToOrgProvider(provider)) === "ready";
}

export function codeHostConfiguredFromFlags(
  prefs: Preferences,
  provider: CodeHostProviderPreference | "github" | "gitlab" | "bitbucket"
): boolean {
  if (provider === "github") {
    if (prefs.githubNeedsReconnect) {
      return false;
    }
    return prefs.hasGitHubAppInstalled || prefs.hasGitHubToken;
  }
  if (provider === "gitlab") {
    return prefs.hasGitLabAppInstalled || prefs.hasGitLabToken;
  }
  return prefs.hasBitbucketAppInstalled || prefs.hasBitbucketCredentials;
}

export function integrationConfiguredFromFlags(
  prefs: Preferences,
  provider: IntegrationChatProvider
): boolean {
  if (provider === "slack") {
    return prefs.hasSlackToken;
  }
  if (provider === "jira") {
    return prefs.hasJiraCredentials;
  }
  if (provider === "teams") {
    return prefs.hasTeamsToken;
  }
  if (provider === "confluence") {
    return prefs.hasConfluenceCredentials;
  }
  if (provider === "notion") {
    return prefs.hasNotionToken;
  }
  return prefs.hasGoogleDocsToken;
}

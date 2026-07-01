export type {
  SettingsScreen,
  SettingsDetailScreen
} from "../../../chat/settingsScreens";
export {
  SETTINGS_SCREEN_TITLES,
  settingsScreenForProvider,
  settingsScreenParent,
  settingsScreenParentLabel,
  isSettingsScreen,
  migrateSettingsScreen
} from "../../../chat/settingsScreens";

import type {
  CodeHostProviderPreference,
  IntegrationChatProvider
} from "../../../chat/types";
import type { SettingsScreen } from "../../../chat/settingsScreens";

export type Preferences = {
  model: string;
  llmProvider: import("../../../chat/types").LlmProviderPreference;
  temperature: number;
  maxTokens: number;
  llmEnabled: boolean;
  autocompleteEnabled: boolean;
  useCachedResponses: boolean;
  includeSelection: boolean;
  includeActiveFile: boolean;
  apiBaseUrl: string;
  owner: string;
  repo: string;
  branch: string;
  hasApiKey: boolean;
  defaultCodeHost: CodeHostProviderPreference;
  gitlabBaseUrl: string;
  hasGitHubToken: boolean;
  hasGitHubAppInstalled: boolean;
  githubNeedsReconnect?: boolean;
  devMode: boolean;
  orgName?: string;
  plan?: "free" | "pro" | "enterprise";
  quotaCredits?: {
    usedCredits: number;
    limitCredits: number;
    remainingCredits: number;
    windowHours: number;
    resetsAt: string;
    retryAfterMs: number;
  };
  userRole?: string;
  authMethod?: "api_key" | "sso_session";
  canInstallIntegrations?: boolean;
  onboardingCompleted?: boolean;
  adminPortalUrl?: string;
  integrationHealthSummary?: {
    connected: number;
    scopeRequired: number;
  };
  hasGitLabToken: boolean;
  hasGitLabAppInstalled: boolean;
  hasBitbucketCredentials: boolean;
  hasBitbucketAppInstalled: boolean;
  hasSlackToken: boolean;
  hasSlackInstalled: boolean;
  slackTeamName?: string;
  hasAtlassianInstalled: boolean;
  atlassianSiteName?: string;
  hasJiraCredentials: boolean;
  hasTeamsInstalled: boolean;
  teamsDisplayName?: string;
  hasTeamsToken: boolean;
  hasConfluenceCredentials: boolean;
  hasNotionInstalled: boolean;
  notionWorkspaceName?: string;
  hasNotionToken: boolean;
  hasGoogleDocsInstalled: boolean;
  googleDocsDisplayName?: string;
  hasGoogleDocsToken: boolean;
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  searchScopeMode: import("../../../chat/types").SearchScopeMode;
  searchCollectionId: string;
  workspaceRepoIds?: string[];
  workspaceRepoCount?: number;
  workspaceRepoLimit?: number | null;
  canAddMoreWorkspaceRepos?: boolean;
  primaryWorkspaceRepoId?: string;
  timezone?: string;
  identityDirectory: import("../../../identity/types").IdentityDirectory;
};

export type SettingsCollectionSummary = {
  id: string;
  name: string;
  description?: string;
  repoCount: number;
};

export type CodeHostScreen = Extract<
  SettingsScreen,
  "code-host-github" | "code-host-gitlab" | "code-host-bitbucket"
>;

export type IntegrationScreen = Extract<
  SettingsScreen,
  | "integration-slack"
  | "integration-jira"
  | "integration-teams"
  | "integration-confluence"
  | "integration-notion"
  | "integration-google-docs"
>;

export function codeHostFromScreen(screen: CodeHostScreen): CodeHostProviderPreference {
  if (screen === "code-host-github") {
    return "github";
  }
  if (screen === "code-host-gitlab") {
    return "gitlab";
  }
  return "bitbucket";
}

export function integrationFromScreen(screen: IntegrationScreen): IntegrationChatProvider {
  if (screen === "integration-slack") {
    return "slack";
  }
  if (screen === "integration-jira") {
    return "jira";
  }
  if (screen === "integration-teams") {
    return "teams";
  }
  if (screen === "integration-confluence") {
    return "confluence";
  }
  if (screen === "integration-notion") {
    return "notion";
  }
  return "google-docs";
}

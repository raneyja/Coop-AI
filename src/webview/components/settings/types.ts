export type {
  SettingsScreen,
  SettingsDetailScreen
} from "../../../chat/settingsScreens";
export {
  SETTINGS_SCREEN_TITLES,
  settingsScreenForProvider,
  settingsScreenParent,
  settingsScreenParentLabel,
  isSettingsScreen
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
  devMode: boolean;
  orgName?: string;
  plan?: "free" | "pro" | "enterprise";
  userRole?: string;
  authMethod?: "api_key" | "sso_session";
  canInstallIntegrations?: boolean;
  hasGitLabToken: boolean;
  hasGitLabAppInstalled: boolean;
  hasBitbucketCredentials: boolean;
  hasBitbucketAppInstalled: boolean;
  hasSlackToken: boolean;
  hasJiraCredentials: boolean;
  hasTeamsToken: boolean;
  hasConfluenceCredentials: boolean;
  hasNotionToken: boolean;
  hasGoogleDocsToken: boolean;
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
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

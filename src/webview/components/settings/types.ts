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
  DecisionIntegrationProvider
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
  hasGitLabToken: boolean;
  hasBitbucketCredentials: boolean;
  hasSlackToken: boolean;
  hasJiraCredentials: boolean;
  hasTeamsToken: boolean;
  jiraBaseUrl: string;
};

export type CodeHostScreen = Extract<
  SettingsScreen,
  "code-host-github" | "code-host-gitlab" | "code-host-bitbucket"
>;

export type IntegrationScreen = Extract<
  SettingsScreen,
  "integration-slack" | "integration-jira" | "integration-teams"
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

export function integrationFromScreen(screen: IntegrationScreen): DecisionIntegrationProvider {
  if (screen === "integration-slack") {
    return "slack";
  }
  if (screen === "integration-jira") {
    return "jira";
  }
  return "teams";
}

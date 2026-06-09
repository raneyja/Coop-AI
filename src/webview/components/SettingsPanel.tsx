import React from "react";
import type { SettingsTestKey } from "./TestButton";
import type { SettingsSaveKey } from "./SaveFlashLabel";
import type { PromptLibraryItem } from "./promptLibraryTypes";
import type { CodeHostProviderPreference, IntegrationChatProvider } from "../../chat/types";
import { SettingsHub, SettingsNavHeader } from "./settings/SettingsHub";
import { SettingsDetailView } from "./settings/SettingsDetailViews";
import type { IdentityDirectory } from "../../identity/types";
import type { Preferences, SettingsDetailScreen, SettingsScreen } from "./settings/types";
import { settingsScreenParent } from "./settings/types";

export type { Preferences } from "./settings/types";
export type { SettingsScreen, SettingsDetailScreen } from "./settings/types";

type SettingsPanelProps = {
  screen: SettingsScreen;
  onNavigate: (screen: SettingsScreen) => void;
  prefs: Preferences;
  onClose: () => void;
  onUpdate: (partial: Partial<Preferences>) => void;
  apiKeyDraft: string;
  onApiKeyDraftChange: (value: string) => void;
  onSaveApiKey: () => void;
  onClearApiKey: () => void;
  onSignInSso: (org?: string) => void;
  onSignOut: () => void;
  onTestConnection: () => void;
  onTestCodeHost: (provider: CodeHostProviderPreference) => void;
  githubTokenDraft: string;
  onGithubTokenDraftChange: (value: string) => void;
  onSaveGithubToken: () => void;
  onClearGithubToken: () => void;
  onInstallGithubApp: () => void;
  onRefreshGithubInstallation: () => void;
  onInstallGitlabApp: () => void;
  onRefreshGitlabInstallation: () => void;
  gitlabTokenDraft: string;
  onGitlabTokenDraftChange: (value: string) => void;
  onSaveGitlabToken: () => void;
  onClearGitlabToken: () => void;
  onInstallBitbucketApp: () => void;
  onRefreshBitbucketInstallation: () => void;
  bitbucketUsernameDraft: string;
  onBitbucketUsernameDraftChange: (value: string) => void;
  bitbucketPasswordDraft: string;
  onBitbucketPasswordDraftChange: (value: string) => void;
  onSaveBitbucketCredentials: () => void;
  onClearBitbucketCredentials: () => void;
  slackTokenDraft: string;
  onSlackTokenDraftChange: (value: string) => void;
  onSaveSlackToken: () => void;
  onClearSlackToken: () => void;
  onInstallSlackApp: () => void;
  onRefreshSlackInstallation: () => void;
  onInstallAtlassianApp: () => void;
  onRefreshAtlassianInstallation: (key: "jira" | "confluence") => void;
  jiraEmailDraft: string;
  onJiraEmailDraftChange: (value: string) => void;
  jiraTokenDraft: string;
  onJiraTokenDraftChange: (value: string) => void;
  onSaveJiraCredentials: () => void;
  onClearJiraCredentials: () => void;
  teamsTokenDraft: string;
  onTeamsTokenDraftChange: (value: string) => void;
  onSaveTeamsToken: () => void;
  onClearTeamsToken: () => void;
  confluenceEmailDraft: string;
  onConfluenceEmailDraftChange: (value: string) => void;
  confluenceTokenDraft: string;
  onConfluenceTokenDraftChange: (value: string) => void;
  onSaveConfluenceCredentials: () => void;
  onClearConfluenceCredentials: () => void;
  onCopyJiraToConfluence: () => void;
  notionTokenDraft: string;
  onNotionTokenDraftChange: (value: string) => void;
  onSaveNotionToken: () => void;
  onClearNotionToken: () => void;
  googleDocsTokenDraft: string;
  onGoogleDocsTokenDraftChange: (value: string) => void;
  onSaveGoogleDocsToken: () => void;
  onClearGoogleDocsToken: () => void;
  onTestIntegration: (provider: IntegrationChatProvider) => void;
  onClearChat: () => void;
  connectionTestMessage?: string;
  connectionTestOk?: boolean;
  savedFlashKey: SettingsSaveKey | null;
  pendingTest: SettingsTestKey | null;
  testResult: { key: SettingsTestKey; ok: boolean } | null;
  pendingRefresh: SettingsTestKey | null;
  refreshResult: { key: SettingsTestKey; ok: boolean } | null;
  promptLibrary: {
    prompts: PromptLibraryItem[];
    pinnedIds: string[];
    hasWorkspace: boolean;
  };
  onUpdatePinnedPrompts: (pinnedIds: string[]) => void;
  onManagePromptLibrary: () => void;
  onSaveIdentityDirectory: (directory: IdentityDirectory) => void;
  onConnectIntegrationNotice?: (provider: IntegrationChatProvider) => void;
};

export function SettingsPanel({
  screen,
  onNavigate,
  prefs,
  onClose,
  promptLibrary,
  onTestIntegration,
  ...detailProps
}: SettingsPanelProps): React.ReactElement {
  const handleBack = () => {
    onNavigate(settingsScreenParent(screen));
  };

  const detailCommon = {
    prefs,
    promptLibrary,
    onTestIntegration,
    onNavigate: (next: SettingsDetailScreen) => onNavigate(next),
    ...detailProps
  };

  return (
    <div className="coop-settings-dialog">
      <SettingsNavHeader screen={screen} prefs={prefs} onBack={handleBack} onClose={onClose} />

      <div className="coop-settings-body">
        {screen === "hub" ? (
          <SettingsHub
            prefs={prefs}
            pinnedCount={promptLibrary.pinnedIds.length}
            onNavigate={(next) => onNavigate(next)}
          />
        ) : (
          <SettingsDetailView screen={screen} {...detailCommon} />
        )}
      </div>
    </div>
  );
}

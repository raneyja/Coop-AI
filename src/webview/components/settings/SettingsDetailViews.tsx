import React, { useMemo } from "react";
import { MODELS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER } from "../../../config/llmModels";
import { TestButton, type SettingsTestKey } from "../TestButton";
import { SaveFlashLabel, type SettingsSaveKey } from "../SaveFlashLabel";
import { ConfiguredSecretInput } from "../ConfiguredSecretInput";
import { PromptLibraryTop5Editor } from "../PromptLibraryTop5Editor";
import type { PromptLibraryItem } from "../promptLibraryTypes";
import type { CodeHostProviderPreference, LlmProviderPreference } from "../../../chat/types";
import type { Preferences, SettingsDetailScreen } from "./types";
import { SettingsCheckboxRow, SettingsSection } from "./SettingsShared";
import { CoopNavList, CoopNavRow } from "../CoopNavRow";
import { codeHostConfigured, integrationConfigured } from "./subtitles";

export type SettingsDetailProps = {
  prefs: Preferences;
  onUpdate: (partial: Partial<Preferences>) => void;
  apiKeyDraft: string;
  onApiKeyDraftChange: (value: string) => void;
  onSaveApiKey: () => void;
  onClearApiKey: () => void;
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
  onTestIntegration: (provider: "slack" | "jira" | "teams") => void;
  onClearChat: () => void;
  connectionTestMessage?: string;
  connectionTestOk?: boolean;
  savedFlashKey: SettingsSaveKey | null;
  pendingTest: SettingsTestKey | null;
  testResult: { key: SettingsTestKey; ok: boolean } | null;
  promptLibrary: {
    prompts: PromptLibraryItem[];
    pinnedIds: string[];
    hasWorkspace: boolean;
  };
  onUpdatePinnedPrompts: (pinnedIds: string[]) => void;
  onManagePromptLibrary: () => void;
  onNavigate: (screen: SettingsDetailScreen) => void;
};

export function SettingsDetailView({
  screen,
  ...props
}: { screen: SettingsDetailScreen } & SettingsDetailProps): React.ReactElement {
  switch (screen) {
    case "model":
      return <ModelDetail {...props} />;
    case "api":
      return <ApiDetail {...props} />;
    case "code-hosts":
      return <CodeHostsListDetail {...props} />;
    case "code-host-github":
      return <GitHubDetail {...props} />;
    case "code-host-gitlab":
      return <GitLabDetail {...props} />;
    case "code-host-bitbucket":
      return <BitbucketDetail {...props} />;
    case "integrations":
      return <IntegrationsListDetail {...props} />;
    case "integration-slack":
      return <SlackDetail {...props} />;
    case "integration-jira":
      return <JiraDetail {...props} />;
    case "integration-teams":
      return <TeamsDetail {...props} />;
    case "workspace":
      return <WorkspaceDetail {...props} />;
    case "prompts":
      return <PromptsDetail {...props} />;
    default:
      return <div />;
  }
}

function ModelDetail({
  prefs,
  onUpdate,
  onClearChat
}: SettingsDetailProps): React.ReactElement {
  const models = useMemo(() => MODELS_BY_PROVIDER[prefs.llmProvider] ?? [], [prefs.llmProvider]);

  const onProviderChange = (provider: LlmProviderPreference) => {
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider];
    const nextModel = MODELS_BY_PROVIDER[provider].includes(prefs.model) ? prefs.model : defaultModel;
    onUpdate({ llmProvider: provider, model: nextModel });
  };

  return (
    <>
      <SettingsSection>
        <label className="coop-settings-field-row">
          <span className="coop-settings-label">LLM provider (routed server-side)</span>
          <select
            value={prefs.llmProvider}
            onChange={(e) => onProviderChange(e.target.value as LlmProviderPreference)}
            className="coop-settings-field"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="deepseek">DeepSeek (legal review)</option>
          </select>
        </label>

        <label className="coop-settings-field-row">
          <span className="coop-settings-label">Model</span>
          <select
            value={prefs.model}
            onChange={(e) => onUpdate({ model: e.target.value })}
            className="coop-settings-field"
          >
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Temperature</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={prefs.temperature}
              onChange={(e) => onUpdate({ temperature: Number(e.target.value) })}
              className="coop-settings-field"
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Max tokens</span>
            <input
              type="number"
              min={256}
              max={8192}
              step={256}
              value={prefs.maxTokens}
              onChange={(e) => onUpdate({ maxTokens: Number(e.target.value) })}
              className="coop-settings-field"
            />
          </label>
        </div>

        <SettingsCheckboxRow
          title="Enable live LLM chat"
          description="Routes requests through /v1/chat"
          checked={prefs.llmEnabled}
          onChange={(checked) => onUpdate({ llmEnabled: checked })}
        />
        <SettingsCheckboxRow
          title="Enable inline autocomplete"
          description="When the API supports it"
          checked={prefs.autocompleteEnabled}
          onChange={(checked) => onUpdate({ autocompleteEnabled: checked })}
        />
      </SettingsSection>

      <SettingsSection title="Chat">
        <p className="coop-settings-card-desc">Clear the current conversation history.</p>
        <div className="coop-settings-footer !border-t-0 !pt-0">
          <button type="button" className="coop-settings-action-btn" onClick={onClearChat}>
            Clear chat
          </button>
        </div>
      </SettingsSection>
    </>
  );
}

function ApiDetail({
  prefs,
  onUpdate,
  apiKeyDraft,
  onApiKeyDraftChange,
  onSaveApiKey,
  onClearApiKey,
  onTestConnection,
  connectionTestMessage,
  connectionTestOk,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <label className="coop-settings-field-row">
        <span className="coop-settings-label">CoopAI API key</span>
        <ConfiguredSecretInput
          configured={prefs.hasApiKey}
          value={apiKeyDraft}
          placeholder="Local dev: any value (e.g. dev) then Save"
          onChange={onApiKeyDraftChange}
          className="coop-settings-field"
        />
      </label>
      <div className="coop-settings-actions">
        <button type="button" className="coop-settings-action-btn" onClick={onSaveApiKey}>
          Save API key
        </button>
        <button
          type="button"
          className="coop-settings-action-btn"
          onClick={onClearApiKey}
          disabled={!prefs.hasApiKey}
        >
          Clear key
        </button>
        <TestButton
          testKey="connection"
          label="Test connection"
          pendingTest={pendingTest}
          testResult={testResult}
          onClick={onTestConnection}
        />
        <SaveFlashLabel show={savedFlashKey === "apiKey"} />
      </div>
      {connectionTestMessage ? (
        <span
          className={`coop-settings-card-desc${
            connectionTestOk === true
              ? " coop-settings-test-message--ok"
              : connectionTestOk === false
                ? " coop-settings-test-message--error"
                : ""
          }`}
        >
          {connectionTestMessage}
        </span>
      ) : null}
      <p className="coop-settings-card-desc">
        LLM provider keys are routed server-side; code host tokens stay in VS Code SecretStorage.
      </p>

      <label className="coop-settings-field-row">
        <span className="coop-settings-label">API base URL</span>
        <input
          type="url"
          value={prefs.apiBaseUrl}
          onChange={(e) => onUpdate({ apiBaseUrl: e.target.value })}
          className="coop-settings-field"
        />
      </label>
    </SettingsSection>
  );
}

function CodeHostsListDetail({
  prefs,
  onUpdate,
  onNavigate
}: SettingsDetailProps): React.ReactElement {
  return (
    <>
      <SettingsSection>
        <p className="coop-settings-card-desc">Zero-clone integrations for quick actions and PR workflows.</p>
        <label className="coop-settings-field-row">
          <span className="coop-settings-label">Default code host</span>
          <select
            value={prefs.defaultCodeHost}
            onChange={(e) => onUpdate({ defaultCodeHost: e.target.value as CodeHostProviderPreference })}
            className="coop-settings-field"
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="bitbucket">Bitbucket</option>
          </select>
        </label>
      </SettingsSection>

      <CoopNavList>
        <CoopNavRow
          title="GitHub"
          subtitle={codeHostConfigured(prefs, "github") ? "Configured" : "Not configured"}
          configured={codeHostConfigured(prefs, "github")}
          onClick={() => onNavigate("code-host-github")}
        />
        <CoopNavRow
          title="GitLab"
          subtitle={codeHostConfigured(prefs, "gitlab") ? "Configured" : "Not configured"}
          configured={codeHostConfigured(prefs, "gitlab")}
          onClick={() => onNavigate("code-host-gitlab")}
        />
        <CoopNavRow
          title="Bitbucket"
          subtitle={codeHostConfigured(prefs, "bitbucket") ? "Configured" : "Not configured"}
          configured={codeHostConfigured(prefs, "bitbucket")}
          onClick={() => onNavigate("code-host-bitbucket")}
        />
      </CoopNavList>
    </>
  );
}

function GitHubDetail({
  prefs,
  githubTokenDraft,
  onGithubTokenDraftChange,
  onSaveGithubToken,
  onClearGithubToken,
  onInstallGithubApp,
  onRefreshGithubInstallation,
  onTestCodeHost,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  const cloudPath = !prefs.devMode;
  return (
    <SettingsSection>
      {cloudPath ? (
        <>
          <p className="coop-settings-card-desc">
            Connect repositories through the CoopAI GitHub App. CoopAI stores installation credentials on the server —
            no personal access token is saved in VS Code.
          </p>
          <div className="coop-health-integration">
            <div>
              <div className="coop-health-integration-name">GitHub App</div>
              <div className="coop-health-integration-meta">
                {prefs.hasGitHubAppInstalled ? "Installed for your organization" : "Not installed"}
              </div>
            </div>
            <span
              className={`coop-health-status ${prefs.hasGitHubAppInstalled ? "coop-health-status--healthy" : "coop-health-status--offline"}`}
            >
              {prefs.hasGitHubAppInstalled ? "Connected" : "Required"}
            </span>
          </div>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={onInstallGithubApp}>
              {prefs.hasGitHubAppInstalled ? "Manage GitHub App" : "Install GitHub App"}
            </button>
            <button type="button" className="coop-settings-action-btn" onClick={onRefreshGithubInstallation}>
              Refresh status
            </button>
            <TestButton
              testKey="github"
              label="Test GitHub"
              pendingTest={pendingTest}
              testResult={testResult}
              onClick={() => onTestCodeHost("github")}
            />
          </div>
        </>
      ) : null}
      {prefs.devMode ? (
        <>
          <p className="coop-prompt-modal-section-title">Developer fallback (PAT)</p>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">GitHub token {prefs.hasGitHubToken ? "(configured)" : ""}</span>
            <ConfiguredSecretInput
              configured={prefs.hasGitHubToken}
              value={githubTokenDraft}
              placeholder="ghp_…"
              onChange={onGithubTokenDraftChange}
              className="coop-settings-field"
            />
          </label>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={onSaveGithubToken}>
              Save GitHub token
            </button>
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={onClearGithubToken}
              disabled={!prefs.hasGitHubToken}
            >
              Clear
            </button>
            {!cloudPath ? (
              <TestButton
                testKey="github"
                label="Test GitHub"
                pendingTest={pendingTest}
                testResult={testResult}
                onClick={() => onTestCodeHost("github")}
              />
            ) : null}
            <SaveFlashLabel show={savedFlashKey === "github"} />
          </div>
          <p className="coop-settings-card-desc coop-prompt-modal-muted">
            Internal use only (`coopAI.devMode`). Production users should use the GitHub App above.
          </p>
        </>
      ) : null}
    </SettingsSection>
  );
}

function GitLabDetail({
  prefs,
  onUpdate,
  gitlabTokenDraft,
  onGitlabTokenDraftChange,
  onSaveGitlabToken,
  onClearGitlabToken,
  onInstallGitlabApp,
  onRefreshGitlabInstallation,
  onTestCodeHost,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  const cloudPath = !prefs.devMode;
  return (
    <SettingsSection>
      {cloudPath ? (
        <>
          <p className="coop-settings-card-desc">
            Connect repositories through the CoopAI GitLab OAuth App. CoopAI stores installation
            credentials on the server — no personal access token is saved in VS Code.
          </p>
          <div className="coop-health-integration">
            <div>
              <div className="coop-health-integration-name">GitLab OAuth App</div>
              <div className="coop-health-integration-meta">
                {prefs.hasGitLabAppInstalled ? "Authorized for your organization" : "Not authorized"}
              </div>
            </div>
            <span
              className={`coop-health-status ${prefs.hasGitLabAppInstalled ? "coop-health-status--healthy" : "coop-health-status--offline"}`}
            >
              {prefs.hasGitLabAppInstalled ? "Connected" : "Required"}
            </span>
          </div>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={onInstallGitlabApp}>
              {prefs.hasGitLabAppInstalled ? "Manage GitLab authorization" : "Authorize GitLab"}
            </button>
            <button type="button" className="coop-settings-action-btn" onClick={onRefreshGitlabInstallation}>
              Refresh status
            </button>
            <TestButton
              testKey="gitlab"
              label="Test GitLab"
              pendingTest={pendingTest}
              testResult={testResult}
              onClick={() => onTestCodeHost("gitlab")}
            />
          </div>
        </>
      ) : null}
      {prefs.devMode ? (
        <>
          <p className="coop-prompt-modal-section-title">Developer fallback (PAT)</p>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">GitLab token {prefs.hasGitLabToken ? "(configured)" : ""}</span>
            <ConfiguredSecretInput
              configured={prefs.hasGitLabToken}
              value={gitlabTokenDraft}
              placeholder="glpat-…"
              onChange={onGitlabTokenDraftChange}
              className="coop-settings-field"
            />
          </label>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={onSaveGitlabToken}>
              Save GitLab token
            </button>
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={onClearGitlabToken}
              disabled={!prefs.hasGitLabToken}
            >
              Clear
            </button>
            {!cloudPath ? (
              <TestButton
                testKey="gitlab"
                label="Test GitLab"
                pendingTest={pendingTest}
                testResult={testResult}
                onClick={() => onTestCodeHost("gitlab")}
              />
            ) : null}
            <SaveFlashLabel show={savedFlashKey === "gitlab"} />
          </div>

          <label className="coop-settings-field-row">
            <span className="coop-settings-label">GitLab API base URL</span>
            <input
              type="url"
              value={prefs.gitlabBaseUrl}
              onChange={(e) => onUpdate({ gitlabBaseUrl: e.target.value })}
              className="coop-settings-field"
            />
          </label>
          <p className="coop-settings-card-desc coop-prompt-modal-muted">
            Internal use only (`coopAI.devMode`). Production users should use the GitLab OAuth App above.
          </p>
        </>
      ) : null}
    </SettingsSection>
  );
}

function BitbucketDetail({
  prefs,
  bitbucketUsernameDraft,
  onBitbucketUsernameDraftChange,
  bitbucketPasswordDraft,
  onBitbucketPasswordDraftChange,
  onSaveBitbucketCredentials,
  onClearBitbucketCredentials,
  onInstallBitbucketApp,
  onRefreshBitbucketInstallation,
  onTestCodeHost,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  const cloudPath = !prefs.devMode;
  return (
    <SettingsSection>
      {cloudPath ? (
        <>
          <p className="coop-settings-card-desc">
            Connect repositories through the CoopAI Bitbucket OAuth App. CoopAI stores installation
            credentials on the server — no app password is saved in VS Code.
          </p>
          <div className="coop-health-integration">
            <div>
              <div className="coop-health-integration-name">Bitbucket OAuth App</div>
              <div className="coop-health-integration-meta">
                {prefs.hasBitbucketAppInstalled ? "Authorized for your organization" : "Not authorized"}
              </div>
            </div>
            <span
              className={`coop-health-status ${prefs.hasBitbucketAppInstalled ? "coop-health-status--healthy" : "coop-health-status--offline"}`}
            >
              {prefs.hasBitbucketAppInstalled ? "Connected" : "Required"}
            </span>
          </div>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={onInstallBitbucketApp}>
              {prefs.hasBitbucketAppInstalled ? "Manage Bitbucket authorization" : "Authorize Bitbucket"}
            </button>
            <button type="button" className="coop-settings-action-btn" onClick={onRefreshBitbucketInstallation}>
              Refresh status
            </button>
            <TestButton
              testKey="bitbucket"
              label="Test Bitbucket"
              pendingTest={pendingTest}
              testResult={testResult}
              onClick={() => onTestCodeHost("bitbucket")}
            />
          </div>
        </>
      ) : null}
      {prefs.devMode ? (
        <>
          <p className="coop-prompt-modal-section-title">Developer fallback (app password)</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">Bitbucket username</span>
              <input
                type="text"
                value={bitbucketUsernameDraft}
                onChange={(e) => onBitbucketUsernameDraftChange(e.target.value)}
                className="coop-settings-field"
              />
            </label>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">
                App password {prefs.hasBitbucketCredentials ? "(configured)" : ""}
              </span>
              <ConfiguredSecretInput
                configured={prefs.hasBitbucketCredentials}
                value={bitbucketPasswordDraft}
                onChange={onBitbucketPasswordDraftChange}
                className="coop-settings-field"
              />
            </label>
          </div>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={onSaveBitbucketCredentials}>
              Save Bitbucket credentials
            </button>
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={onClearBitbucketCredentials}
              disabled={!prefs.hasBitbucketCredentials}
            >
              Clear
            </button>
            {!cloudPath ? (
              <TestButton
                testKey="bitbucket"
                label="Test Bitbucket"
                pendingTest={pendingTest}
                testResult={testResult}
                onClick={() => onTestCodeHost("bitbucket")}
              />
            ) : null}
            <SaveFlashLabel show={savedFlashKey === "bitbucket"} />
          </div>
          <p className="coop-settings-card-desc coop-prompt-modal-muted">
            Internal use only (`coopAI.devMode`). Production users should use the Bitbucket OAuth App above.
          </p>
        </>
      ) : null}
    </SettingsSection>
  );
}

function IntegrationsListDetail({ prefs, onNavigate }: SettingsDetailProps): React.ReactElement {
  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        Optional integrations for Trace Decision. Tokens are stored in VS Code SecretStorage only.
      </p>
      <CoopNavList>
        <CoopNavRow
          title="Slack"
          subtitle={integrationConfigured(prefs, "slack") ? "Configured" : "Not configured"}
          configured={integrationConfigured(prefs, "slack")}
          onClick={() => onNavigate("integration-slack")}
        />
        <CoopNavRow
          title="Jira"
          subtitle={integrationConfigured(prefs, "jira") ? "Configured" : "Not configured"}
          configured={integrationConfigured(prefs, "jira")}
          onClick={() => onNavigate("integration-jira")}
        />
        <CoopNavRow
          title="Microsoft Teams"
          subtitle={integrationConfigured(prefs, "teams") ? "Configured" : "Not configured"}
          configured={integrationConfigured(prefs, "teams")}
          onClick={() => onNavigate("integration-teams")}
        />
      </CoopNavList>
    </>
  );
}

function SlackDetail({
  prefs,
  slackTokenDraft,
  onSlackTokenDraftChange,
  onSaveSlackToken,
  onClearSlackToken,
  onTestIntegration,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <label className="coop-settings-field-row">
        <span className="coop-settings-label">Slack token {prefs.hasSlackToken ? "(configured)" : ""}</span>
        <ConfiguredSecretInput
          configured={prefs.hasSlackToken}
          value={slackTokenDraft}
          placeholder="xoxp-… (channels:read, chat:read, users:read)"
          onChange={onSlackTokenDraftChange}
          className="coop-settings-field"
        />
      </label>
      <div className="coop-settings-actions">
        <button type="button" className="coop-settings-action-btn" onClick={onSaveSlackToken}>
          Save Slack token
        </button>
        <button
          type="button"
          className="coop-settings-action-btn"
          onClick={onClearSlackToken}
          disabled={!prefs.hasSlackToken}
        >
          Clear
        </button>
        <TestButton
          testKey="slack"
          label="Test Slack"
          pendingTest={pendingTest}
          testResult={testResult}
          onClick={() => onTestIntegration("slack")}
        />
        <SaveFlashLabel show={savedFlashKey === "slack"} />
      </div>
    </SettingsSection>
  );
}

function JiraDetail({
  prefs,
  onUpdate,
  jiraEmailDraft,
  onJiraEmailDraftChange,
  jiraTokenDraft,
  onJiraTokenDraftChange,
  onSaveJiraCredentials,
  onClearJiraCredentials,
  onTestIntegration,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <label className="coop-settings-field-row">
        <span className="coop-settings-label">Jira site URL</span>
        <input
          type="url"
          value={prefs.jiraBaseUrl}
          placeholder="https://your-company.atlassian.net"
          onChange={(e) => onUpdate({ jiraBaseUrl: e.target.value })}
          className="coop-settings-field"
        />
      </label>

      <label className="coop-settings-field-row">
        <span className="coop-settings-label">
          Jira account email {prefs.hasJiraCredentials ? "(configured)" : ""}
        </span>
        <input
          type="email"
          value={jiraEmailDraft}
          placeholder="you@company.com"
          onChange={(e) => onJiraEmailDraftChange(e.target.value)}
          className="coop-settings-field"
        />
      </label>

      <label className="coop-settings-field-row">
        <span className="coop-settings-label">Jira API token</span>
        <ConfiguredSecretInput
          configured={prefs.hasJiraCredentials}
          value={jiraTokenDraft}
          placeholder="Atlassian API token"
          onChange={onJiraTokenDraftChange}
          className="coop-settings-field"
        />
      </label>
      <div className="coop-settings-actions">
        <button type="button" className="coop-settings-action-btn" onClick={onSaveJiraCredentials}>
          Save Jira credentials
        </button>
        <button
          type="button"
          className="coop-settings-action-btn"
          onClick={onClearJiraCredentials}
          disabled={!prefs.hasJiraCredentials}
        >
          Clear
        </button>
        <TestButton
          testKey="jira"
          label="Test Jira"
          pendingTest={pendingTest}
          testResult={testResult}
          onClick={() => onTestIntegration("jira")}
        />
        <SaveFlashLabel show={savedFlashKey === "jira"} />
      </div>
    </SettingsSection>
  );
}

function TeamsDetail({
  prefs,
  teamsTokenDraft,
  onTeamsTokenDraftChange,
  onSaveTeamsToken,
  onClearTeamsToken,
  onTestIntegration,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <label className="coop-settings-field-row">
        <span className="coop-settings-label">
          Microsoft Teams (Graph) token {prefs.hasTeamsToken ? "(configured)" : ""}
        </span>
        <ConfiguredSecretInput
          configured={prefs.hasTeamsToken}
          value={teamsTokenDraft}
          placeholder="OAuth access token for Microsoft Graph"
          onChange={onTeamsTokenDraftChange}
          className="coop-settings-field"
        />
      </label>
      <div className="coop-settings-actions">
        <button type="button" className="coop-settings-action-btn" onClick={onSaveTeamsToken}>
          Save Teams token
        </button>
        <button
          type="button"
          className="coop-settings-action-btn"
          onClick={onClearTeamsToken}
          disabled={!prefs.hasTeamsToken}
        >
          Clear
        </button>
        <TestButton
          testKey="teams"
          label="Test Teams"
          pendingTest={pendingTest}
          testResult={testResult}
          onClick={() => onTestIntegration("teams")}
        />
        <SaveFlashLabel show={savedFlashKey === "teams"} />
      </div>
    </SettingsSection>
  );
}

function WorkspaceDetail({ prefs, onUpdate }: SettingsDetailProps): React.ReactElement {
  return (
    <>
      <SettingsSection title="Repository">
        <p className="coop-settings-card-desc">
          For Trace Decision. These save automatically when you type. Use the same owner and repo name as on
          github.com.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Owner</span>
            <input
              type="text"
              value={prefs.owner}
              onChange={(e) => onUpdate({ owner: e.target.value })}
              className="coop-settings-field"
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Repo</span>
            <input
              type="text"
              value={prefs.repo}
              onChange={(e) => onUpdate({ repo: e.target.value })}
              className="coop-settings-field"
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Branch</span>
            <input
              type="text"
              value={prefs.branch}
              onChange={(e) => onUpdate({ branch: e.target.value })}
              className="coop-settings-field"
            />
          </label>
        </div>
      </SettingsSection>

      <SettingsSection title="Context">
        <SettingsCheckboxRow
          title="Include active file"
          description="Send the currently open file with each message"
          checked={prefs.includeActiveFile}
          onChange={(checked) => onUpdate({ includeActiveFile: checked })}
        />
        <SettingsCheckboxRow
          title="Include editor selection"
          description="Send highlighted text with each message"
          checked={prefs.includeSelection}
          onChange={(checked) => onUpdate({ includeSelection: checked })}
        />
        <SettingsCheckboxRow
          title="Reuse responses"
          description="Cache identical prompts for 5 minutes"
          checked={prefs.useCachedResponses}
          onChange={(checked) => onUpdate({ useCachedResponses: checked })}
        />
      </SettingsSection>
    </>
  );
}

function PromptsDetail({
  promptLibrary,
  onUpdatePinnedPrompts,
  onManagePromptLibrary
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <PromptLibraryTop5Editor
        prompts={promptLibrary.prompts}
        pinnedIds={promptLibrary.pinnedIds}
        hasWorkspace={promptLibrary.hasWorkspace}
        onUpdatePinned={onUpdatePinnedPrompts}
        onManageLibrary={onManagePromptLibrary}
      />
    </SettingsSection>
  );
}

import React, { useMemo } from "react";
import { MODELS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER } from "../../config/llmModels";
import { TestButton, type SettingsTestKey } from "./TestButton";
import { PromptLibraryTop5Editor } from "./PromptLibraryTop5Editor";
import type { PromptLibraryItem } from "./promptLibraryTypes";
import type {
  CodeHostProviderPreference,
  DecisionIntegrationProvider,
  LlmProviderPreference
} from "../../chat/types";

export type Preferences = {
  model: string;
  llmProvider: LlmProviderPreference;
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
  hasGitLabToken: boolean;
  hasBitbucketCredentials: boolean;
  hasSlackToken: boolean;
  hasJiraCredentials: boolean;
  hasTeamsToken: boolean;
  jiraBaseUrl: string;
};

type SettingsPanelProps = {
  prefs: Preferences;
  onClose: () => void;
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
  gitlabTokenDraft: string;
  onGitlabTokenDraftChange: (value: string) => void;
  onSaveGitlabToken: () => void;
  onClearGitlabToken: () => void;
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
  onTestIntegration: (provider: DecisionIntegrationProvider) => void;
  onClearChat: () => void;
  connectionTestMessage?: string;
  connectionTestOk?: boolean;
  pendingTest: SettingsTestKey | null;
  testResult: { key: SettingsTestKey; ok: boolean } | null;
  promptLibrary: {
    prompts: PromptLibraryItem[];
    pinnedIds: string[];
    hasWorkspace: boolean;
  };
  onUpdatePinnedPrompts: (pinnedIds: string[]) => void;
  onManagePromptLibrary: () => void;
};

function SettingsSection({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section>
      <h2 className="coop-settings-section-label">{title}</h2>
      <div className="coop-settings-card">{children}</div>
    </section>
  );
}

function SettingsCheckboxRow({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="coop-settings-checkbox-row">
      <div className="min-w-0 flex-1">
        <div className="coop-settings-row-title">{title}</div>
        {description ? <div className="coop-settings-row-desc">{description}</div> : null}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsPanel({
  prefs,
  onClose,
  onUpdate,
  apiKeyDraft,
  onApiKeyDraftChange,
  onSaveApiKey,
  onClearApiKey,
  onTestConnection,
  onTestCodeHost,
  githubTokenDraft,
  onGithubTokenDraftChange,
  onSaveGithubToken,
  onClearGithubToken,
  gitlabTokenDraft,
  onGitlabTokenDraftChange,
  onSaveGitlabToken,
  onClearGitlabToken,
  bitbucketUsernameDraft,
  onBitbucketUsernameDraftChange,
  bitbucketPasswordDraft,
  onBitbucketPasswordDraftChange,
  onSaveBitbucketCredentials,
  onClearBitbucketCredentials,
  slackTokenDraft,
  onSlackTokenDraftChange,
  onSaveSlackToken,
  onClearSlackToken,
  jiraEmailDraft,
  onJiraEmailDraftChange,
  jiraTokenDraft,
  onJiraTokenDraftChange,
  onSaveJiraCredentials,
  onClearJiraCredentials,
  teamsTokenDraft,
  onTeamsTokenDraftChange,
  onSaveTeamsToken,
  onClearTeamsToken,
  onTestIntegration,
  onClearChat,
  connectionTestMessage,
  connectionTestOk,
  pendingTest,
  testResult,
  promptLibrary,
  onUpdatePinnedPrompts,
  onManagePromptLibrary
}: SettingsPanelProps): React.ReactElement {
  const models = useMemo(() => MODELS_BY_PROVIDER[prefs.llmProvider] ?? [], [prefs.llmProvider]);

  const onProviderChange = (provider: LlmProviderPreference) => {
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider];
    const nextModel = MODELS_BY_PROVIDER[provider].includes(prefs.model) ? prefs.model : defaultModel;
    onUpdate({ llmProvider: provider, model: nextModel });
  };

  return (
    <div className="coop-settings-dialog">
      <header className="coop-settings-header">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[13px] font-semibold text-[var(--coop-panel-foreground)]">Chat settings</h1>
          {prefs.hasApiKey ? (
            <span className="shrink-0 text-[11px] text-[var(--vscode-testing-iconPassed,#22c55e)]">API key configured</span>
          ) : (
            <span className="shrink-0 text-[11px] text-[var(--coop-panel-muted)]">No API key</span>
          )}
        </div>
        <button
          type="button"
          className="coop-icon-btn shrink-0"
          onClick={onClose}
          aria-label="Close settings"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 6.586L3.414 2 2 3.414 6.586 8 2 12.586 3.414 14 8 9.414 12.586 14 14 12.586 9.414 8 14 3.414 12.586 2 8 6.586z" />
          </svg>
        </button>
      </header>

      <div className="coop-settings-body">
        <SettingsSection title="Model">
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

        <SettingsSection title="API connection">
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">CoopAI API key</span>
            <input
              type="password"
              value={apiKeyDraft}
              placeholder="Local dev: any value (e.g. dev) then Save"
              onChange={(e) => onApiKeyDraftChange(e.target.value)}
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

        <SettingsSection title="Code hosts">
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

          <label className="coop-settings-field-row">
            <span className="coop-settings-label">GitHub token {prefs.hasGitHubToken ? "(configured)" : ""}</span>
            <input
              type="password"
              value={githubTokenDraft}
              placeholder="ghp_…"
              onChange={(e) => onGithubTokenDraftChange(e.target.value)}
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
            <TestButton
              testKey="github"
              label="Test GitHub"
              pendingTest={pendingTest}
              testResult={testResult}
              onClick={() => onTestCodeHost("github")}
            />
          </div>
          <p className="coop-settings-card-desc">
            The box stays empty after save for security. If the label says (configured), your token is stored. Click Test
            GitHub to turn on quick actions.
          </p>

          <label className="coop-settings-field-row">
            <span className="coop-settings-label">GitLab token {prefs.hasGitLabToken ? "(configured)" : ""}</span>
            <input
              type="password"
              value={gitlabTokenDraft}
              placeholder="glpat-…"
              onChange={(e) => onGitlabTokenDraftChange(e.target.value)}
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
            <TestButton
              testKey="gitlab"
              label="Test GitLab"
              pendingTest={pendingTest}
              testResult={testResult}
              onClick={() => onTestCodeHost("gitlab")}
            />
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
              <input
                type="password"
                value={bitbucketPasswordDraft}
                onChange={(e) => onBitbucketPasswordDraftChange(e.target.value)}
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
            <TestButton
              testKey="bitbucket"
              label="Test Bitbucket"
              pendingTest={pendingTest}
              testResult={testResult}
              onClick={() => onTestCodeHost("bitbucket")}
            />
          </div>
        </SettingsSection>

        <SettingsSection title="Decision archaeology">
          <p className="coop-settings-card-desc">
            Optional integrations for Trace Decision. Tokens are stored in VS Code SecretStorage only.
          </p>

          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Slack token {prefs.hasSlackToken ? "(configured)" : ""}</span>
            <input
              type="password"
              value={slackTokenDraft}
              placeholder="xoxp-… (channels:read, chat:read, users:read)"
              onChange={(e) => onSlackTokenDraftChange(e.target.value)}
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
          </div>

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
            <input
              type="password"
              value={jiraTokenDraft}
              placeholder="Atlassian API token"
              onChange={(e) => onJiraTokenDraftChange(e.target.value)}
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
          </div>

          <label className="coop-settings-field-row">
            <span className="coop-settings-label">
              Microsoft Teams (Graph) token {prefs.hasTeamsToken ? "(configured)" : ""}
            </span>
            <input
              type="password"
              value={teamsTokenDraft}
              placeholder="OAuth access token for Microsoft Graph"
              onChange={(e) => onTeamsTokenDraftChange(e.target.value)}
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
          </div>
        </SettingsSection>

        <SettingsSection title="Repository">
          <p className="coop-settings-card-desc">
            For Trace Decision. These save automatically when you type. Use the same owner and repo name as on
            github.com (yours: raneyja / CoopAI).
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

        <SettingsSection title="Prompt library">
          <PromptLibraryTop5Editor
            prompts={promptLibrary.prompts}
            pinnedIds={promptLibrary.pinnedIds}
            hasWorkspace={promptLibrary.hasWorkspace}
            onUpdatePinned={onUpdatePinnedPrompts}
            onManageLibrary={onManagePromptLibrary}
          />
        </SettingsSection>

        <section>
          <h2 className="coop-settings-section-label">Chat</h2>
          <div className="coop-settings-footer">
            <button type="button" className="coop-settings-action-btn" onClick={onClearChat}>
              Clear chat
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

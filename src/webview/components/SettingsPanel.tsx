import React, { useMemo } from "react";
import { MODELS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER } from "../../config/llmModels";
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
  onExportChat: () => void;
  connectionTestMessage?: string;
};

const inputClassName =
  "rounded border px-2 py-1 min-w-0 text-[13px] border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]";

const labelClassName = "text-[11px] font-normal text-[var(--vscode-descriptionForeground)]";

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
  onExportChat,
  connectionTestMessage
}: SettingsPanelProps): React.ReactElement {
  const models = useMemo(() => MODELS_BY_PROVIDER[prefs.llmProvider] ?? [], [prefs.llmProvider]);

  const onProviderChange = (provider: LlmProviderPreference) => {
    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider];
    const nextModel = MODELS_BY_PROVIDER[provider].includes(prefs.model) ? prefs.model : defaultModel;
    onUpdate({ llmProvider: provider, model: nextModel });
  };

  return (
    <div className="coop-settings-dialog w-full max-w-[720px] overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--vscode-widget-border)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[13px] font-semibold text-[var(--vscode-foreground)]">Chat settings</h1>
          {prefs.hasApiKey ? (
            <span className="shrink-0 text-[11px] text-[var(--vscode-testing-iconPassed,#22c55e)]">API key configured</span>
          ) : (
            <span className="shrink-0 text-[11px] text-[var(--vscode-descriptionForeground)]">No API key</span>
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

      <div className="max-h-[min(70vh,640px)] space-y-3 overflow-y-auto px-4 py-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClassName}>LLM provider (routed server-side)</span>
          <select
            value={prefs.llmProvider}
            onChange={(e) => onProviderChange(e.target.value as LlmProviderPreference)}
            className={inputClassName}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="deepseek">DeepSeek (legal review)</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClassName}>Model</span>
          <select value={prefs.model} onChange={(e) => onUpdate({ model: e.target.value })} className={inputClassName}>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Temperature</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={prefs.temperature}
              onChange={(e) => onUpdate({ temperature: Number(e.target.value) })}
              className={inputClassName}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Max tokens</span>
            <input
              type="number"
              min={256}
              max={8192}
              step={256}
              value={prefs.maxTokens}
              onChange={(e) => onUpdate({ maxTokens: Number(e.target.value) })}
              className={inputClassName}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-[var(--vscode-foreground)]">
          <input
            type="checkbox"
            checked={prefs.llmEnabled}
            onChange={(e) => onUpdate({ llmEnabled: e.target.checked })}
          />
          Enable live LLM chat (/v1/chat)
        </label>

        <label className="flex items-center gap-2 text-[12px] text-[var(--vscode-foreground)]">
          <input
            type="checkbox"
            checked={prefs.autocompleteEnabled}
            onChange={(e) => onUpdate({ autocompleteEnabled: e.target.checked })}
          />
          Enable inline autocomplete (when API supports it)
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClassName}>Coop API key</span>
          <input
            type="password"
            value={apiKeyDraft}
            placeholder="Local dev: any value (e.g. dev) then Save"
            onChange={(e) => onApiKeyDraftChange(e.target.value)}
            className={inputClassName}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="coop-text-btn" onClick={onSaveApiKey}>
              Save API key
            </button>
            <button type="button" className="coop-text-btn" onClick={onClearApiKey} disabled={!prefs.hasApiKey}>
              Clear key
            </button>
            <button type="button" className="coop-text-btn" onClick={onTestConnection}>
              Test connection
            </button>
          </div>
          {connectionTestMessage ? (
            <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">{connectionTestMessage}</span>
          ) : null}
          <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">
            LLM provider keys are routed server-side; code host tokens stay in VS Code SecretStorage.
          </span>
        </label>

        <div className="space-y-2 rounded border border-[var(--vscode-widget-border)] p-2">
          <div className="text-[12px] font-medium text-[var(--vscode-foreground)]">Code hosts (zero-clone)</div>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Default code host</span>
            <select
              value={prefs.defaultCodeHost}
              onChange={(e) => onUpdate({ defaultCodeHost: e.target.value as CodeHostProviderPreference })}
              className={inputClassName}
            >
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="bitbucket">Bitbucket</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>
              GitHub token {prefs.hasGitHubToken ? "(configured)" : ""}
            </span>
            <input
              type="password"
              value={githubTokenDraft}
              placeholder="ghp_…"
              onChange={(e) => onGithubTokenDraftChange(e.target.value)}
              className={inputClassName}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="coop-text-btn" onClick={onSaveGithubToken}>
                Save GitHub token
              </button>
              <button type="button" className="coop-text-btn" onClick={onClearGithubToken} disabled={!prefs.hasGitHubToken}>
                Clear
              </button>
              <button type="button" className="coop-text-btn" onClick={() => onTestCodeHost("github")}>
                Test GitHub
              </button>
            </div>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>
              GitLab token {prefs.hasGitLabToken ? "(configured)" : ""}
            </span>
            <input
              type="password"
              value={gitlabTokenDraft}
              placeholder="glpat-…"
              onChange={(e) => onGitlabTokenDraftChange(e.target.value)}
              className={inputClassName}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="coop-text-btn" onClick={onSaveGitlabToken}>
                Save GitLab token
              </button>
              <button type="button" className="coop-text-btn" onClick={onClearGitlabToken} disabled={!prefs.hasGitLabToken}>
                Clear
              </button>
              <button type="button" className="coop-text-btn" onClick={() => onTestCodeHost("gitlab")}>
                Test GitLab
              </button>
            </div>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>GitLab API base URL</span>
            <input
              type="url"
              value={prefs.gitlabBaseUrl}
              onChange={(e) => onUpdate({ gitlabBaseUrl: e.target.value })}
              className={inputClassName}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={labelClassName}>Bitbucket username</span>
              <input
                type="text"
                value={bitbucketUsernameDraft}
                onChange={(e) => onBitbucketUsernameDraftChange(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1">
              <span className={labelClassName}>
                App password {prefs.hasBitbucketCredentials ? "(configured)" : ""}
              </span>
              <input
                type="password"
                value={bitbucketPasswordDraft}
                onChange={(e) => onBitbucketPasswordDraftChange(e.target.value)}
                className={inputClassName}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="coop-text-btn" onClick={onSaveBitbucketCredentials}>
              Save Bitbucket credentials
            </button>
            <button
              type="button"
              className="coop-text-btn"
              onClick={onClearBitbucketCredentials}
              disabled={!prefs.hasBitbucketCredentials}
            >
              Clear
            </button>
            <button type="button" className="coop-text-btn" onClick={() => onTestCodeHost("bitbucket")}>
              Test Bitbucket
            </button>
          </div>
        </div>

        <div className="space-y-2 rounded border border-[var(--vscode-widget-border)] p-2">
          <div className="text-[12px] font-medium text-[var(--vscode-foreground)]">
            Decision archaeology (Slack, Jira, Teams)
          </div>
          <p className="text-[11px] text-[var(--vscode-descriptionForeground)]">
            Optional integrations for Trace Decision. Tokens are stored in VS Code SecretStorage only.
          </p>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Slack token {prefs.hasSlackToken ? "(configured)" : ""}</span>
            <input
              type="password"
              value={slackTokenDraft}
              placeholder="xoxp-… (channels:read, chat:read, users:read)"
              onChange={(e) => onSlackTokenDraftChange(e.target.value)}
              className={inputClassName}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="coop-text-btn" onClick={onSaveSlackToken}>
                Save Slack token
              </button>
              <button type="button" className="coop-text-btn" onClick={onClearSlackToken} disabled={!prefs.hasSlackToken}>
                Clear
              </button>
              <button type="button" className="coop-text-btn" onClick={() => onTestIntegration("slack")}>
                Test Slack
              </button>
            </div>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Jira site URL</span>
            <input
              type="url"
              value={prefs.jiraBaseUrl}
              placeholder="https://your-company.atlassian.net"
              onChange={(e) => onUpdate({ jiraBaseUrl: e.target.value })}
              className={inputClassName}
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>
              Jira account email {prefs.hasJiraCredentials ? "(configured)" : ""}
            </span>
            <input
              type="email"
              value={jiraEmailDraft}
              placeholder="you@company.com"
              onChange={(e) => onJiraEmailDraftChange(e.target.value)}
              className={inputClassName}
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Jira API token</span>
            <input
              type="password"
              value={jiraTokenDraft}
              placeholder="Atlassian API token"
              onChange={(e) => onJiraTokenDraftChange(e.target.value)}
              className={inputClassName}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="coop-text-btn" onClick={onSaveJiraCredentials}>
                Save Jira credentials
              </button>
              <button
                type="button"
                className="coop-text-btn"
                onClick={onClearJiraCredentials}
                disabled={!prefs.hasJiraCredentials}
              >
                Clear
              </button>
              <button type="button" className="coop-text-btn" onClick={() => onTestIntegration("jira")}>
                Test Jira
              </button>
            </div>
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>
              Microsoft Teams (Graph) token {prefs.hasTeamsToken ? "(configured)" : ""}
            </span>
            <input
              type="password"
              value={teamsTokenDraft}
              placeholder="OAuth access token for Microsoft Graph"
              onChange={(e) => onTeamsTokenDraftChange(e.target.value)}
              className={inputClassName}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="coop-text-btn" onClick={onSaveTeamsToken}>
                Save Teams token
              </button>
              <button type="button" className="coop-text-btn" onClick={onClearTeamsToken} disabled={!prefs.hasTeamsToken}>
                Clear
              </button>
              <button type="button" className="coop-text-btn" onClick={() => onTestIntegration("teams")}>
                Test Teams
              </button>
            </div>
          </label>
        </div>

        <label className="flex min-w-0 flex-col gap-1">
          <span className={labelClassName}>API base URL</span>
          <input
            type="url"
            value={prefs.apiBaseUrl}
            onChange={(e) => onUpdate({ apiBaseUrl: e.target.value })}
            className={inputClassName}
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Owner</span>
            <input type="text" value={prefs.owner} onChange={(e) => onUpdate({ owner: e.target.value })} className={inputClassName} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Repo</span>
            <input type="text" value={prefs.repo} onChange={(e) => onUpdate({ repo: e.target.value })} className={inputClassName} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClassName}>Branch</span>
            <input type="text" value={prefs.branch} onChange={(e) => onUpdate({ branch: e.target.value })} className={inputClassName} />
          </label>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-[var(--vscode-foreground)]">
          <input
            type="checkbox"
            checked={prefs.includeActiveFile}
            onChange={(e) => onUpdate({ includeActiveFile: e.target.checked })}
          />
          Include active file in context
        </label>

        <label className="flex items-center gap-2 text-[12px] text-[var(--vscode-foreground)]">
          <input
            type="checkbox"
            checked={prefs.includeSelection}
            onChange={(e) => onUpdate({ includeSelection: e.target.checked })}
          />
          Include editor selection in context
        </label>

        <label className="flex items-center gap-2 text-[12px] text-[var(--vscode-foreground)]">
          <input
            type="checkbox"
            checked={prefs.useCachedResponses}
            onChange={(e) => onUpdate({ useCachedResponses: e.target.checked })}
          />
          Reuse responses for 5 minutes
        </label>

        <div className="flex flex-wrap gap-2 border-t border-[var(--vscode-widget-border)] pt-2">
          <button type="button" className="coop-text-btn" onClick={onClearChat}>
            Clear chat
          </button>
          <button type="button" className="coop-text-btn" onClick={onExportChat}>
            Export chat
          </button>
        </div>
      </div>
    </div>
  );
}

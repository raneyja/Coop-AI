import React, { useEffect, useMemo, useRef, useState } from "react";
import { MODELS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER } from "../../../config/llmModels";
import { TestButton, type SettingsTestKey } from "../TestButton";
import { SaveFlashLabel, type SettingsSaveKey } from "../SaveFlashLabel";
import { ConfiguredSecretInput } from "../ConfiguredSecretInput";
import { PromptLibraryTop5Editor } from "../PromptLibraryTop5Editor";
import type { PromptLibraryItem } from "../promptLibraryTypes";
import type { CodeHostProviderPreference, IntegrationChatProvider, LlmProviderPreference } from "../../../chat/types";
import type { Preferences, SettingsDetailScreen } from "./types";
import { ConnectionCard } from "./ConnectionCard";
import { IntegrationConnectionShell } from "./IntegrationConnectionShell";
import {
  codeHostConnectionMeta,
  codeHostListSubtitle,
  integrationListSubtitle
} from "./connectionCopy";
import { IdentityLinksDetail } from "./IdentityLinksDetail";
import { SettingsCheckboxRow, SettingsSection } from "./SettingsShared";
import type { IdentityDirectory } from "../../../identity/types";
import { CoopNavList, CoopNavRow } from "../CoopNavRow";
import { codeHostConfigured, integrationConfigured } from "./subtitles";

/**
 * URL inputs bound directly to persisted prefs lose keystrokes: each change posts to the
 * extension host and the echoed `settings:state` re-renders the field back to the old value.
 * This keeps a local draft and only re-syncs from the persisted value while the field is not
 * focused, so typing is never clobbered mid-edit.
 */
function SettingsUrlField({
  value,
  placeholder,
  onCommit
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(value);
    }
  }, [value]);

  return (
    <input
      type="url"
      value={draft}
      placeholder={placeholder}
      className="coop-settings-field"
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
      onBlur={() => {
        focusedRef.current = false;
        onCommit(draft.trim());
      }}
    />
  );
}

export type SettingsDetailProps = {
  prefs: Preferences;
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
  onTestIntegration: (provider: import("../../../chat/types").IntegrationChatProvider) => void;
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
  onNavigate: (screen: SettingsDetailScreen) => void;
  onSaveIdentityDirectory: (directory: IdentityDirectory) => void;
  onInstallSlackApp: () => void;
  onRefreshSlackInstallation: () => void;
  onInstallAtlassianApp: () => void;
  onRefreshAtlassianInstallation: (key: "jira" | "confluence") => void;
  onConnectIntegrationNotice?: (provider: IntegrationChatProvider) => void;
};

export function SettingsDetailView({
  screen,
  ...props
}: { screen: SettingsDetailScreen } & SettingsDetailProps): React.ReactElement {
  switch (screen) {
    case "model":
      return <ModelDetail {...props} />;
    case "account":
      return <AccountDetail {...props} />;
    case "connections":
      return <ConnectionsListDetail {...props} />;
    case "code-host-github":
      return <GitHubDetail {...props} />;
    case "code-host-gitlab":
      return <GitLabDetail {...props} />;
    case "code-host-bitbucket":
      return <BitbucketDetail {...props} />;
    case "integration-slack":
      return <SlackDetail {...props} />;
    case "integration-jira":
      return <JiraDetail {...props} />;
    case "integration-teams":
      return <TeamsDetail {...props} />;
    case "integration-confluence":
      return <ConfluenceDetail {...props} />;
    case "integration-notion":
      return <NotionDetail {...props} />;
    case "integration-google-docs":
      return <GoogleDocsDetail {...props} />;
    case "workspace":
      return <WorkspaceDetail {...props} />;
    case "team":
      return <IdentityLinksDetail directory={props.prefs.identityDirectory} onSave={props.onSaveIdentityDirectory} />;
    case "preferences":
      return <PreferencesListDetail {...props} />;
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
  const [draft, setDraft] = useState({
    llmProvider: prefs.llmProvider,
    model: prefs.model,
    temperature: prefs.temperature,
    maxTokens: prefs.maxTokens,
    llmEnabled: prefs.llmEnabled,
    autocompleteEnabled: prefs.autocompleteEnabled
  });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  // Re-sync from persisted prefs only when there are no pending edits, so an
  // unrelated settings:state push can't clobber what the user is editing.
  useEffect(() => {
    if (!dirty) {
      setDraft({
        llmProvider: prefs.llmProvider,
        model: prefs.model,
        temperature: prefs.temperature,
        maxTokens: prefs.maxTokens,
        llmEnabled: prefs.llmEnabled,
        autocompleteEnabled: prefs.autocompleteEnabled
      });
    }
  }, [
    prefs.llmProvider,
    prefs.model,
    prefs.temperature,
    prefs.maxTokens,
    prefs.llmEnabled,
    prefs.autocompleteEnabled,
    dirty
  ]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) {
        window.clearTimeout(savedTimer.current);
      }
    },
    []
  );

  const models = useMemo(() => MODELS_BY_PROVIDER[draft.llmProvider] ?? [], [draft.llmProvider]);

  const update = (partial: Partial<typeof draft>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
    setDirty(true);
    setSaved(false);
  };

  const onProviderChange = (provider: LlmProviderPreference) => {
    const nextModel = MODELS_BY_PROVIDER[provider].includes(draft.model)
      ? draft.model
      : DEFAULT_MODEL_BY_PROVIDER[provider];
    update({ llmProvider: provider, model: nextModel });
  };

  const handleSave = () => {
    onUpdate({
      llmProvider: draft.llmProvider,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      llmEnabled: draft.llmEnabled,
      autocompleteEnabled: draft.autocompleteEnabled
    });
    setDirty(false);
    setSaved(true);
    if (savedTimer.current !== null) {
      window.clearTimeout(savedTimer.current);
    }
    savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <SettingsSection>
        <label className="coop-settings-field-row">
          <span className="coop-settings-label">LLM provider (routed server-side)</span>
          <select
            value={draft.llmProvider}
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
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
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
              value={draft.temperature}
              onChange={(e) => update({ temperature: Number(e.target.value) })}
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
              value={draft.maxTokens}
              onChange={(e) => update({ maxTokens: Number(e.target.value) })}
              className="coop-settings-field"
            />
          </label>
        </div>

        <SettingsCheckboxRow
          title="Enable live LLM chat"
          description="Routes requests through /v1/chat"
          checked={draft.llmEnabled}
          onChange={(checked) => update({ llmEnabled: checked })}
        />
        <SettingsCheckboxRow
          title="Enable inline autocomplete"
          description="When the API supports it"
          checked={draft.autocompleteEnabled}
          onChange={(checked) => update({ autocompleteEnabled: checked })}
        />

        <div className="coop-settings-actions">
          <button type="button" className="coop-settings-action-btn" onClick={handleSave} disabled={!dirty}>
            Save model settings
          </button>
          <SaveFlashLabel show={saved} />
        </div>
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

function AccountDetail({
  prefs,
  onUpdate,
  apiKeyDraft,
  onApiKeyDraftChange,
  onSaveApiKey,
  onClearApiKey,
  onSignInSso,
  onSignOut,
  onTestConnection,
  connectionTestMessage,
  connectionTestOk,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  const [urlDraft, setUrlDraft] = useState(prefs.apiBaseUrl);
  const [urlDirty, setUrlDirty] = useState(false);
  const [urlSaved, setUrlSaved] = useState(false);
  const [ssoOrgDraft, setSsoOrgDraft] = useState(prefs.orgName ?? "");
  const urlSavedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!urlDirty) {
      setUrlDraft(prefs.apiBaseUrl);
    }
  }, [prefs.apiBaseUrl, urlDirty]);

  useEffect(() => {
    if (prefs.orgName) {
      setSsoOrgDraft(prefs.orgName);
    }
  }, [prefs.orgName]);

  useEffect(
    () => () => {
      if (urlSavedTimer.current !== null) {
        window.clearTimeout(urlSavedTimer.current);
      }
    },
    []
  );

  const saveUrl = () => {
    onUpdate({ apiBaseUrl: urlDraft.trim() });
    setUrlDirty(false);
    setUrlSaved(true);
    if (urlSavedTimer.current !== null) {
      window.clearTimeout(urlSavedTimer.current);
    }
    urlSavedTimer.current = window.setTimeout(() => setUrlSaved(false), 2000);
  };

  return (
    <SettingsSection>
      {prefs.hasApiKey && prefs.authMethod === "sso_session" ? (
        <p className="coop-settings-card-desc">
          Signed in to {prefs.orgName ?? "your organization"}
          {prefs.userRole ? ` as ${prefs.userRole}` : ""}.
        </p>
      ) : null}
      {prefs.plan === "enterprise" ? (
        <>
          <p className="coop-prompt-modal-section-title">Enterprise sign-in</p>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Organization name</span>
            <input
              type="text"
              value={ssoOrgDraft}
              placeholder="Acme Corp"
              className="coop-settings-field"
              onChange={(e) => setSsoOrgDraft(e.target.value)}
            />
          </label>
          <div className="coop-settings-actions">
            <button
              type="button"
              className="coop-settings-action-btn"
              onClick={() => onSignInSso(ssoOrgDraft.trim() || undefined)}
            >
              Sign in with SSO
            </button>
            {prefs.hasApiKey ? (
              <button type="button" className="coop-settings-action-btn" onClick={onSignOut}>
                Sign out
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <p className="coop-prompt-modal-section-title">
        {prefs.plan === "enterprise" ? "API key (admin / automation)" : "Advanced · API key"}
      </p>
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
          value={urlDraft}
          placeholder="http://localhost:8787"
          className="coop-settings-field"
          onChange={(e) => {
            setUrlDraft(e.target.value);
            setUrlDirty(true);
            setUrlSaved(false);
          }}
        />
      </label>
      <div className="coop-settings-actions">
        <button type="button" className="coop-settings-action-btn" onClick={saveUrl} disabled={!urlDirty}>
          Save URL
        </button>
        <SaveFlashLabel show={urlSaved} />
      </div>
    </SettingsSection>
  );
}

function ConnectionsListDetail({
  prefs,
  onUpdate,
  onNavigate
}: SettingsDetailProps): React.ReactElement {
  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        Connect source code and collaboration tools through browser sign-in. Credentials are stored on the Coop
        server for production use — not pasted into VS Code.
      </p>

      <p className="coop-prompt-modal-section-title px-0.5">Source code</p>
      <SettingsSection>
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
          subtitle={codeHostListSubtitle(prefs, "github")}
          configured={codeHostConfigured(prefs, "github")}
          onClick={() => onNavigate("code-host-github")}
        />
        <CoopNavRow
          title="GitLab"
          subtitle={codeHostListSubtitle(prefs, "gitlab")}
          configured={codeHostConfigured(prefs, "gitlab")}
          onClick={() => onNavigate("code-host-gitlab")}
        />
        <CoopNavRow
          title="Bitbucket"
          subtitle={codeHostListSubtitle(prefs, "bitbucket")}
          configured={codeHostConfigured(prefs, "bitbucket")}
          onClick={() => onNavigate("code-host-bitbucket")}
        />
      </CoopNavList>

      <p className="coop-prompt-modal-section-title px-0.5 mt-4">Tools</p>
      <CoopNavList>
        <CoopNavRow
          title="Slack"
          subtitle={integrationListSubtitle(prefs, "slack")}
          configured={integrationConfigured(prefs, "slack")}
          onClick={() => onNavigate("integration-slack")}
        />
        <CoopNavRow
          title="Jira"
          subtitle={integrationListSubtitle(prefs, "jira")}
          configured={integrationConfigured(prefs, "jira")}
          onClick={() => onNavigate("integration-jira")}
        />
        <CoopNavRow
          title="Microsoft Teams"
          subtitle={integrationListSubtitle(prefs, "teams")}
          configured={integrationConfigured(prefs, "teams")}
          onClick={() => onNavigate("integration-teams")}
        />
        <CoopNavRow
          title="Confluence"
          subtitle={integrationListSubtitle(prefs, "confluence")}
          configured={integrationConfigured(prefs, "confluence")}
          onClick={() => onNavigate("integration-confluence")}
        />
        <CoopNavRow
          title="Notion"
          subtitle={integrationListSubtitle(prefs, "notion")}
          configured={integrationConfigured(prefs, "notion")}
          onClick={() => onNavigate("integration-notion")}
        />
        <CoopNavRow
          title="Google Docs"
          subtitle={integrationListSubtitle(prefs, "google-docs")}
          configured={integrationConfigured(prefs, "google-docs")}
          onClick={() => onNavigate("integration-google-docs")}
        />
      </CoopNavList>
    </>
  );
}

function PreferencesListDetail({ prefs, promptLibrary, onNavigate }: SettingsDetailProps): React.ReactElement {
  const pinned = promptLibrary.pinnedIds.length;
  return (
    <>
      <p className="coop-settings-card-desc px-0.5">Model defaults and your quick prompt library.</p>
      <CoopNavList>
        <CoopNavRow
          title="Model & chat"
          subtitle={prefs.llmEnabled ? `${prefs.model.replace(/-\d{8}$/, "").replace(/-/g, " ")} · Chat on` : "Chat off"}
          onClick={() => onNavigate("model")}
        />
        <CoopNavRow
          title="Prompt library"
          subtitle={pinned === 0 ? "No quick prompts pinned" : pinned === 1 ? "1 quick prompt pinned" : `${pinned} quick prompts pinned`}
          onClick={() => onNavigate("prompts")}
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
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  const cloudPath = !prefs.devMode;
  const canInstall = prefs.canInstallIntegrations === true;
  const connected = codeHostConfigured(prefs, "github");
  return (
    <SettingsSection>
      {cloudPath ? (
        <ConnectionCard
          name="GitHub"
          meta={codeHostConnectionMeta(prefs, "github")}
          connected={connected}
          required={!connected}
          description="Connect repositories through the Coop GitHub App. Installation credentials are stored on the server — no personal access token in VS Code."
          adminNotice={
            !canInstall
              ? "GitHub is connected by your organization admin. Ask IT to connect GitHub if repositories are unavailable."
              : undefined
          }
          connectLabel={connected ? "Manage GitHub connection" : "Connect GitHub"}
          onConnect={canInstall ? onInstallGithubApp : undefined}
          onRefresh={onRefreshGithubInstallation}
          refreshKey="github"
          pendingRefresh={pendingRefresh}
          refreshResult={refreshResult}
          onTest={onTestCodeHost ? () => onTestCodeHost("github") : undefined}
          testKey="github"
          testLabel="Test GitHub"
          pendingTest={pendingTest}
          testResult={testResult}
        />
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
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  const cloudPath = !prefs.devMode;
  const connected = codeHostConfigured(prefs, "gitlab");
  return (
    <SettingsSection>
      {cloudPath ? (
        <ConnectionCard
          name="GitLab"
          meta={codeHostConnectionMeta(prefs, "gitlab")}
          connected={connected}
          required={!connected}
          description="Connect repositories through the Coop GitLab OAuth app. Credentials are stored on the server — no personal access token in VS Code."
          connectLabel={connected ? "Manage GitLab connection" : "Connect GitLab"}
          onConnect={onInstallGitlabApp}
          onRefresh={onRefreshGitlabInstallation}
          refreshKey="gitlab"
          pendingRefresh={pendingRefresh}
          refreshResult={refreshResult}
          onTest={() => onTestCodeHost("gitlab")}
          testKey="gitlab"
          testLabel="Test GitLab"
          pendingTest={pendingTest}
          testResult={testResult}
        />
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
            <SettingsUrlField
              value={prefs.gitlabBaseUrl}
              placeholder="https://gitlab.com/api/v4"
              onCommit={(gitlabBaseUrl) => onUpdate({ gitlabBaseUrl })}
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
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  const cloudPath = !prefs.devMode;
  const connected = codeHostConfigured(prefs, "bitbucket");
  return (
    <SettingsSection>
      {cloudPath ? (
        <ConnectionCard
          name="Bitbucket"
          meta={codeHostConnectionMeta(prefs, "bitbucket")}
          connected={connected}
          required={!connected}
          description="Connect repositories through the Coop Bitbucket OAuth app. Credentials are stored on the server — no app password in VS Code."
          connectLabel={connected ? "Manage Bitbucket connection" : "Connect Bitbucket"}
          onConnect={onInstallBitbucketApp}
          onRefresh={onRefreshBitbucketInstallation}
          refreshKey="bitbucket"
          pendingRefresh={pendingRefresh}
          refreshResult={refreshResult}
          onTest={() => onTestCodeHost("bitbucket")}
          testKey="bitbucket"
          testLabel="Test Bitbucket"
          pendingTest={pendingTest}
          testResult={testResult}
        />
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

function SlackDetail({
  prefs,
  slackTokenDraft,
  onSlackTokenDraftChange,
  onSaveSlackToken,
  onClearSlackToken,
  onTestIntegration,
  onInstallSlackApp,
  onRefreshSlackInstallation,
  savedFlashKey,
  pendingTest,
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="slack"
        prefs={prefs}
        description="Search Slack threads and check teammate availability for Find Owner and Trace Decision."
        onConnect={onInstallSlackApp}
        onRefresh={onRefreshSlackInstallation}
        onTest={() => onTestIntegration("slack")}
        testKey="slack"
        pendingTest={pendingTest}
        testResult={testResult}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
        devFallback={
          <>
            <p className="coop-prompt-modal-section-title">Developer fallback (token)</p>
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
            <p className="coop-settings-card-desc coop-prompt-modal-muted">
              Internal use only (`coopAI.devMode`). Production users connect Slack in the browser above.
            </p>
          </>
        }
      />
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
  onInstallAtlassianApp,
  onRefreshAtlassianInstallation,
  savedFlashKey,
  pendingTest,
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="jira"
        prefs={prefs}
        description="Link Jira tickets to Trace Decision and surface repo-related work in chat."
        onConnect={onInstallAtlassianApp}
        onRefresh={() => onRefreshAtlassianInstallation("jira")}
        onTest={() => onTestIntegration("jira")}
        testKey="jira"
        pendingTest={pendingTest}
        testResult={testResult}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
        extraFields={
          !prefs.devMode ? (
            <label className="coop-settings-field-row mt-3">
              <span className="coop-settings-label">Jira site URL</span>
              <SettingsUrlField
                value={prefs.jiraBaseUrl}
                placeholder="https://your-company.atlassian.net"
                onCommit={(jiraBaseUrl) => onUpdate({ jiraBaseUrl })}
              />
            </label>
          ) : undefined
        }
        devFallback={
          <>
            <p className="coop-prompt-modal-section-title">Developer fallback (token)</p>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">Jira site URL</span>
              <SettingsUrlField
                value={prefs.jiraBaseUrl}
                placeholder="https://your-company.atlassian.net"
                onCommit={(jiraBaseUrl) => onUpdate({ jiraBaseUrl })}
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
          </>
        }
      />
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
  onConnectIntegrationNotice,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="teams"
        prefs={prefs}
        description="Search Microsoft Teams channels and messages for Trace Decision context."
        onConnectNotice={() => onConnectIntegrationNotice?.("teams")}
        onTest={() => onTestIntegration("teams")}
        testKey="teams"
        pendingTest={pendingTest}
        testResult={testResult}
        devFallback={
          <>
            <p className="coop-prompt-modal-section-title">Developer fallback (token)</p>
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
          </>
        }
      />
    </SettingsSection>
  );
}

function ConfluenceDetail({
  prefs,
  onUpdate,
  confluenceEmailDraft,
  onConfluenceEmailDraftChange,
  confluenceTokenDraft,
  onConfluenceTokenDraftChange,
  onSaveConfluenceCredentials,
  onClearConfluenceCredentials,
  onCopyJiraToConfluence,
  onTestIntegration,
  onInstallAtlassianApp,
  onRefreshAtlassianInstallation,
  savedFlashKey,
  pendingTest,
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="confluence"
        prefs={prefs}
        description="Search Confluence pages for Knowledge Gaps and documentation context in chat."
        onConnect={onInstallAtlassianApp}
        onRefresh={() => onRefreshAtlassianInstallation("confluence")}
        onTest={() => onTestIntegration("confluence")}
        testKey="confluence"
        pendingTest={pendingTest}
        testResult={testResult}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
        extraFields={
          !prefs.devMode ? (
            <label className="coop-settings-field-row mt-3">
              <span className="coop-settings-label">Confluence site URL</span>
              <SettingsUrlField
                value={prefs.confluenceBaseUrl}
                placeholder="https://your-company.atlassian.net/wiki"
                onCommit={(confluenceBaseUrl) => onUpdate({ confluenceBaseUrl })}
              />
            </label>
          ) : undefined
        }
        devFallback={
          <>
            <p className="coop-prompt-modal-section-title">Developer fallback (token)</p>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">Confluence site URL</span>
              <SettingsUrlField
                value={prefs.confluenceBaseUrl}
                placeholder="https://your-company.atlassian.net/wiki"
                onCommit={(confluenceBaseUrl) => onUpdate({ confluenceBaseUrl })}
              />
            </label>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">
                Confluence account email {prefs.hasConfluenceCredentials ? "(configured)" : ""}
              </span>
              <input
                type="email"
                value={confluenceEmailDraft}
                placeholder="you@company.com"
                onChange={(e) => onConfluenceEmailDraftChange(e.target.value)}
                className="coop-settings-field"
              />
            </label>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">Confluence API token</span>
              <ConfiguredSecretInput
                configured={prefs.hasConfluenceCredentials}
                value={confluenceTokenDraft}
                placeholder="Atlassian API token"
                onChange={onConfluenceTokenDraftChange}
                className="coop-settings-field"
              />
            </label>
            <div className="coop-settings-actions">
              <button type="button" className="coop-settings-action-btn" onClick={onCopyJiraToConfluence}>
                Use Jira credentials
              </button>
              <button type="button" className="coop-settings-action-btn" onClick={onSaveConfluenceCredentials}>
                Save Confluence credentials
              </button>
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={onClearConfluenceCredentials}
                disabled={!prefs.hasConfluenceCredentials}
              >
                Clear
              </button>
              <TestButton
                testKey="confluence"
                label="Test Confluence"
                pendingTest={pendingTest}
                testResult={testResult}
                onClick={() => onTestIntegration("confluence")}
              />
              <SaveFlashLabel show={savedFlashKey === "confluence"} />
            </div>
          </>
        }
      />
    </SettingsSection>
  );
}

function NotionDetail({
  prefs,
  notionTokenDraft,
  onNotionTokenDraftChange,
  onSaveNotionToken,
  onClearNotionToken,
  onTestIntegration,
  onConnectIntegrationNotice,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="notion"
        prefs={prefs}
        description="Search Notion pages for documentation context in chat and Knowledge Gaps."
        onConnectNotice={() => onConnectIntegrationNotice?.("notion")}
        onTest={() => onTestIntegration("notion")}
        testKey="notion"
        pendingTest={pendingTest}
        testResult={testResult}
        devFallback={
          <>
            <p className="coop-prompt-modal-section-title">Developer fallback (token)</p>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">
                Notion integration token {prefs.hasNotionToken ? "(configured)" : ""}
              </span>
              <ConfiguredSecretInput
                configured={prefs.hasNotionToken}
                value={notionTokenDraft}
                placeholder="secret_…"
                onChange={onNotionTokenDraftChange}
                className="coop-settings-field"
              />
            </label>
            <div className="coop-settings-actions">
              <button type="button" className="coop-settings-action-btn" onClick={onSaveNotionToken}>
                Save Notion token
              </button>
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={onClearNotionToken}
                disabled={!prefs.hasNotionToken}
              >
                Clear
              </button>
              <TestButton
                testKey="notion"
                label="Test Notion"
                pendingTest={pendingTest}
                testResult={testResult}
                onClick={() => onTestIntegration("notion")}
              />
              <SaveFlashLabel show={savedFlashKey === "notion"} />
            </div>
          </>
        }
      />
    </SettingsSection>
  );
}

function GoogleDocsDetail({
  prefs,
  googleDocsTokenDraft,
  onGoogleDocsTokenDraftChange,
  onSaveGoogleDocsToken,
  onClearGoogleDocsToken,
  onTestIntegration,
  onConnectIntegrationNotice,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="google-docs"
        prefs={prefs}
        description="Search Google Docs for documentation context in chat."
        onConnectNotice={() => onConnectIntegrationNotice?.("google-docs")}
        onTest={() => onTestIntegration("google-docs")}
        testKey="google-docs"
        pendingTest={pendingTest}
        testResult={testResult}
        devFallback={
          <>
            <p className="coop-prompt-modal-section-title">Developer fallback (token)</p>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">
                Google Docs (Drive) access token {prefs.hasGoogleDocsToken ? "(configured)" : ""}
              </span>
              <ConfiguredSecretInput
                configured={prefs.hasGoogleDocsToken}
                value={googleDocsTokenDraft}
                placeholder="OAuth access token with Drive read scope"
                onChange={onGoogleDocsTokenDraftChange}
                className="coop-settings-field"
              />
            </label>
            <div className="coop-settings-actions">
              <button type="button" className="coop-settings-action-btn" onClick={onSaveGoogleDocsToken}>
                Save Google Docs token
              </button>
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={onClearGoogleDocsToken}
                disabled={!prefs.hasGoogleDocsToken}
              >
                Clear
              </button>
              <TestButton
                testKey="google-docs"
                label="Test Google Docs"
                pendingTest={pendingTest}
                testResult={testResult}
                onClick={() => onTestIntegration("google-docs")}
              />
              <SaveFlashLabel show={savedFlashKey === "google-docs"} />
            </div>
          </>
        }
      />
    </SettingsSection>
  );
}

function WorkspaceDetail({ prefs, onUpdate }: SettingsDetailProps): React.ReactElement {
  const [draft, setDraft] = useState({ owner: prefs.owner, repo: prefs.repo, branch: prefs.branch });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!dirty) {
      setDraft({ owner: prefs.owner, repo: prefs.repo, branch: prefs.branch });
    }
  }, [prefs.owner, prefs.repo, prefs.branch, dirty]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) {
        window.clearTimeout(savedTimer.current);
      }
    },
    []
  );

  const update = (partial: Partial<typeof draft>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
    setDirty(true);
    setSaved(false);
  };

  const handleSave = () => {
    onUpdate({ owner: draft.owner.trim(), repo: draft.repo.trim(), branch: draft.branch.trim() });
    setDirty(false);
    setSaved(true);
    if (savedTimer.current !== null) {
      window.clearTimeout(savedTimer.current);
    }
    savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <SettingsSection title="Repository">
        <p className="coop-settings-card-desc">
          For Trace Decision. Use the same owner and repo name as on github.com, then click Save.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Owner</span>
            <input
              type="text"
              value={draft.owner}
              onChange={(e) => update({ owner: e.target.value })}
              className="coop-settings-field"
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Repo</span>
            <input
              type="text"
              value={draft.repo}
              onChange={(e) => update({ repo: e.target.value })}
              className="coop-settings-field"
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Branch</span>
            <input
              type="text"
              value={draft.branch}
              onChange={(e) => update({ branch: e.target.value })}
              className="coop-settings-field"
            />
          </label>
        </div>
        <div className="coop-settings-actions">
          <button type="button" className="coop-settings-action-btn" onClick={handleSave} disabled={!dirty}>
            Save repository
          </button>
          <SaveFlashLabel show={saved} />
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

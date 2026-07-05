import React, { useEffect, useMemo, useRef, useState } from "react";
import { MODELS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER, formatModelOptionLabel, modelsForProvider } from "../../../config/llmModels";
import { listEuropeanTimezoneOptions, resolveTimezonePreference, US_TIMEZONE_OPTIONS } from "../../../chat/timezone";
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
  displayOrgName,
  displayPlanLabel,
  formatQuotaUsageSummary,
  integrationListSubtitle,
  preferencesSignedIn
} from "./connectionCopy";
import type { SettingsLightningSummary } from "./SettingsHub";
import { IdentityLinksDetail } from "./IdentityLinksDetail";
import { SettingsCheckboxRow, SettingsSection } from "./SettingsShared";
import type { IdentityDirectory } from "../../../identity/types";
import { WorkspaceReposPickerModal } from "../WorkspaceReposPickerModal";
import type { GithubRepoOption } from "../../../chat/types";
import { CoopNavList, CoopNavRow } from "../CoopNavRow";
import { codeHostConfigured, identityLinksHubSubtitle, integrationConfigured } from "./subtitles";

function isFreeDeveloperPlan(prefs: Preferences): boolean {
  return !prefs.plan || prefs.plan === "free";
}

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
  onCopyApiKey: () => void;
  onRevealApiKey: () => void;
  onApiKeyBlurCommit: (value: string) => void;
  onSignInSso: (org?: string) => void;
  onSignInPassword: (email: string, password: string) => void;
  onSignInGoogle: () => void;
  onForgotPassword: (email: string) => void;
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
  onInstallNotionApp: () => void;
  onRefreshNotionInstallation: () => void;
  onInstallGoogleDocsApp: () => void;
  onRefreshGoogleDocsInstallation: () => void;
  onInstallTeamsApp: () => void;
  onRefreshTeamsInstallation: () => void;
  collections: import("./types").SettingsCollectionSummary[];
  collectionsError?: string;
  onRequestCollections: () => void;
  onLoadWorkspaceRepos: () => void;
  onSaveWorkspaceRepos: (repoIds: string[]) => void;
  workspacePickerState: {
    repos: GithubRepoOption[];
    selectedRepoIds: string[];
    selectedCount: number;
    limit: number | null;
    loading: boolean;
    saving: boolean;
    error?: string;
  };
  lightningState?: SettingsLightningSummary | null;
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
    case "plan-usage":
      return <PlanUsageDetail {...props} />;
    case "indexing":
      return <IndexingDetail {...props} />;
    case "tools":
      return <ToolsListDetail {...props} />;
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
      return <IdentityLinksDetail directory={props.prefs.identityDirectory} />;
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

  const models = useMemo(() => modelsForProvider(draft.llmProvider), [draft.llmProvider]);

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
              <option key={model.id} value={model.id}>
                {formatModelOptionLabel(model)}
              </option>
            ))}
          </select>
        </label>
        {prefs.plan === "free" ? (
          <p className="coop-settings-card-desc text-[11px] text-[var(--coop-panel-muted)]">
            Free plan: billed credits = tokens × model weight (shown above) × 2 for image attachments.
          </p>
        ) : null}

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
          description="Ghost-text suggestions via POST /v1/completions/inline (default off)"
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

function PlanUsageDetail({ prefs }: SettingsDetailProps): React.ReactElement {
  const orgName = displayOrgName(prefs);
  const adminBase = (prefs.adminPortalUrl ?? "https://admin.coop-ai.dev").replace(/\/$/, "");

  if (!preferencesSignedIn(prefs)) {
    return (
      <SettingsSection>
        <p className="coop-settings-card-desc">Sign in under Account to view plan and usage.</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection>
      <p className="coop-prompt-modal-section-title">Organization</p>
      <p>{orgName ?? "—"}</p>
      <p className="coop-prompt-modal-section-title mt-3">Plan &amp; Usage</p>
      <p>{displayPlanLabel(prefs)}</p>
      {prefs.plan === "free" && prefs.quotaCredits ? (
        <p className="mt-1 text-[11px] text-[var(--coop-panel-muted)]">
          {formatQuotaUsageSummary(prefs.quotaCredits)}
        </p>
      ) : null}
      <div className="coop-settings-actions mt-3">
        <a className="coop-settings-action-btn" href={adminBase} target="_blank" rel="noreferrer">
          Open admin portal
        </a>
        {isFreeDeveloperPlan(prefs) ? (
          <a
            className="coop-settings-action-btn"
            href={`${adminBase}/billing`}
            target="_blank"
            rel="noreferrer"
          >
            Upgrade to Pro
          </a>
        ) : null}
      </div>
      <p className="coop-settings-card-desc mt-2">
        Manage billing, usage, integrations, indexing, and team settings in the admin portal.
      </p>
    </SettingsSection>
  );
}

function IndexingDetail({ prefs, lightningState }: SettingsDetailProps): React.ReactElement {
  const adminBase = (prefs.adminPortalUrl ?? "https://admin.coop-ai.dev").replace(/\/$/, "");

  if (!preferencesSignedIn(prefs)) {
    return (
      <SettingsSection>
        <p className="coop-settings-card-desc">Sign in under Account to view indexing status.</p>
      </SettingsSection>
    );
  }

  const readyRepos = lightningState?.readyRepos ?? 0;
  const indexingRepos = lightningState?.indexingRepos ?? 0;
  const indexedCount = lightningState?.indexedRepoCount;
  const indexedLimit = lightningState?.indexedRepoLimit;

  return (
    <SettingsSection>
      <p className="coop-prompt-modal-section-title">Deep-Index status</p>
      {!lightningState ? (
        <p className="coop-settings-card-desc">Loading indexing status…</p>
      ) : (
        <>
          <p>
            {readyRepos} ready
            {indexingRepos > 0 ? (
              <span className="text-[var(--coop-panel-muted)]"> · {indexingRepos} building</span>
            ) : null}
          </p>
          {indexedLimit != null && indexedCount != null ? (
            <p className="mt-1 text-[11px] text-[var(--coop-panel-muted)]">
              {indexedCount} of {indexedLimit} Deep-Indexed repos on your plan
            </p>
          ) : null}
        </>
      )}
      <p className="coop-settings-card-desc mt-2">
        Org-wide indexing and repo catalog are managed in the admin portal. Workspace repo selection stays under
        Workspace.
      </p>
      <div className="coop-settings-actions mt-3">
        <a
          className="coop-settings-action-btn"
          href={`${adminBase}/indexing`}
          target="_blank"
          rel="noreferrer"
        >
          Manage indexing in admin portal
        </a>
      </div>
    </SettingsSection>
  );
}

function AccountDetail({
  prefs,
  onUpdate,
  apiKeyDraft,
  onApiKeyDraftChange,
  onSaveApiKey,
  onCopyApiKey,
  onRevealApiKey,
  onApiKeyBlurCommit,
  onSignInSso,
  onSignInPassword,
  onSignInGoogle,
  onForgotPassword,
  onSignOut,
  onTestConnection,
  connectionTestMessage,
  connectionTestOk,
  savedFlashKey,
  pendingTest,
  testResult
}: SettingsDetailProps): React.ReactElement {
  const signedIn = preferencesSignedIn(prefs);
  const [urlDraft, setUrlDraft] = useState(prefs.apiBaseUrl);
  const [urlDirty, setUrlDirty] = useState(false);
  const [urlSaved, setUrlSaved] = useState(false);
  const [ssoOrgDraft, setSsoOrgDraft] = useState(prefs.orgName ?? "");
  const [emailDraft, setEmailDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [automationOpen, setAutomationOpen] = useState(false);
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

  const europeanTimezoneOptions = useMemo(() => listEuropeanTimezoneOptions(), []);

  const submitPasswordSignIn = () => {
    onSignInPassword(emailDraft.trim(), passwordDraft);
    setPasswordDraft("");
  };

  return (
    <SettingsSection>
      {signedIn ? (
        <>
          <p className="coop-prompt-modal-section-title">Signed in</p>
          <p className="coop-settings-card-desc">
            {displayOrgName(prefs) ? `${displayOrgName(prefs)} · ` : ""}
            {displayPlanLabel(prefs)}
          </p>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="coop-prompt-modal-section-title">Sign in</p>
          <p className="coop-settings-card-desc">Use your Coop account email and password, or continue with Google.</p>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Email</span>
            <input
              type="email"
              autoComplete="username"
              value={emailDraft}
              placeholder="you@company.com"
              className="coop-settings-field"
              onChange={(event) => setEmailDraft(event.target.value)}
            />
          </label>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={passwordDraft}
              className="coop-settings-field"
              onChange={(event) => setPasswordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitPasswordSignIn();
                }
              }}
            />
          </label>
          <div className="coop-settings-actions">
            <button type="button" className="coop-settings-action-btn" onClick={submitPasswordSignIn}>
              Sign in
            </button>
            <button type="button" className="coop-settings-action-btn" onClick={onSignInGoogle}>
              Continue with Google
            </button>
            <button
              type="button"
              className="coop-text-btn"
              onClick={() => onForgotPassword(emailDraft.trim())}
              disabled={!emailDraft.trim()}
            >
              Forgot password?
            </button>
          </div>
        </>
      )}

      <p className="coop-prompt-modal-section-title">Organization SSO</p>
      <p className="coop-settings-card-desc">Enterprise customers can sign in with SAML SSO.</p>
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
      </div>

      <button
        type="button"
        className="coop-result-collapsible-toggle coop-prompt-modal-section-title mt-3 w-full text-left"
        aria-expanded={automationOpen}
        onClick={() => setAutomationOpen((open) => !open)}
      >
        <span className="coop-result-collapsible-chevron" aria-hidden="true">
          {automationOpen ? "▾" : "▸"}
        </span>
        <span className="coop-result-collapsible-title">Automation API key</span>
      </button>
      {automationOpen ? (
        <div className="coop-settings-card-desc">
          <p className="mb-2">
            Optional <code>coop_…</code> key for scripts and CI. Most users should sign in with email or Google above.
          </p>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Coop API key</span>
            <ConfiguredSecretInput
              configured={signedIn && prefs.authMethod === "api_key"}
              value={apiKeyDraft}
              placeholder={
                prefs.devMode ? "Local dev: any value (e.g. dev) then Save" : "coop_… from admin portal API Keys"
              }
              onChange={onApiKeyDraftChange}
              onReveal={signedIn ? onRevealApiKey : undefined}
              onBlurCommit={onApiKeyBlurCommit}
              className="coop-settings-field"
            />
          </label>
          <div className="coop-settings-actions">
            <button
              type="button"
              className="coop-settings-action-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onSaveApiKey}
            >
              Save API key
            </button>
            <button
              type="button"
              className="coop-settings-action-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onCopyApiKey}
              disabled={!signedIn}
            >
              Copy API key
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
        </div>
      ) : null}

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

      <div className="coop-settings-card-desc">
        <p className="coop-prompt-modal-section-title">Timezone</p>
        <label className="coop-settings-field-row">
          <select
            className="coop-settings-field"
            value={resolveTimezonePreference(prefs.timezone)}
            onChange={(event) => onUpdate({ timezone: event.target.value })}
          >
            <optgroup label="United States">
              {US_TIMEZONE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Europe">
              {europeanTimezoneOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      {prefs.devMode ? (
        <>
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
          <p className="coop-settings-card-desc mt-2">
            Internal use only (<code>coopAI.devMode</code>). Production always uses{" "}
            <code>https://api.coop-ai.dev</code>.
          </p>
        </>
      ) : null}
    </SettingsSection>
  );
}

function ToolsListDetail({
  prefs,
  onUpdate,
  onNavigate
}: SettingsDetailProps): React.ReactElement {
  const freePlan = isFreeDeveloperPlan(prefs);
  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        {freePlan
          ? "Connect code hosts and collaboration tools through browser sign-in. Free plan includes the same indexing and search as Pro — AI usage is capped at 80,000 tokens per 5-hour window."
          : "Connect source code and collaboration tools through browser sign-in. Credentials are stored on the Coop server for production use — not pasted into VS Code."}
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

      <p className="coop-prompt-modal-section-title px-0.5 mt-4">Collaboration</p>
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

      <p className="coop-prompt-modal-section-title px-0.5 mt-4">Identity</p>
      <CoopNavList>
        <CoopNavRow
          title="Identity links"
          subtitle={identityLinksHubSubtitle(prefs)}
          configured={prefs.identityDirectory.people.length > 0}
          onClick={() => onNavigate("team")}
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
          connectLabel={connected ? "Manage GitHub connection" : "Connect GitHub"}
          onConnect={onInstallGithubApp}
          onRefresh={onRefreshGithubInstallation}
          refreshKey="github"
          pendingRefresh={pendingRefresh}
          refreshResult={refreshResult}
          onTest={onTestCodeHost ? () => onTestCodeHost("github") : undefined}
          testKey="github"
          testLabel="Test GitHub"
          pendingTest={pendingTest}
          testResult={testResult}
          footer={
            !connected ? (
              <p className="coop-settings-card-desc coop-prompt-modal-muted">
                Organization credentials are stored on the Coop server, not in VS Code.
              </p>
            ) : undefined
          }
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
  onInstallTeamsApp,
  onRefreshTeamsInstallation,
  savedFlashKey,
  pendingTest,
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="teams"
        prefs={prefs}
        description="Search Teams channel messages for Trace Decision. Requires a work or school Microsoft 365 tenant with Teams channels (not personal Teams)."
        onConnect={onInstallTeamsApp}
        onRefresh={onRefreshTeamsInstallation}
        onTest={() => onTestIntegration("teams")}
        testKey="teams"
        pendingTest={pendingTest}
        testResult={testResult}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
        devFallback={
          <>
            <p className="coop-prompt-modal-section-title">Developer fallback (token)</p>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">
                Microsoft Graph access token {prefs.hasTeamsToken ? "(configured)" : ""}
              </span>
              <ConfiguredSecretInput
                configured={prefs.hasTeamsToken}
                value={teamsTokenDraft}
                placeholder="Graph token with ChannelMessage.Read.All"
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
            <p className="coop-settings-card-desc coop-prompt-modal-muted">
              Internal use only (`coopAI.devMode`). Production users connect Microsoft Teams in the browser above.
            </p>
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
  onInstallNotionApp,
  onRefreshNotionInstallation,
  savedFlashKey,
  pendingTest,
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="notion"
        prefs={prefs}
        description="Search Notion pages for documentation context in chat and Knowledge Gaps."
        onConnect={onInstallNotionApp}
        onRefresh={onRefreshNotionInstallation}
        onTest={() => onTestIntegration("notion")}
        testKey="notion"
        pendingTest={pendingTest}
        testResult={testResult}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
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
  onInstallGoogleDocsApp,
  onRefreshGoogleDocsInstallation,
  savedFlashKey,
  pendingTest,
  testResult,
  pendingRefresh,
  refreshResult
}: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationConnectionShell
        provider="google-docs"
        prefs={prefs}
        description="Search Google Docs for documentation context in chat."
        onConnect={onInstallGoogleDocsApp}
        onRefresh={onRefreshGoogleDocsInstallation}
        onTest={() => onTestIntegration("google-docs")}
        testKey="google-docs"
        pendingTest={pendingTest}
        testResult={testResult}
        pendingRefresh={pendingRefresh}
        refreshResult={refreshResult}
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

function WorkspaceDetail({
  prefs,
  onUpdate,
  collections,
  collectionsError,
  onRequestCollections,
  onLoadWorkspaceRepos,
  onSaveWorkspaceRepos,
  workspacePickerState
}: SettingsDetailProps): React.ReactElement {
  const [draft, setDraft] = useState({ owner: prefs.owner, repo: prefs.repo, branch: prefs.branch });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const workspaceSavePendingRef = useRef(false);
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

  useEffect(() => {
    onRequestCollections();
  }, [onRequestCollections]);

  useEffect(() => {
    if (!workspaceSavePendingRef.current || workspacePickerState.saving) {
      return;
    }
    if (workspacePickerState.error) {
      workspaceSavePendingRef.current = false;
      return;
    }
    if (!workspacePickerState.loading) {
      workspaceSavePendingRef.current = false;
      setWorkspacePickerOpen(false);
    }
  }, [
    workspacePickerState.saving,
    workspacePickerState.loading,
    workspacePickerState.error,
    workspacePickerState.selectedCount
  ]);

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

  const workspaceRepos = useMemo(() => {
    if (prefs.workspaceRepoIds && prefs.workspaceRepoIds.length > 0) {
      return prefs.workspaceRepoIds.map((repoId) => {
        const match = workspacePickerState.repos.find((repo) => repo.repoId === repoId);
        return {
          repoId,
          label: match ? `${match.owner}/${match.name}` : repoId.replace(/^github:/, "")
        };
      });
    }
    if (draft.owner && draft.repo) {
      return [{ repoId: `${draft.owner}/${draft.repo}`, label: `${draft.owner}/${draft.repo}` }];
    }
    return [];
  }, [prefs.workspaceRepoIds, workspacePickerState.repos, draft.owner, draft.repo]);

  const workspaceCountLabel =
    prefs.workspaceRepoLimit != null
      ? `${prefs.workspaceRepoCount ?? prefs.workspaceRepoIds?.length ?? 0} / ${prefs.workspaceRepoLimit} repos`
      : undefined;

  return (
    <>
      <SettingsSection title="Workspace repos">
        <p className="coop-settings-card-desc">
          {prefs.adminControlledRepos
            ? prefs.repoAccessMode === "per_user"
              ? "Your org admin assigned which Deep-Indexed repos you can use. Coop-Search and the folder picker are limited to those repos."
              : "Your org admin controls which repositories are Deep-Indexed. You can use every indexed repo your organization has authorized."
            : "Choose up to 3 indexed repos to work in. Coop-Search and the folder picker use these repos. Your first selection is the primary repo for Trace Decision."}
        </p>
        {isFreeDeveloperPlan(prefs) ? (
          <p className="coop-settings-card-desc mt-2">
            Free plan includes the same indexing and search as Pro. AI usage is capped at 80,000 tokens per
            5-hour window.
          </p>
        ) : null}
        <div className="coop-settings-card space-y-3">
          <div className="min-w-0">
            {workspaceCountLabel ? (
              <p className="coop-workspace-picker-count mb-2 inline-flex">{workspaceCountLabel}</p>
            ) : null}
            {workspaceRepos.length > 0 ? (
              <div className="coop-indexed-ref-row">
                {workspaceRepos.map((repo) => (
                  <span key={repo.repoId} className="coop-indexed-ref" title={repo.label}>
                    {repo.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="coop-settings-card-desc">No workspace repos selected</p>
            )}
            <p className="coop-settings-card-desc mt-1">
              {draft.branch ? `Primary branch: ${draft.branch}` : "Pick repos from your org indexed catalog."}
            </p>
          </div>
          <div className="coop-settings-actions">
            {prefs.githubNeedsReconnect ? (
              <p className="coop-settings-test-message--error text-[11px]">
                GitHub access expired. Ask your org admin to reconnect GitHub in the admin portal (Integrations → GitHub).
              </p>
            ) : null}
            {prefs.adminControlledRepos ? (
              <p className="coop-prompt-modal-muted text-[11px]">
                Repository access is managed by your organization admin.
              </p>
            ) : prefs.hasGitHubAppInstalled ? (
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={() => {
                  setWorkspacePickerOpen(true);
                  onLoadWorkspaceRepos();
                }}
              >
                Choose workspace repos
              </button>
            ) : prefs.githubNeedsReconnect ? (
              <p className="coop-prompt-modal-muted text-[11px]">Re-authorize GitHub first, then return here.</p>
            ) : (
              <p className="coop-prompt-modal-muted text-[11px]">
                Connect GitHub in the admin portal to browse indexed repositories.
              </p>
            )}
          </div>
          {workspacePickerState.error && !workspacePickerOpen ? (
            <p className="coop-settings-test-message--error mt-2 text-[11px]">{workspacePickerState.error}</p>
          ) : null}
        </div>
        <label className="coop-settings-field-row mt-3">
          <span className="coop-settings-label">Primary branch</span>
          <input
            type="text"
            value={draft.branch}
            onChange={(e) => update({ branch: e.target.value })}
            className="coop-settings-field"
            placeholder="main"
          />
        </label>
        <div className="coop-settings-actions">
          <button type="button" className="coop-settings-action-btn" onClick={handleSave} disabled={!dirty}>
            Save branch
          </button>
          <SaveFlashLabel show={saved} />
        </div>
      </SettingsSection>

      <WorkspaceReposPickerModal
        open={workspacePickerOpen}
        title="Choose workspace repos"
        subtitle="Select up to 3 indexed repos from your organization catalog."
        repos={workspacePickerState.repos}
        selectedRepoIds={workspacePickerState.selectedRepoIds}
        limit={workspacePickerState.limit ?? prefs.workspaceRepoLimit ?? 3}
        loading={workspacePickerState.loading}
        saving={workspacePickerState.saving}
        error={workspacePickerState.error}
        onClose={() => setWorkspacePickerOpen(false)}
        onRefresh={onLoadWorkspaceRepos}
        onSave={(repoIds) => {
          workspaceSavePendingRef.current = true;
          onSaveWorkspaceRepos(repoIds);
        }}
      />

      <SettingsSection title="Search scope">
        <p className="coop-settings-card-desc">
          Controls Coop-Search and the chat @ file picker — active repo, your workspace repos
          {isFreeDeveloperPlan(prefs) ? "" : ", or a collection"}.
          @ mentions search Deep-Indexed repos and your local VS Code workspace folders.
        </p>
        <label className="coop-settings-field-row">
          <span className="coop-settings-label">Scope</span>
          <select
            className="coop-settings-field"
            value={prefs.searchScopeMode}
            onChange={(event) => {
              const value = event.target.value;
              const mode =
                value === "collection"
                  ? "collection"
                  : value === "indexed"
                    ? "indexed"
                    : value === "org"
                      ? "org"
                      : "repo";
              onUpdate({ searchScopeMode: mode });
            }}
          >
            <option value="repo">Active repo</option>
            {prefs.plan === "enterprise" ? (
              <option value="org">All Deep-Indexed Repos (org)</option>
            ) : (
              <option value="indexed">Workspace repos</option>
            )}
            {!isFreeDeveloperPlan(prefs) ? (
              <option value="collection">Collection (advanced)</option>
            ) : null}
          </select>
        </label>
        {!isFreeDeveloperPlan(prefs) && prefs.searchScopeMode === "collection" ? (
          <>
            <label className="coop-settings-field-row">
              <span className="coop-settings-label">Collection</span>
              <select
                className="coop-settings-field"
                value={prefs.searchCollectionId}
                onChange={(event) => onUpdate({ searchCollectionId: event.target.value })}
              >
                <option value="">Select a collection…</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name} ({collection.repoCount} repos)
                  </option>
                ))}
              </select>
            </label>
            {!collectionsError && collections.length === 0 ? (
              <p className="coop-settings-card-desc text-xs">
                No collections for {prefs.orgName ? `"${prefs.orgName}"` : "this org"}. Create one in
                the admin portal (Collections), then{" "}
                <button type="button" className="coop-text-btn" onClick={() => onRequestCollections()}>
                  refresh
                </button>
                . Use the same Coop API key in Account as you use to sign into admin.
              </p>
            ) : null}
          </>
        ) : null}
        {collectionsError ? (
          <p className="coop-settings-test-message--error text-xs">{collectionsError}</p>
        ) : null}
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

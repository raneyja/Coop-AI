import React, { useEffect, useRef, useState } from "react";
import {
  assignedModelsHubSubtitle,
  COOP_FEATURE_MODEL_ASSIGNMENTS,
  formatAssignedModelMeta,
  type CoopFeatureId
} from "../../../config/featureModelAssignments";
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
import { AgentsMdTemplateGuide } from "../AgentsMdTemplateGuide";
import { agentsMdAttached } from "../../lib/agentsMdStatus";
import { codeHostConfigured, identityLinksHubSubtitle, integrationConfigured } from "./subtitles";
import { IntegrationStatusCard, MemberAdminPortalLink } from "./IntegrationStatusCard";
import {
  memberToolStatusMeta,
  memberToolsReadOnly,
  resolveMemberToolStatus
} from "./integrationStatus";
import {
  codeHostDisplayName
} from "./connectionCopy";
import type { OrgIntegrationProvider } from "../../../chat/integrationStatusTypes";

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
  onAttachAgentsMd: () => void;
  onOpenAgentsMd: () => void;
  onStartFromAgentsMdTemplate: () => void;
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
      return (
        <IdentityLinksDetail
          directory={props.prefs.identityDirectory}
          signedIn={Boolean(props.prefs.isSignedIn ?? props.prefs.hasApiKey)}
        />
      );
    case "preferences":
      return <PreferencesListDetail {...props} />;
    case "prompts":
      return <PromptsDetail {...props} />;
    default:
      return <div />;
  }
}

function assignmentFeatureEnabled(
  feature: CoopFeatureId,
  draft: { llmEnabled: boolean; autocompleteEnabled: boolean }
): boolean {
  return feature === "autocomplete" ? draft.autocompleteEnabled : draft.llmEnabled;
}

function AssignedModelRow({
  label,
  meta,
  enabled,
  note
}: {
  label: string;
  meta: string;
  enabled: boolean;
  note?: string;
}): React.ReactElement {
  return (
    <div className="coop-health-integration">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="coop-health-integration-name">{label}</div>
          <div className="coop-health-integration-meta">{meta}</div>
          {note ? <div className="coop-health-integration-meta mt-1">{note}</div> : null}
        </div>
        <span
          className={`coop-health-status shrink-0 ${enabled ? "coop-health-status--healthy" : "coop-health-status--offline"}`}
        >
          {enabled ? "On" : "Off"}
        </span>
      </div>
    </div>
  );
}

function ModelDetail({
  prefs,
  onUpdate,
  onClearChat
}: SettingsDetailProps): React.ReactElement {
  const [draft, setDraft] = useState({
    llmEnabled: prefs.llmEnabled,
    autocompleteEnabled: prefs.autocompleteEnabled
  });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!dirty) {
      setDraft({
        llmEnabled: prefs.llmEnabled,
        autocompleteEnabled: prefs.autocompleteEnabled
      });
    }
  }, [prefs.llmEnabled, prefs.autocompleteEnabled, dirty]);

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
    onUpdate({
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
        <p className="coop-settings-card-desc px-0.5">
          Models are assigned by Coop for chat, quick actions, and edit mode. Custom model selection is an
          Enterprise capability (coming soon).
        </p>

        <div className="space-y-2">
          {COOP_FEATURE_MODEL_ASSIGNMENTS.map((assignment) => (
            <AssignedModelRow
              key={assignment.feature}
              label={assignment.label}
              meta={formatAssignedModelMeta(assignment)}
              note={assignment.note}
              enabled={assignmentFeatureEnabled(assignment.feature, draft)}
            />
          ))}
        </div>

        <SettingsCheckboxRow
          title="Enable live LLM chat"
          checked={draft.llmEnabled}
          onChange={(checked) => update({ llmEnabled: checked })}
        />
        <SettingsCheckboxRow
          title="Enable inline autocomplete"
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

function GoogleMark(): React.ReactElement {
  return (
    <svg className="coop-auth-google-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AuthDivider(): React.ReactElement {
  return (
    <div className="coop-auth-divider" role="separator">
      <span className="coop-auth-divider-line" aria-hidden="true" />
      <span className="coop-auth-divider-text">or</span>
      <span className="coop-auth-divider-line" aria-hidden="true" />
    </div>
  );
}

type AccountAuthStep = "choose" | "password";

function AccountDetail({
  prefs,
  onSignInSso,
  onSignInPassword,
  onSignInGoogle,
  onForgotPassword,
  onSignOut
}: SettingsDetailProps): React.ReactElement {
  const signedIn = preferencesSignedIn(prefs);
  const [emailDraft, setEmailDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [ssoOrgDraft, setSsoOrgDraft] = useState("");
  const [authStep, setAuthStep] = useState<AccountAuthStep>("choose");

  const trimmedEmail = emailDraft.trim();

  const submitPasswordSignIn = () => {
    onSignInPassword(trimmedEmail, passwordDraft);
    setPasswordDraft("");
  };

  const continueWithEmail = () => {
    if (!trimmedEmail) {
      return;
    }
    setAuthStep("password");
  };

  const backToChoose = () => {
    setAuthStep("choose");
    setPasswordDraft("");
  };

  if (signedIn) {
    return (
      <SettingsSection>
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
      </SettingsSection>
    );
  }

  if (authStep === "password") {
    return (
      <SettingsSection>
        <p className="coop-prompt-modal-section-title">Sign in</p>
        <button type="button" className="coop-text-btn mb-1" onClick={backToChoose}>
          ← Use a different email
        </button>
        <p className="coop-settings-card-desc">{trimmedEmail}</p>
        <label className="coop-settings-field-row mt-3">
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
        <div className="coop-auth-stack mt-3">
          <button type="button" className="coop-auth-btn coop-auth-btn--primary" onClick={submitPasswordSignIn}>
            Sign in
          </button>
          <button type="button" className="coop-text-btn self-center" onClick={() => onForgotPassword(trimmedEmail)}>
            Forgot password?
          </button>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection>
      <p className="coop-prompt-modal-section-title">Sign in</p>
      <p className="coop-settings-card-desc">Continue to your Coop account.</p>

      <div className="coop-auth-stack mt-3">
        <button type="button" className="coop-auth-btn" onClick={onSignInGoogle}>
          <GoogleMark />
          Continue with Google
        </button>
      </div>

      <AuthDivider />

      <label className="coop-settings-field-row">
        <span className="coop-settings-label">Email address</span>
        <input
          type="email"
          autoComplete="username"
          value={emailDraft}
          placeholder="Email address"
          className="coop-settings-field"
          onChange={(event) => setEmailDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              continueWithEmail();
            }
          }}
        />
      </label>
      <div className="coop-auth-stack mt-2">
        <button
          type="button"
          className="coop-auth-btn coop-auth-btn--primary"
          onClick={continueWithEmail}
          disabled={!trimmedEmail}
        >
          Continue with email
        </button>
      </div>

      <AuthDivider />

      <label className="coop-settings-field-row">
        <span className="coop-settings-label">Organization name</span>
        <input
          type="text"
          autoComplete="organization"
          value={ssoOrgDraft}
          placeholder="Acme Engineering"
          className="coop-settings-field"
          onChange={(event) => setSsoOrgDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ssoOrgDraft.trim()) {
              onSignInSso(ssoOrgDraft.trim());
            }
          }}
        />
      </label>
      <div className="coop-auth-stack mt-2">
        <button
          type="button"
          className="coop-auth-btn"
          onClick={() => onSignInSso(ssoOrgDraft.trim() || undefined)}
        >
          Sign in with SSO
        </button>
      </div>

      <p className="coop-settings-card-desc mt-3">
        LLM provider keys are routed server-side; code host tokens stay in VS Code SecretStorage.
      </p>
    </SettingsSection>
  );
}

function MemberToolDetail({
  prefs,
  provider,
  name,
  description
}: {
  prefs: Preferences;
  provider: OrgIntegrationProvider;
  name: string;
  description: string;
}): React.ReactElement {
  return (
    <SettingsSection>
      <IntegrationStatusCard
        name={name}
        meta={memberToolStatusMeta(prefs, provider)}
        status={resolveMemberToolStatus(prefs, provider)}
        description={description}
      />
      <MemberAdminPortalLink prefs={prefs} />
    </SettingsSection>
  );
}

function ToolsListDetail({
  prefs,
  onNavigate
}: SettingsDetailProps): React.ReactElement {
  if (memberToolsReadOnly(prefs)) {
    return <MemberToolsListDetail prefs={prefs} />;
  }
  const freePlan = isFreeDeveloperPlan(prefs);
  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        {freePlan
          ? "Connect code hosts and collaboration tools through browser sign-in. Free plan includes the same indexing and search as Pro — AI usage is capped at 80,000 tokens per 5-hour window."
          : "Connect source code and collaboration tools through browser sign-in. Credentials are stored on the Coop server for production use — not pasted into VS Code."}
      </p>

      <p className="coop-prompt-modal-section-title px-0.5">Source code</p>
      <p className="coop-settings-card-desc px-0.5">
        Every connected code host is active. Connect one or more below to use their repos in chat.
      </p>
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
    </>
  );
}

function MemberToolsListDetail({ prefs }: { prefs: Preferences }): React.ReactElement {
  const codeHosts: CodeHostProviderPreference[] = ["github", "gitlab", "bitbucket"];
  const collaborationProviders: Array<{ provider: OrgIntegrationProvider; name: string; description: string }> = [
    { provider: "slack", name: "Slack", description: "Search Slack threads and check teammate availability." },
    { provider: "atlassian", name: "Jira & Confluence", description: "Link Jira tickets and search Confluence pages in chat." },
    { provider: "teams", name: "Microsoft Teams", description: "Search Teams channel messages for Trace Decision." },
    { provider: "notion", name: "Notion", description: "Search Notion pages for documentation context." },
    { provider: "google-docs", name: "Google Docs", description: "Search Google Docs for documentation context." }
  ];

  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        Your organization admin connects source code and collaboration tools in the admin portal. Status below
        reflects what is available to you in chat.
      </p>

      <p className="coop-prompt-modal-section-title px-0.5">Source code</p>
      <p className="coop-settings-card-desc px-0.5">
        Every code host your admin connects is active. Repos from all connected hosts are available in chat.
      </p>
      <SettingsSection>
        <div className="space-y-3">
          {codeHosts.map((provider) => (
            <IntegrationStatusCard
              key={provider}
              name={codeHostDisplayName(provider)}
              meta={memberToolStatusMeta(prefs, provider)}
              status={resolveMemberToolStatus(prefs, provider)}
            />
          ))}
        </div>
      </SettingsSection>

      <p className="coop-prompt-modal-section-title px-0.5 mt-4">Collaboration</p>
      <SettingsSection>
        <div className="space-y-3">
          {collaborationProviders.map((tool) => (
            <IntegrationStatusCard
              key={tool.provider}
              name={tool.name}
              meta={memberToolStatusMeta(prefs, tool.provider)}
              status={resolveMemberToolStatus(prefs, tool.provider)}
              description={tool.description}
            />
          ))}
        </div>
      </SettingsSection>

      <MemberAdminPortalLink prefs={prefs} />
    </>
  );
}

function PreferencesListDetail({ prefs, promptLibrary, onNavigate, onUpdate }: SettingsDetailProps): React.ReactElement {
  const pinned = promptLibrary.pinnedIds.length;
  const europeanTimezoneOptions = useMemo(() => listEuropeanTimezoneOptions(), []);
  const timezoneId = resolveTimezonePreference(prefs.timezone);
  const timezoneLabel =
    US_TIMEZONE_OPTIONS.find((option) => option.id === timezoneId)?.label ??
    europeanTimezoneOptions.find((option) => option.id === timezoneId)?.label ??
    timezoneId;

  return (
    <>
      <p className="coop-settings-card-desc px-0.5">
        Model defaults, profile links, timezone, and your quick prompt library.
      </p>
      <CoopNavList>
        <CoopNavRow
          title="Model & chat"
          subtitle={assignedModelsHubSubtitle({
            llmEnabled: prefs.llmEnabled,
            autocompleteEnabled: prefs.autocompleteEnabled
          })}
          onClick={() => onNavigate("model")}
        />
        <CoopNavRow
          title="Prompt library"
          subtitle={pinned === 0 ? "No quick prompts pinned" : pinned === 1 ? "1 quick prompt pinned" : `${pinned} quick prompts pinned`}
          onClick={() => onNavigate("prompts")}
        />
        <CoopNavRow
          title="Identity links"
          subtitle={identityLinksHubSubtitle(prefs)}
          configured={prefs.identityDirectory.people.length > 0}
          onClick={() => onNavigate("team")}
        />
      </CoopNavList>

      <div className="mt-4">
        <SettingsSection title="Timezone">
          <p className="coop-settings-card-desc">Used for quota reset times and scheduling context in chat.</p>
          <label className="coop-settings-field-row">
            <span className="coop-settings-label">Timezone ({timezoneLabel})</span>
            <select
              className="coop-settings-field"
              value={timezoneId}
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
        </SettingsSection>
      </div>
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="github"
        name="GitHub"
        description="Repositories are connected through the Coop GitHub App by your organization admin."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="gitlab"
        name="GitLab"
        description="Repositories are connected through the Coop GitLab OAuth app by your organization admin."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="bitbucket"
        name="Bitbucket"
        description="Repositories are connected through the Coop Bitbucket OAuth app by your organization admin."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="slack"
        name="Slack"
        description="Search Slack threads and check teammate availability for Find Owner and Trace Decision."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="atlassian"
        name="Jira"
        description="Link Jira tickets to Trace Decision and surface repo-related work in chat."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="teams"
        name="Microsoft Teams"
        description="Search Teams channel messages for Trace Decision."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="atlassian"
        name="Confluence"
        description="Search Confluence pages for Knowledge Gaps and documentation context in chat."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="notion"
        name="Notion"
        description="Search Notion pages for documentation context in chat and Knowledge Gaps."
      />
    );
  }
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
  if (memberToolsReadOnly(prefs)) {
    return (
      <MemberToolDetail
        prefs={prefs}
        provider="google-docs"
        name="Google Docs"
        description="Search Google Docs for documentation context in chat."
      />
    );
  }
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
  workspacePickerState,
  onAttachAgentsMd,
  onOpenAgentsMd,
  onStartFromAgentsMdTemplate
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
      <SettingsSection title="AGENTS.md">
        <div className="coop-settings-card space-y-2">
          {prefs.projectInstructions?.status === "disabled" ? (
            <p className="coop-settings-card-desc">
              Disabled in VS Code settings (<span className="font-medium">coopAI.projectInstructions.enabled</span>).
            </p>
          ) : (
            <>
              <div className="coop-agents-md-settings-row">
                {agentsMdAttached(prefs.projectInstructions) ? (
                  <button
                    type="button"
                    className="coop-agents-md-chip coop-agents-md-chip--attached coop-agents-md-chip--clickable"
                    onClick={onOpenAgentsMd}
                    aria-label="Open AGENTS.md"
                  >
                    <span className="coop-agents-md-chip-icon" aria-hidden="true">
                      ✓
                    </span>
                    AGENTS.md
                  </button>
                ) : (
                  <span className="coop-agents-md-chip coop-agents-md-chip--missing coop-agents-md-chip--static">
                    <span className="coop-agents-md-chip-icon" aria-hidden="true">
                      ✕
                    </span>
                    AGENTS.md
                  </span>
                )}
                {agentsMdAttached(prefs.projectInstructions) ? (
                  <button type="button" className="coop-settings-action-btn ml-auto" onClick={onAttachAgentsMd}>
                    Upload AGENTS.md
                  </button>
                ) : (
                  <button
                    type="button"
                    className="coop-settings-action-btn ml-auto"
                    onClick={onStartFromAgentsMdTemplate}
                  >
                    Create AGENTS.md
                  </button>
                )}
              </div>
              {!agentsMdAttached(prefs.projectInstructions) ? (
                <button type="button" className="coop-agents-md-guide-link" onClick={onAttachAgentsMd}>
                  Upload AGENTS.md
                </button>
              ) : null}
              <p className="coop-settings-card-desc !mb-0">Loaded on every message.</p>
              <AgentsMdTemplateGuide className="mt-1" />
            </>
          )}
        </div>
      </SettingsSection>
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
                . Sign in with your Coop account in Account settings to load collections.
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

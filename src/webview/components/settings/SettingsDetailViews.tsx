import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  formatFreeAllowanceCopy,
  formatPaidUsageResetParts,
  isFreeQuotaExhausted,
  type PaidUsageResetParts
} from "../../../chat/quotaNotice";
import {
  assignedModelsHubSubtitle,
  COOP_FEATURE_MODEL_ASSIGNMENTS,
  formatAssignedModelDisplay
} from "../../../config/featureModelAssignments";
import {
  getModelDocsUrl,
  listPickerCatalogModels,
  PICKER_PROVIDER_GROUPS
} from "../../../config/llmModels";
import {
  USAGE_METER_BASE_LABEL,
  USAGE_METER_FRONTIER_LABEL,
  USAGE_METER_HELPER,
  USAGE_METER_PICKER_HINT
} from "../../../config/usageMeterCopy";
import { listEuropeanTimezoneOptions, resolveTimezonePreference, US_TIMEZONE_OPTIONS } from "../../../chat/timezone";
import { type SettingsTestKey } from "../TestButton";
import { SaveFlashLabel, type SettingsSaveKey } from "../SaveFlashLabel";
import { PromptLibraryTop5Editor } from "../PromptLibraryTop5Editor";
import type { PromptLibraryItem } from "../promptLibraryTypes";
import type { CodeHostProviderPreference, IntegrationChatProvider, LlmProviderPreference } from "../../../chat/types";
import { isTeamsComingSoon } from "../../../integrations/teamsAvailability";
import type { Preferences, SettingsDetailScreen } from "./types";
import { nextAutocompleteDraft } from "./autocompleteDraft";
import { ConnectionCard } from "./ConnectionCard";
import { IntegrationConnectionShell } from "./IntegrationConnectionShell";
import {
  codeHostConnectionMeta,
  codeHostDisplayName,
  codeHostListSubtitle,
  accountDetailIdentity,
  displayOrgName,
  displayPlanLabel,
  integrationListSubtitle,
  incomingSeatUpgradeCopy,
  planAdminPortalHref,
  planSeatUpgradeCta,
  indexingPlanCapLabel,
  preferencesSignedIn,
  quotaUsedPercent
} from "./connectionCopy";
import {
  ownSeatConvertCopy,
  SEAT_CONVERT_TIMEOUT_MESSAGE,
  SEAT_CONVERT_TIMEOUT_MS,
  seatConvertErrorCopy,
  seatConvertProcessingCopy,
  seatConvertSuccessCopy
} from "../../../server/usageTiers";
import { CoopNotice } from "../CoopNotice";
import type { SettingsLightningSummary } from "./SettingsHub";
import { SettingsCheckboxRow, SettingsSection } from "./SettingsShared";
import type { GithubRepoOption } from "../../../chat/types";
import { CoopNavList, CoopNavRow } from "../CoopNavRow";
import { AgentsMdTemplateGuide } from "../AgentsMdTemplateGuide";
import { agentsMdAttached, canDetachAgentsMd, shouldPromptForAgentsMd } from "../../lib/agentsMdStatus";
import {
  codeHostConfigured,
  integrationConfigured
} from "./subtitles";
import { IntegrationStatusCard, MemberAdminPortalLink } from "./IntegrationStatusCard";
import {
  memberToolStatusMeta,
  memberToolsReadOnly,
  resolveMemberToolStatus
} from "./integrationStatus";
import type { OrgIntegrationProvider } from "../../../chat/integrationStatusTypes";
import { DEMO_PAGE_URL } from "../../../config/siteConfig";
import { SignInForm } from "../SignInForm";

function isFreeDeveloperPlan(prefs: Preferences): boolean {
  return prefs.plan === "free";
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
  onDetachAgentsMd?: () => void;
  onRequestSeatUpgrade?: (usageTier: "pro_plus" | "max") => void;
  onConvertOwnSeat?: (usageTier: "pro_plus" | "max") => void;
  onUpgradeToPro?: () => void;
  upgradeToProError?: string | null;
  upgradeToProPhase?: "idle" | "confirming" | "success" | "timeout" | "error";
  seatConvertResult?: { ok: boolean; message: string } | null;
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
    case "preferences":
      return <PreferencesListDetail {...props} />;
    case "agents-md":
      return <AgentsMdSettings {...props} />;
    case "context":
      return <ContextSettings prefs={props.prefs} onUpdate={props.onUpdate} />;
    case "prompts":
      return <PromptsDetail {...props} />;
    default:
      return <div />;
  }
}

function ModelDocsLink({
  model,
  label,
  chip
}: {
  model: string;
  label: string;
  chip?: boolean;
}): React.ReactElement {
  const href = getModelDocsUrl(model);
  const className = chip ? "coop-settings-model-chip" : "coop-settings-docs-link";
  if (!href) {
    return chip ? <span className="coop-settings-model-chip">{label}</span> : <>{label}</>;
  }
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" title={`Open ${label} docs`}>
      {label}
    </a>
  );
}

function ModelDetail({
  prefs,
  onUpdate,
  onClearChat
}: SettingsDetailProps): React.ReactElement {
  const [draft, setDraft] = useState({
    autocompleteEnabled: prefs.autocompleteEnabled
  });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const pendingSavedRef = useRef<boolean | null>(null);
  const pickerCatalog = listPickerCatalogModels();

  useEffect(() => {
    const next = nextAutocompleteDraft(
      prefs.autocompleteEnabled,
      dirty,
      pendingSavedRef.current
    );
    if (next === "keep") {
      return;
    }
    if (pendingSavedRef.current !== null && next === pendingSavedRef.current) {
      pendingSavedRef.current = null;
    }
    setDraft({ autocompleteEnabled: next });
  }, [prefs.autocompleteEnabled, dirty]);

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
    pendingSavedRef.current = draft.autocompleteEnabled;
    onUpdate({
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
      <SettingsSection
        title="Auto"
        description="Coop picks a model for each job — faster for everyday chat, stronger for /edit. On Pro, choose a specific model from the menu in chat."
      >
        <ul className="coop-settings-model-list">
          {COOP_FEATURE_MODEL_ASSIGNMENTS.map((assignment) => (
            <li key={assignment.feature}>
              <span className="coop-settings-model-list-feature">{assignment.label}</span>
              <ModelDocsLink chip model={assignment.model} label={formatAssignedModelDisplay(assignment)} />
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection
        title="Models you can pick"
        description={USAGE_METER_PICKER_HINT}
      >
        <div className="coop-settings-maker-stack">
          {PICKER_PROVIDER_GROUPS.map((group) => {
            const models = pickerCatalog.filter((entry) => entry.provider === group.provider);
            if (models.length === 0) {
              return null;
            }
            return (
              <div key={group.provider} className="coop-settings-maker-block">
                <a
                  className="coop-settings-maker-heading"
                  href={group.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${group.label} docs`}
                >
                  {group.label}
                </a>
                <div className="coop-settings-maker-models">
                  {models.map((entry) => (
                    <ModelDocsLink
                      key={`${entry.provider}:${entry.id}`}
                      chip
                      model={entry.id}
                      label={entry.label}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Autocomplete">
        <SettingsCheckboxRow
          title="Enable inline autocomplete"
          description="Ghost-text suggestions as you type. Autocomplete always uses Codestral."
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

function stackedUsagePercents(autoRatio: number, frontierRatio: number): { auto: number; frontier: number } {
  const auto = Math.max(0, autoRatio) * 100;
  const frontier = Math.max(0, frontierRatio) * 100;
  const total = auto + frontier;
  if (total <= 100) {
    return { auto, frontier };
  }
  const scale = 100 / total;
  return { auto: auto * scale, frontier: frontier * scale };
}

function monthlyUsageBar(
  autoRatio: number,
  frontierRatio: number,
  usedRatio: number,
  resetParts: PaidUsageResetParts | null
): React.ReactElement {
  const pct = Math.max(0, Math.min(100, Math.round(usedRatio * 100)));
  const segments = stackedUsagePercents(autoRatio, frontierRatio);
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="coop-prompt-modal-section-title">Monthly usage</p>
        <p className="text-[11px] text-[var(--coop-panel-muted)]">{pct}% used</p>
      </div>
      <div
        className="coop-usage-track"
        role="img"
        aria-label={`${pct}% of monthly usage used`}
      >
        {segments.auto > 0 ? (
          <div className="coop-usage-seg coop-usage-seg--auto" style={{ width: `${segments.auto}%` }} />
        ) : null}
        {segments.frontier > 0 ? (
          <div className="coop-usage-seg coop-usage-seg--frontier" style={{ width: `${segments.frontier}%` }} />
        ) : null}
      </div>
      <div className="coop-usage-legend">
        <span>
          <span className="coop-usage-swatch coop-usage-swatch--auto" aria-hidden />
          {USAGE_METER_BASE_LABEL}
        </span>
        <span>
          <span className="coop-usage-swatch coop-usage-swatch--frontier" aria-hidden />
          {USAGE_METER_FRONTIER_LABEL}
        </span>
      </div>
      <p className="coop-settings-card-desc mt-1">{USAGE_METER_HELPER}</p>
      {resetParts ? (
        <p className="mt-2 text-[13px]">
          Resets on <span className="font-medium">{resetParts.dateLabel}</span>
          <span className="text-[var(--coop-panel-muted)]"> ({resetParts.countdown})</span>
        </p>
      ) : null}
    </div>
  );
}

function FreePlanUsageMeter({
  quota,
  timezone
}: {
  quota: NonNullable<Preferences["quotaCredits"]>;
  timezone?: string;
}): React.ReactElement {
  const exhausted = isFreeQuotaExhausted(quota);
  const pct = quotaUsedPercent(quota.usedRatio ?? 0, 1);
  const caption = exhausted
    ? formatFreeAllowanceCopy({
        resetsAt: quota.resetsAt,
        blockedWindow: quota.blockedWindow,
        timezone
      })
    : "";

  return (
    <>
      <div
        className="coop-usage-track !mt-0"
        role="img"
        aria-label="Free allowance used"
      >
        {pct > 0 ? (
          <div className="coop-usage-seg coop-usage-seg--auto" style={{ width: `${pct}%` }} />
        ) : null}
      </div>
      {caption ? (
        <p className="text-[11px] text-[var(--coop-panel-muted)]" aria-live="polite">
          {caption}
        </p>
      ) : null}
    </>
  );
}

function PlanUsageDetail({
  prefs,
  onRequestSeatUpgrade,
  onConvertOwnSeat,
  onUpgradeToPro,
  upgradeToProError,
  upgradeToProPhase = "idle",
  seatConvertResult
}: SettingsDetailProps): React.ReactElement {
  const orgName = displayOrgName(prefs);
  const adminHref = planAdminPortalHref(prefs);
  const meters = prefs.usageMeters;
  const resetParts = formatPaidUsageResetParts(meters?.periodEnd);
  const upgradeCta = planSeatUpgradeCta(prefs);
  const incomingCopy = incomingSeatUpgradeCopy(prefs);
  const [convertPhase, setConvertPhase] = useState<"idle" | "confirm" | "processing" | "success" | "error">(
    "idle"
  );
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertNames, setConvertNames] = useState<{ fromName: string; toName: string } | null>(null);
  const appliedConvertResult = useRef(seatConvertResult);

  const closeConvertFlow = () => {
    if (convertPhase === "processing") {
      return;
    }
    setConvertPhase("idle");
    setConvertError(null);
  };

  const startConvertCharge = () => {
    if (upgradeCta.kind !== "admin-convert") {
      return;
    }
    setConvertError(null);
    setConvertNames({ fromName: displayPlanLabel(prefs), toName: upgradeCta.nextLabel });
    setConvertPhase("processing");
    onConvertOwnSeat?.(upgradeCta.nextTier);
  };

  useEffect(() => {
    if (!seatConvertResult || seatConvertResult === appliedConvertResult.current) {
      return;
    }
    appliedConvertResult.current = seatConvertResult;
    if (seatConvertResult.ok) {
      setConvertPhase("success");
      setConvertError(null);
      return;
    }
    setConvertPhase("error");
    setConvertError(seatConvertResult.message);
  }, [seatConvertResult]);

  useEffect(() => {
    if (convertPhase !== "processing") {
      return;
    }
    const timer = window.setTimeout(() => {
      if (convertPhase !== "processing") {
        return;
      }
      setConvertError(SEAT_CONVERT_TIMEOUT_MESSAGE);
      setConvertPhase("error");
    }, SEAT_CONVERT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [convertPhase]);

  useEffect(() => {
    if (convertPhase === "idle" || convertPhase === "processing") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeConvertFlow();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [convertPhase]);

  if (!preferencesSignedIn(prefs)) {
    return (
      <SettingsSection>
        <p className="coop-settings-card-desc">Sign in under Account to view plan and usage.</p>
      </SettingsSection>
    );
  }

  const convertCopy =
    upgradeCta.kind === "admin-convert"
      ? ownSeatConvertCopy({
          fromName: displayPlanLabel(prefs),
          toName: upgradeCta.nextLabel,
          fromUsd: meters?.seatPriceUsd,
          toUsd: meters?.nextTierPriceUsd
        })
      : null;

  if (convertPhase === "processing" || convertPhase === "success" || convertPhase === "error") {
    const fromName = convertNames?.fromName ?? displayPlanLabel(prefs);
    const toName = convertNames?.toName ?? (upgradeCta.kind === "admin-convert" ? upgradeCta.nextLabel : "Pro+");
    const processing = seatConvertProcessingCopy({ fromName, toName });
    const success = seatConvertSuccessCopy(toName);
    const failed = seatConvertErrorCopy(fromName, convertError ?? SEAT_CONVERT_TIMEOUT_MESSAGE);
    const title =
      convertPhase === "processing" ? processing.title : convertPhase === "success" ? success.title : failed.title;
    const body = convertPhase === "processing" ? processing.body : convertPhase === "success" ? success.body : failed.reason;
    return (
      <SettingsSection>
        <p className="coop-prompt-modal-section-title">Upgrade</p>
        <div
          className="coop-settings-card p-3"
          role={convertPhase === "error" ? "alert" : "status"}
        >
          <p className="text-[15px] font-medium">{title}</p>
          <p className="coop-settings-card-desc mt-2">{body}</p>
          {convertPhase === "processing" ? (
            <p className="coop-prompt-modal-muted mt-3">Working… stay on this screen.</p>
          ) : null}
          {convertPhase === "error" ? (
            <CoopNotice tone="error" compact className="mt-3" message={failed.stay} />
          ) : null}
          {convertPhase === "success" ? (
            <div className="coop-settings-actions mt-3">
              <button type="button" className="coop-settings-action-btn" onClick={closeConvertFlow}>
                {success.doneLabel}
              </button>
            </div>
          ) : null}
          {convertPhase === "error" ? (
            <div className="coop-settings-actions mt-3">
              <button
                type="button"
                className="coop-settings-action-btn coop-settings-action-btn--primary"
                onClick={startConvertCharge}
              >
                {failed.retryLabel}
              </button>
              <button type="button" className="coop-settings-action-btn" onClick={closeConvertFlow}>
                {failed.closeLabel}
              </button>
            </div>
          ) : null}
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection>
      <p className="coop-prompt-modal-section-title">Organization</p>
      <p>{orgName ?? "—"}</p>

      <div className="mt-3 grid gap-2">
        <div className="coop-settings-card p-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--coop-panel-muted)]">Current plan</p>
          <div className="space-y-2">
            <p className="text-[15px] font-medium">
              {displayPlanLabel(prefs)}
              {meters ? ` $${meters.seatPriceUsd}/mo` : ""}
            </p>
            {prefs.plan === "free" && prefs.quotaCredits ? (
              <FreePlanUsageMeter quota={prefs.quotaCredits} timezone={prefs.timezone} />
            ) : resetParts ? (
              <p className="text-[13px]">
                Resets on <span className="font-medium">{resetParts.dateLabel}</span>
                <span className="text-[var(--coop-panel-muted)]"> · {resetParts.countdown}</span>
              </p>
            ) : null}
          </div>
        </div>
        {upgradeCta.kind === "pending" ||
        upgradeCta.kind === "admin-convert" ||
        upgradeCta.kind === "member-request" ? (
          <div className="coop-settings-card p-3">
            <p className="text-[10px] uppercase tracking-wide text-[var(--coop-panel-muted)]">
              {upgradeCta.kind === "pending" ? "Upgrade requested" : "Upgrade this seat"}
            </p>
            {upgradeCta.kind === "pending" ? (
              <p className="coop-settings-card-desc mt-1">
                Request pending for {upgradeCta.toLabel}. Every admin on this org was emailed. Quota stays
                the same until they confirm. The company pays after that.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[15px] font-medium">
                  {upgradeCta.nextLabel}
                  {meters?.nextTierPriceUsd != null ? ` $${meters.nextTierPriceUsd}/mo` : ""}
                </p>
                <p className="coop-settings-card-desc mt-1">
                  This is your seat.{" "}
                  {upgradeCta.kind === "admin-convert"
                    ? "Confirm here to convert it. We'll charge the card on file now — the rest of the team stays on their seats."
                    : "Ask an admin to convert it. They confirm, then the company is charged."}
                </p>
                <div className="coop-settings-actions mt-2">
                  {upgradeCta.kind === "admin-convert" ? (
                    <button
                      type="button"
                      className="coop-settings-action-btn"
                      onClick={() => {
                        setConvertError(null);
                        setConvertNames({
                          fromName: displayPlanLabel(prefs),
                          toName: upgradeCta.nextLabel
                        });
                        setConvertPhase("confirm");
                      }}
                    >
                      Upgrade this seat
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="coop-settings-action-btn"
                      onClick={() => onRequestSeatUpgrade?.(upgradeCta.nextTier)}
                    >
                      Request {upgradeCta.nextLabel}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : prefs.plan === "pro" || prefs.plan === "enterprise" ? (
          <div className="coop-settings-card p-3">
            <p className="text-[10px] uppercase tracking-wide text-[var(--coop-panel-muted)]">Enterprise</p>
            <p className="coop-settings-card-desc mt-1">Need pooled usage or a custom contract? Contact us.</p>
            <div className="coop-settings-actions mt-2">
              <a className="coop-settings-action-btn" href={DEMO_PAGE_URL} target="_blank" rel="noreferrer">
                Contact
              </a>
            </div>
          </div>
        ) : null}
      </div>

      {incomingCopy ? (
        <div className="coop-settings-card mt-2 p-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--coop-panel-muted)]">
            Teammate upgrade request{incomingCopy.count === 1 ? "" : "s"}
          </p>
          <p className="coop-settings-card-desc mt-1">
            {incomingCopy.newestEmail
              ? `${incomingCopy.newestEmail} asked for ${incomingCopy.toLabel}.`
              : `A teammate asked for ${incomingCopy.toLabel}.`}
            {incomingCopy.count > 1 ? ` ${incomingCopy.count} requests are waiting.` : ""} Confirm in
            the admin portal. That charges the card on file.
          </p>
        </div>
      ) : null}

      {meters ? (
        <>
          <p className="coop-prompt-modal-section-title mt-4">Included in {meters.displayName}</p>
          {monthlyUsageBar(
            meters.auto.usedRatio,
            meters.frontier.usedRatio,
            typeof meters.usedRatio === "number"
              ? meters.usedRatio
              : Math.min(1, meters.auto.usedRatio + meters.frontier.usedRatio),
            resetParts
          )}
        </>
      ) : null}

      <div className="coop-settings-actions mt-3">
        <a className="coop-settings-action-btn" href={adminHref} target="_blank" rel="noreferrer">
          Open admin portal
        </a>
        {isFreeDeveloperPlan(prefs) && upgradeToProPhase !== "confirming" && upgradeToProPhase !== "success" ? (
          <button type="button" className="coop-settings-action-btn" onClick={onUpgradeToPro}>
            Upgrade to Pro
          </button>
        ) : null}
      </div>
      {upgradeToProPhase === "confirming" ? (
        <p className="coop-settings-card-desc mt-2" role="status">
          Confirming upgrade… Finish Stripe Checkout, then return here. This usually takes a few seconds.
        </p>
      ) : null}
      {upgradeToProPhase === "success" ? (
        <p className="coop-settings-card-desc mt-2" role="status">
          You&apos;re on Pro.
        </p>
      ) : null}
      {upgradeToProError ? (
        <p className="coop-settings-test-message--error mt-2">{upgradeToProError}</p>
      ) : null}

      {convertPhase === "confirm" && convertCopy && upgradeCta.kind === "admin-convert" ? (
        <div
          className="coop-prompt-modal-backdrop coop-prompt-modal-backdrop--dim"
          role="presentation"
          onClick={closeConvertFlow}
        >
          <div
            className="coop-prompt-modal coop-prompt-modal--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coop-seat-convert-title"
            aria-describedby="coop-seat-convert-body"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="coop-prompt-modal-header">
              <p id="coop-seat-convert-title" className="coop-prompt-modal-title">
                {convertCopy.title}
              </p>
            </div>
            <div className="coop-prompt-modal-body">
              <p id="coop-seat-convert-body" className="coop-prompt-modal-muted">
                {convertCopy.body}
              </p>
            </div>
            <div className="coop-prompt-modal-footer coop-prompt-modal-footer--inset">
              <button type="button" className="coop-settings-action-btn" onClick={closeConvertFlow}>
                {convertCopy.cancelLabel}
              </button>
              <button
                type="button"
                className="coop-settings-action-btn coop-settings-action-btn--primary"
                onClick={startConvertCharge}
              >
                {convertCopy.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function IndexingDetail(props: SettingsDetailProps): React.ReactElement {
  const { prefs, lightningState } = props;
  const adminBase = (prefs.adminPortalUrl ?? "https://admin.coop-ai.dev").replace(/\/$/, "");
  const signedIn = preferencesSignedIn(prefs);
  const readyRepos = lightningState?.readyRepos ?? 0;
  const indexingRepos = lightningState?.indexingRepos ?? 0;
  const indexedCount = lightningState?.indexedRepoCount;
  const indexedLimit = lightningState?.indexedRepoLimit;

  return (
    <>
      <SettingsSection>
        <p className="coop-prompt-modal-section-title">Deep-Index status</p>
        {!signedIn ? (
          <p className="coop-settings-card-desc">Sign in under Account to view indexing status.</p>
        ) : !lightningState ? (
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
                {indexingPlanCapLabel(indexedCount, indexedLimit)}
              </p>
            ) : null}
          </>
        )}
        {signedIn ? (
          <>
            <p className="coop-settings-card-desc mt-2">
              Org-wide indexing and repo catalog are managed in the admin portal.
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
          </>
        ) : null}
      </SettingsSection>
      <WorkspaceReposSettings {...props} />
    </>
  );
}

function AccountDetail({
  prefs,
  onSignInSso,
  onSignInPassword,
  onSignInGoogle,
  onForgotPassword,
  onSignOut
}: SettingsDetailProps): React.ReactElement {
  const signedIn = preferencesSignedIn(prefs);

  if (signedIn) {
    return (
      <SettingsSection>
        <p className="coop-prompt-modal-section-title">Signed in</p>
        <p className="coop-settings-card-desc">{accountDetailIdentity(prefs)}</p>
        <div className="coop-settings-actions">
          <button type="button" className="coop-settings-action-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection>
      <SignInForm
        onSignInGoogle={onSignInGoogle}
        onSignInPassword={onSignInPassword}
        onSignInSso={onSignInSso}
        onForgotPassword={onForgotPassword}
      />
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
        One code host is enough for setup. Connect others only if your team uses them.
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

      <p className="coop-prompt-modal-section-title px-0.5 mt-4">Integrations</p>
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
          subtitle={isTeamsComingSoon() ? "Coming soon" : integrationListSubtitle(prefs, "teams")}
          configured={isTeamsComingSoon() ? false : integrationConfigured(prefs, "teams")}
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

      <p className="coop-prompt-modal-section-title px-0.5 mt-4">Integrations</p>
      <SettingsSection>
        <div className="space-y-3">
          {collaborationProviders.map((tool) =>
            tool.provider === "teams" && isTeamsComingSoon() ? (
              <div key="teams" className="coop-settings-card">
                <div className="coop-health-integration">
                  <div className="min-w-0">
                    <div className="coop-health-integration-name">Microsoft Teams</div>
                    <div className="coop-health-integration-meta">Not available yet</div>
                  </div>
                  <span className="coop-health-status shrink-0 coop-health-status--offline">Coming soon</span>
                </div>
              </div>
            ) : (
              <IntegrationStatusCard
                key={tool.provider}
                name={tool.name}
                meta={memberToolStatusMeta(prefs, tool.provider)}
                status={resolveMemberToolStatus(prefs, tool.provider)}
                description={tool.description}
              />
            )
          )}
        </div>
      </SettingsSection>

      <MemberAdminPortalLink prefs={prefs} />
    </>
  );
}

function agentsMdNavSubtitle(prefs: Preferences): string {
  if (prefs.projectInstructions?.status === "disabled") {
    return "Disabled";
  }
  if (agentsMdAttached(prefs.projectInstructions)) {
    return "Loaded on every message";
  }
  return shouldPromptForAgentsMd(prefs.projectInstructions) ? "Create or upload" : "Not prompted";
}

function contextNavSubtitle(prefs: Preferences): string {
  const parts: string[] = [];
  if (prefs.includeActiveFile) {
    parts.push("Active file");
  }
  if (prefs.includeSelection) {
    parts.push("Selection");
  }
  if (prefs.useCachedResponses) {
    parts.push("Reuse responses");
  }
  return parts.length > 0 ? parts.join(" · ") : "Off";
}

function PreferencesListDetail(props: SettingsDetailProps): React.ReactElement {
  const { prefs, promptLibrary, onNavigate, onUpdate } = props;
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
        AGENTS.md, chat context, model defaults, timezone, and your quick prompt library.
      </p>
      <CoopNavList>
        <CoopNavRow
          title="AGENTS.md"
          subtitle={agentsMdNavSubtitle(prefs)}
          onClick={() => onNavigate("agents-md")}
        />
        <CoopNavRow
          title="Context"
          subtitle={contextNavSubtitle(prefs)}
          onClick={() => onNavigate("context")}
        />
        <CoopNavRow
          title="Model & chat"
          subtitle={assignedModelsHubSubtitle({
            autocompleteEnabled: prefs.autocompleteEnabled
          })}
          onClick={() => onNavigate("model")}
        />
        <CoopNavRow
          title="Prompt library"
          subtitle={pinned === 0 ? "No quick prompts pinned" : pinned === 1 ? "1 quick prompt pinned" : `${pinned} quick prompts pinned`}
          onClick={() => onNavigate("prompts")}
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
  onInstallGithubApp,
  onRefreshGithubInstallation,
  onTestCodeHost,
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
  const connected = codeHostConfigured(prefs, "github");
  return (
    <SettingsSection>
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
    </SettingsSection>
  );
}

function GitLabDetail({
  prefs,
  onInstallGitlabApp,
  onRefreshGitlabInstallation,
  onTestCodeHost,
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
  const connected = codeHostConfigured(prefs, "gitlab");
  return (
    <SettingsSection>
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
    </SettingsSection>
  );
}

function BitbucketDetail({
  prefs,
  onInstallBitbucketApp,
  onRefreshBitbucketInstallation,
  onTestCodeHost,
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
  const connected = codeHostConfigured(prefs, "bitbucket");
  return (
    <SettingsSection>
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
    </SettingsSection>
  );
}

function SlackDetail({
  prefs,
  onTestIntegration,
  onInstallSlackApp,
  onRefreshSlackInstallation,
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
      />
    </SettingsSection>
  );
}

function JiraDetail({
  prefs,
  onTestIntegration,
  onInstallAtlassianApp,
  onRefreshAtlassianInstallation,
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
      />
    </SettingsSection>
  );
}

function TeamsDetail(_props: SettingsDetailProps): React.ReactElement {
  return (
    <SettingsSection>
      <div className="coop-health-integration">
        <div>
          <div className="coop-health-integration-name">Microsoft Teams</div>
          <div className="coop-health-integration-meta">Not available yet</div>
        </div>
        <span className="coop-health-status coop-health-status--offline">Coming soon</span>
      </div>
    </SettingsSection>
  );
}

function ConfluenceDetail({
  prefs,
  onTestIntegration,
  onInstallAtlassianApp,
  onRefreshAtlassianInstallation,
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
      />
    </SettingsSection>
  );
}

function NotionDetail({
  prefs,
  onTestIntegration,
  onInstallNotionApp,
  onRefreshNotionInstallation,
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
      />
    </SettingsSection>
  );
}

function GoogleDocsDetail({
  prefs,
  onTestIntegration,
  onInstallGoogleDocsApp,
  onRefreshGoogleDocsInstallation,
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
      />
    </SettingsSection>
  );
}

function workspaceRepoLabel(repoId: string): string {
  const colon = repoId.indexOf(":");
  const rest = colon >= 0 ? repoId.slice(colon + 1) : repoId;
  return rest || repoId;
}

function WorkspaceReposSettings({ prefs }: SettingsDetailProps): React.ReactElement {
  const workspaceRepos = useMemo(() => {
    return (prefs.workspaceRepoIds ?? []).map((repoId) => ({
      repoId,
      label: workspaceRepoLabel(repoId)
    }));
  }, [prefs.workspaceRepoIds]);

  return (
    <SettingsSection title="Workspace repos">
      <p className="coop-settings-card-desc">
        {prefs.adminControlledRepos
          ? prefs.repoAccessMode === "per_user"
            ? "Your org admin assigned which Deep-Indexed repos you can use. Coop-Search and the folder picker are limited to those repos."
            : "Your org admin controls which repositories are Deep-Indexed. You can use every indexed repo your organization has authorized."
          : "Deep-Indexed repos are already on for everyone signed in to this org. Coop-Search and the folder picker use them."}
      </p>
      {isFreeDeveloperPlan(prefs) ? (
        <p className="coop-settings-card-desc mt-2">
          Free plan includes the same indexing and search as Pro. AI usage is capped at 80,000 tokens per
          5-hour window.
        </p>
      ) : null}
      <div className="coop-settings-card space-y-3">
        <div className="min-w-0">
          {workspaceRepos.length > 0 ? (
            <div className="coop-indexed-ref-row">
              {workspaceRepos.map((repo) => (
                <span key={repo.repoId} className="coop-indexed-ref" title={`${repo.label} · on`}>
                  {repo.label}
                </span>
              ))}
            </div>
          ) : prefs.adminControlledRepos ? (
            <p className="coop-settings-card-desc">
              {prefs.canInstallIntegrations === true ? (
                <>
                  No indexed repos assigned to you yet. Open the admin portal → Users, grant yourself
                  access, then refresh.
                </>
              ) : (
                <>
                  No indexed repos assigned to your account yet. Ask your org admin to grant access in
                  the admin portal.
                </>
              )}
            </p>
          ) : (
            <p className="coop-settings-card-desc">
              Nothing is Deep-Indexed yet. An admin turns repositories on in the admin portal.
            </p>
          )}
        </div>
        {prefs.githubNeedsReconnect ? (
          <p className="coop-settings-test-message--error text-[11px]">
            GitHub access expired. Ask your org admin to reconnect GitHub in the admin portal (Integrations → GitHub).
          </p>
        ) : null}
        {prefs.adminControlledRepos ? (
          <p className="coop-prompt-modal-muted text-[11px]">
            Repository access is managed by your organization admin.
          </p>
        ) : null}
      </div>
    </SettingsSection>
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

function AgentsMdSettings({
  prefs,
  onAttachAgentsMd,
  onOpenAgentsMd,
  onStartFromAgentsMdTemplate,
  onDetachAgentsMd
}: SettingsDetailProps): React.ReactElement {
  const showDetach = Boolean(onDetachAgentsMd) && canDetachAgentsMd(prefs.projectInstructions);
  const attached = agentsMdAttached(prefs.projectInstructions);
  const promptCreate = shouldPromptForAgentsMd(prefs.projectInstructions);
  return (
    <SettingsSection>
      <div className="space-y-2">
        {prefs.projectInstructions?.status === "disabled" ? (
          <p className="coop-settings-card-desc">
            Disabled in VS Code settings (<span className="font-medium">coopAI.projectInstructions.enabled</span>).
          </p>
        ) : (
          <>
            {attached || promptCreate ? (
            <div className="coop-agents-md-settings-row">
              {attached ? (
                <span className="coop-agents-md-chip-group">
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
                  {showDetach ? (
                    <button
                      type="button"
                      className="coop-source-chip-dismiss"
                      title="Remove AGENTS.md"
                      aria-label="Remove AGENTS.md"
                      onClick={onDetachAgentsMd}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ) : (
                <span className="coop-agents-md-chip coop-agents-md-chip--missing coop-agents-md-chip--static">
                  <span className="coop-agents-md-chip-icon" aria-hidden="true">
                    ✕
                  </span>
                  AGENTS.md
                </span>
              )}
              {attached ? (
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
            ) : null}
            {!attached && promptCreate ? (
              <button type="button" className="coop-agents-md-guide-link" onClick={onAttachAgentsMd}>
                Upload AGENTS.md
              </button>
            ) : null}
            {attached || promptCreate ? (
              <>
                <p className="coop-settings-card-desc !mb-0">Loaded on every message.</p>
                <AgentsMdTemplateGuide className="mt-1" />
              </>
            ) : (
              <p className="coop-settings-card-desc !mb-0">No Create AGENTS.md prompt for this file.</p>
            )}
          </>
        )}
      </div>
    </SettingsSection>
  );
}

function ContextSettings({
  prefs,
  onUpdate
}: {
  prefs: Preferences;
  onUpdate: SettingsDetailProps["onUpdate"];
}): React.ReactElement {
  return (
    <SettingsSection>
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
  );
}

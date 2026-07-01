import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CoopPanelHeader } from "./components/CoopPanelHeader";
import { RefreshButton } from "./components/RefreshButton";
import type { LightningModeState, LightningRepoState } from "../indexing/lightningTypes";

export type { LightningModeState, LightningRepoState };

type LightningModePanelProps = {
  state: LightningModeState;
  open: boolean;
  onClose: () => void;
  onEnableGlobal: () => void;
  onDisableGlobal: () => void;
  onEnableRepo: (repoId: string) => void;
  onDisableRepo: (repoId: string) => void;
  onRefreshRepo: (repoId: string) => void;
  onUpgrade?: () => void;
  onAddRepo?: () => void;
};

function ContextModePlanSummary(): React.ReactElement {
  return (
    <div className="coop-context-mode-plans space-y-2">
      <p>
        <span className="coop-context-mode-plan-label">Developer (free)</span>
        {
          ": Deep-Index up to 3 repos — same cloud search (symbols, full-text, embeddings) as Pro. AI usage capped at 80,000 tokens per 5-hour window."
        }
      </p>
      <p>
        <span className="coop-context-mode-plan-label">Pro</span>
        {
          ": Unlimited Deep-Indexed repos, team seats, and Collections for advanced cross-repo groupings."
        }
      </p>
      <p className="coop-context-mode-plans-all">
        <span className="font-medium text-[var(--coop-panel-foreground)]">All plans</span> include Slack, Jira, Notion,
        and more when connected in Settings.
      </p>
    </div>
  );
}

function ExpandChevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

const STATUS_LABELS: Record<LightningRepoState["status"], string> = {
  idle: "Idle",
  cloning: "Cloning…",
  indexing: "Indexing…",
  ready: "Ready",
  error: "Error",
  disabled: "Disabled"
};

export function LightningModePanel({
  state,
  open,
  onClose,
  onEnableGlobal,
  onDisableGlobal,
  onEnableRepo,
  onDisableRepo,
  onRefreshRepo,
  onUpgrade,
  onAddRepo
}: LightningModePanelProps): React.ReactElement | null {
  const [consentChecked, setConsentChecked] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);

  const diskSummary = useMemo(() => formatBytes(state.totalDiskBytes), [state.totalDiskBytes]);
  const diskLimit = useMemo(() => `${state.maxDiskGb} GB`, [state.maxDiskGb]);

  const handleEnableClick = useCallback(() => {
    if (state.backend !== "cloud" && !consentChecked) {
      setConfirmEnable(true);
      return;
    }
    onEnableGlobal();
    setConfirmEnable(false);
  }, [consentChecked, onEnableGlobal, state.backend]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="coop-prompt-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="coop-prompt-modal coop-prompt-modal--context"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightning-mode-title"
        onClick={(event) => event.stopPropagation()}
      >
        <CoopPanelHeader
          variant="modal"
          wrapSubtitle
          titleElement="h2"
          titleId="lightning-mode-title"
          title="Deep-Code Graph"
          subtitle={<ContextModePlanSummary />}
          onClose={onClose}
          closeAriaLabel="Close"
        />

        <div
          className={`coop-prompt-modal-scroll space-y-3${!state.canUseLightning ? " coop-prompt-modal-scroll--context" : ""}`}
        >
          {!state.canUseLightning ? (
            <FreeTierBody onViewPlans={onUpgrade} />
          ) : (
            <>
              <div className="coop-settings-card space-y-3">
                <div>
                  <p className="coop-settings-card-title">Deep-Code Graph indexing</p>
                  <p className="coop-settings-card-desc mt-1">
                    {state.backend === "cloud"
                      ? "Coop builds a searchable code graph in the cloud for faster Coop-Search, dependencies, and symbols — no local indexer install."
                      : "Coop builds and maintains a searchable code graph on this machine — ownership, dependencies, symbols, and text search tuned for monorepos."}
                  </p>
                  <p className="coop-settings-card-desc mt-2">
                    {state.backend === "cloud"
                      ? `${state.readyRepos} ready · ${state.indexingRepos} building`
                      : `${diskSummary} of ${diskLimit} · ${state.readyRepos} ready · ${state.indexingRepos} building`}
                  </p>
                </div>
                {state.backend !== "cloud" ? (
                <label className="coop-settings-checkbox-row !py-0">
                  <div className="min-w-0 flex-1">
                    <div className="coop-settings-row-title">Local storage consent</div>
                    <div className="coop-settings-row-desc">
                      I understand Lightning stores a local code graph and supporting repo data under{" "}
                      <code className="text-[11px]">~/.coopai/</code> on this machine.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => {
                      setConsentChecked(event.target.checked);
                      if (event.target.checked) {
                        setConfirmEnable(false);
                      }
                    }}
                  />
                </label>
                ) : null}
                {confirmEnable ? (
                  <p className="coop-prompt-modal-note" role="status">
                    Check the consent box above to enable Lightning Mode.
                  </p>
                ) : null}
              </div>

              <div className="coop-settings-card">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="coop-settings-card-title">Deep-Code Graph</p>
                    <p className="coop-settings-card-desc mt-0.5">
                      {state.globalEnabled
                        ? state.backend === "local"
                          ? "Local code graph active — fastest context for this repo"
                          : "Cloud code graph active — Coop-Search across Deep-Indexed Repos"
                        : "Deep-Code Graph is off"}
                    </p>
                  </div>
                  {state.globalEnabled ? (
                    <button type="button" className="coop-settings-action-btn" onClick={onDisableGlobal}>
                      Turn off
                    </button>
                  ) : (
                    <button type="button" className="coop-settings-action-btn" onClick={handleEnableClick}>
                      Turn on
                    </button>
                  )}
                </div>
              </div>

              {(state.plan === "free" || state.plan === "pro") && state.indexedRepoCount === 0 ? (
                <div className="coop-notice coop-notice--info coop-notice--compact">
                  {state.plan === "free"
                    ? "Deep-Index up to 3 repos in the admin portal (Indexing). Coop-Search uses the same cloud index as Pro."
                    : "Choose up to 3 repos for Deep-Code Graph indexing. Coop-Search works across every Deep-Indexed Repo you add."}
                </div>
              ) : null}

              {state.plan === "free" || state.plan === "pro" ? (
                <ProOnboardingChecklist
                  githubConnected={state.repos.length > 0 || Boolean(state.currentRepoId)}
                  indexedCount={state.indexedRepoCount ?? state.enabledRepos}
                />
              ) : null}

              <RepoList
                repos={state.repos}
                currentRepoId={state.currentRepoId}
                globalEnabled={state.globalEnabled}
                plan={state.plan}
                indexedRepoCount={state.indexedRepoCount ?? state.enabledRepos}
                indexedRepoLimit={state.indexedRepoLimit}
                canEnableMoreRepos={state.canEnableMoreRepos ?? true}
                onEnableRepo={onEnableRepo}
                onDisableRepo={onDisableRepo}
                onRefreshRepo={onRefreshRepo}
                onUpgrade={onUpgrade}
                onAddRepo={onAddRepo}
              />
            </>
          )}
        </div>

        {!state.canUseLightning ? (
          <footer className="coop-prompt-modal-footer coop-prompt-modal-footer--inset justify-end">
            <button type="button" className="coop-settings-action-btn" onClick={onClose}>
              Close
            </button>
            {onUpgrade ? (
              <button type="button" className="coop-settings-action-btn" onClick={onUpgrade}>
                View plans
              </button>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function FreeTierBody({ onViewPlans }: { onViewPlans?: () => void }): React.ReactElement {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <>
      <p className="coop-context-mode-active">
        <span className="coop-health-status coop-health-status--healthy shrink-0">Active</span>
        Developer
      </p>

      <button
        type="button"
        className="coop-context-mode-expand"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <span>{detailsOpen ? "Hide details" : "What’s included"}</span>
        <ExpandChevron open={detailsOpen} />
      </button>

      {detailsOpen ? (
        <div className="coop-context-mode-details">
          <section className="coop-context-mode-details-section">
            <p className="coop-context-mode-details-title">Developer (free)</p>
            <ul className="coop-context-mode-details-list">
              <li>Local workspace files in VS Code — no code-host connection required.</li>
              <li>Unlimited tool integrations: Slack, Jira, Teams, Notion, Confluence, Google Docs.</li>
              <li>Chat and quick actions with AI credits (rolling 5-hour window).</li>
              <li>Individual account only — no team seats on the free plan.</li>
            </ul>
          </section>
          <section className="coop-context-mode-details-section">
            <p className="coop-context-mode-details-title">Pro — code hosts &amp; Lightning Mode</p>
            <ul className="coop-context-mode-details-list">
              <li>GitHub connection and workspace repos for cross-repo context.</li>
              <li>Indexes repos on Coop cloud for symbol-graph cross-repo search.</li>
              <li>Faster answers on large repos (dependencies, symbols, ownership).</li>
              <li>Team seats — invite teammates.</li>
            </ul>
            {onViewPlans ? (
              <p className="mt-2">
                <button type="button" className="coop-text-btn !inline !px-0 !py-0" onClick={onViewPlans}>
                  Pro — $20/user/month
                </button>
              </p>
            ) : null}
          </section>
        </div>
      ) : (
        <p className="coop-prompt-modal-muted text-[11px] leading-relaxed">
          Pro adds code-host connections, team seats, and Lightning Mode for faster cross-repo search.{" "}
          {onViewPlans ? (
            <button type="button" className="coop-text-btn !inline !px-0 !py-0 align-baseline" onClick={onViewPlans}>
              View plans
            </button>
          ) : null}
        </p>
      )}
    </>
  );
}

function ProOnboardingChecklist({
  githubConnected,
  indexedCount
}: {
  githubConnected: boolean;
  indexedCount: number;
}): React.ReactElement {
  return (
    <ul className="coop-context-mode-details-list text-[11px] text-[var(--coop-panel-muted)]">
      <li>{githubConnected ? "✓" : "○"} GitHub connected</li>
      <li>{indexedCount > 0 ? "✓" : "○"} At least 1 Deep-Indexed Repo</li>
      <li>{indexedCount > 1 ? "✓" : "○"} Coop-Search across multiple repos</li>
    </ul>
  );
}

function RepoList({
  repos,
  currentRepoId,
  globalEnabled,
  plan,
  indexedRepoCount,
  indexedRepoLimit,
  canEnableMoreRepos,
  onEnableRepo,
  onDisableRepo,
  onRefreshRepo,
  onUpgrade,
  onAddRepo
}: {
  repos: LightningRepoState[];
  currentRepoId?: string;
  globalEnabled: boolean;
  plan: LightningModeState["plan"];
  indexedRepoCount: number;
  indexedRepoLimit?: number | null;
  canEnableMoreRepos: boolean;
  onEnableRepo: (repoId: string) => void;
  onDisableRepo: (repoId: string) => void;
  onRefreshRepo: (repoId: string) => void;
  onUpgrade?: () => void;
  onAddRepo?: () => void;
}): React.ReactElement {
  const limitLabel =
    (plan === "free" || plan === "pro") && indexedRepoLimit != null
      ? `Your Deep-Indexed Repos (${indexedRepoCount}/${indexedRepoLimit})`
      : plan === "enterprise"
        ? `Deep-Indexed Repos (${indexedRepoCount})`
        : "Repositories";

  if (repos.length === 0) {
    return (
      <div className="space-y-3">
        <p className="coop-prompt-modal-muted">
          Connect GitHub in Settings, then add up to 3 repos for Deep-Code Graph indexing.
        </p>
        {onAddRepo ? (
          <button type="button" className="coop-settings-action-btn" onClick={onAddRepo}>
            Add repository
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="coop-prompt-modal-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="coop-prompt-modal-section-title">{limitLabel}</h3>
        <div className="flex items-center gap-2">
          {onAddRepo && canEnableMoreRepos ? (
            <button type="button" className="coop-settings-action-btn" onClick={onAddRepo}>
              Add repo
            </button>
          ) : null}
          {plan === "pro" && !canEnableMoreRepos && onUpgrade ? (
            <button type="button" className="coop-text-btn" onClick={onUpgrade}>
              Upgrade to Enterprise
            </button>
          ) : null}
          {plan === "free" && !canEnableMoreRepos && onUpgrade ? (
            <button type="button" className="coop-text-btn" onClick={onUpgrade}>
              Upgrade to Pro
            </button>
          ) : null}
        </div>
      </div>
      {!canEnableMoreRepos ? (
        <p className="coop-prompt-modal-note mt-1">
          {plan === "free"
            ? "Free includes up to 3 Deep-Indexed repos. Upgrade to Pro for unlimited indexing and team seats."
            : "Pro includes up to 3 Deep-Indexed Repos per seat. Upgrade for estate-wide indexing."}
        </p>
      ) : null}
      <ul className="space-y-2">
        {repos.map((repo) => (
          <li key={repo.repoId} className="coop-health-integration">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="coop-health-integration-name flex flex-wrap items-center gap-1.5">
                  <span className="truncate">
                    {repo.owner}/{repo.repo}
                  </span>
                  {repo.repoId === currentRepoId ? (
                    <span className="coop-health-status coop-health-status--healthy shrink-0">active</span>
                  ) : null}
                </p>
                <p className="coop-health-integration-meta mt-1">
                  {STATUS_LABELS[repo.status]}
                  {repo.lastIndexedAt ? ` · indexed ${formatRelative(repo.lastIndexedAt)}` : ""}
                  {repo.diskUsageBytes ? ` · ${formatBytes(repo.diskUsageBytes)}` : ""}
                </p>
                {repo.localPath ? <p className="coop-health-integration-meta truncate">{repo.localPath}</p> : null}
                {repo.error ? (
                  <p className="coop-settings-test-message--error mt-1 text-[11px]">{repo.error}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {repo.enabled ? (
                  <>
                    <RefreshButton label="Re-index" onClick={() => onRefreshRepo(repo.repoId)} />
                    <button type="button" className="coop-text-btn" onClick={() => onDisableRepo(repo.repoId)}>
                      Disable
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!globalEnabled || (!repo.enabled && !canEnableMoreRepos)}
                    className="coop-settings-action-btn"
                    onClick={() => onEnableRepo(repo.repoId)}
                  >
                    Enable
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatRelative(iso: string): string {
  const deltaMs = Date.now() - Date.parse(iso);
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ProUpgradeChip({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      className="coop-quick-action-pill"
      onClick={onClick}
      title="Deep-Code Graph indexing, cross-repo search, and workspace repos — Pro $20/user/mo."
      aria-label="Upgrade to Pro for Deep-Code Graph indexing"
    >
      Upgrade to Pro
    </button>
  );
}

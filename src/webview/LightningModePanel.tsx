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
};

function ContextModePlanSummary(): React.ReactElement {
  return (
    <div className="coop-context-mode-plans space-y-2">
      <p>
        <span className="coop-context-mode-plan-label">Developer</span>
        {": Zero-Clone remote graph from GitHub, GitLab, or Bitbucket — no Lightning Mode."}
      </p>
      <p>
        <span className="coop-context-mode-plan-label">Pro</span>
        {": Zero-Clone plus Lightning Mode — Coop cloud code graph for faster cross-repo search."}
      </p>
      <p className="coop-context-mode-plans-all">
        <span className="font-medium text-[var(--coop-panel-foreground)]">All plans include</span> code-host graph plus
        Slack, Jira, Notion, and more when connected in Settings.
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
  onUpgrade
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
          title="Context mode"
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
                  <p className="coop-settings-card-title">
                    {state.backend === "cloud" ? "Coop cloud code graph" : "Local code graph index"}
                  </p>
                  <p className="coop-settings-card-desc mt-1">
                    {state.backend === "cloud"
                      ? "Lightning indexes your repos on Coop cloud for faster search, dependencies, and symbols across your codebase — no local indexer install."
                      : "Lightning builds and maintains a searchable code graph on this machine — ownership, dependencies, symbols, and text search tuned for monorepos."}
                  </p>
                  <p className="coop-settings-card-desc mt-2">
                    {state.backend === "cloud"
                      ? `${state.readyRepos} graph${state.readyRepos === 1 ? "" : "s"} ready · ${state.indexingRepos} building`
                      : `${diskSummary} of ${diskLimit} · ${state.readyRepos} graph${state.readyRepos === 1 ? "" : "s"} ready · ${state.indexingRepos} building`}
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
                    <p className="coop-settings-card-title">Lightning Mode</p>
                    <p className="coop-settings-card-desc mt-0.5">
                      {state.globalEnabled
                        ? state.backend === "local"
                          ? "Local code graph active — fastest context for this repo"
                          : "Coop cloud code graph active — fastest context for this repo"
                        : "Remote code graph only (Zero-Clone)"}
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

              <RepoList
                repos={state.repos}
                currentRepoId={state.currentRepoId}
                globalEnabled={state.globalEnabled}
                onEnableRepo={onEnableRepo}
                onDisableRepo={onDisableRepo}
                onRefreshRepo={onRefreshRepo}
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
        Developer · Zero-Clone
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
            <p className="coop-context-mode-details-title">Developer &amp; Pro (every plan)</p>
            <ul className="coop-context-mode-details-list">
              <li>Remote code graph from GitHub, GitLab, or Bitbucket — connect a host and repo in Settings.</li>
              <li>Optional: Slack, Jira, Teams, Notion, Confluence, Google Docs for tickets, threads, and docs.</li>
              <li>Quick actions and chat — no full local clone required.</li>
            </ul>
          </section>
          <section className="coop-context-mode-details-section">
            <p className="coop-context-mode-details-title">Pro only — Lightning Mode</p>
            <ul className="coop-context-mode-details-list">
              <li>Indexes your repos on Coop cloud for symbol-graph cross-repo search.</li>
              <li>Faster answers on large repos (dependencies, symbols, ownership).</li>
              <li>Backend-managed indexing — no local indexer install required.</li>
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
          Pro adds Lightning Mode — faster cross-repo search on large codebases.{" "}
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

function RepoList({
  repos,
  currentRepoId,
  globalEnabled,
  onEnableRepo,
  onDisableRepo,
  onRefreshRepo
}: {
  repos: LightningRepoState[];
  currentRepoId?: string;
  globalEnabled: boolean;
  onEnableRepo: (repoId: string) => void;
  onDisableRepo: (repoId: string) => void;
  onRefreshRepo: (repoId: string) => void;
}): React.ReactElement {
  if (repos.length === 0) {
    return (
      <p className="coop-prompt-modal-muted">
        Select a repo in CoopAI, then enable Lightning to build a code graph for it.
      </p>
    );
  }

  return (
    <section className="coop-prompt-modal-section">
      <h3 className="coop-prompt-modal-section-title">Repositories</h3>
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
                <p className="coop-health-integration-meta mt-1">
                  Search index {repo.zoektAvailable ? "✓" : "—"} · Symbol graph {repo.scipAvailable ? "✓" : "—"}
                </p>
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
                    disabled={!globalEnabled}
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

function statusDotColor(
  state: Pick<LightningModeState, "canUseLightning" | "globalEnabled" | "indexingRepos">
): string {
  if (!state.canUseLightning || !state.globalEnabled) {
    return "var(--coop-panel-muted)";
  }
  if (state.indexingRepos > 0) {
    return "var(--vscode-progressBar-background, var(--vscode-inputValidation-warningBorder, #d19a66))";
  }
  return "var(--vscode-testing-iconPassed, #3fb950)";
}

export function LightningStatusBadge({
  state,
  onClick
}: {
  state: Pick<
    LightningModeState,
    "canUseLightning" | "globalEnabled" | "readyRepos" | "indexingRepos" | "backend"
  >;
  onClick: () => void;
}): React.ReactElement {
  const showLocalIndexing = state.backend === "local";
  const label = !state.canUseLightning
    ? "Zero-Clone"
    : !state.globalEnabled
      ? "Zero-Clone"
      : state.indexingRepos > 0
        ? "Lightning · indexing"
        : state.readyRepos > 0
          ? `Lightning · ${state.readyRepos} ready`
          : "Lightning";

  const tooltip = !state.canUseLightning
    ? "Zero-Clone: GitHub/GitLab/Bitbucket + optional Slack, Jira, Notion, etc. Pro adds Lightning Mode ($20/user/mo)."
    : !state.globalEnabled
      ? showLocalIndexing
        ? "Zero-Clone — remote code graph. Open to enable Lightning (local graph index)."
        : "Zero-Clone — remote code graph. Open to enable Lightning (Coop cloud index)."
      : showLocalIndexing
        ? "Lightning — local code graph index active. Click to manage."
        : "Lightning — Coop cloud code graph active. Click to manage.";

  return (
    <button
      type="button"
      className="coop-quick-action-pill"
      onClick={onClick}
      title={tooltip}
      aria-label={`Context mode: ${label}. Open settings.`}
    >
      <span
        className="coop-quick-action-status-dot"
        aria-hidden
        style={{ background: statusDotColor(state) }}
      />
      {label}
    </button>
  );
}

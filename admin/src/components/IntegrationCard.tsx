"use client";

import { useEffect, useRef, useState } from "react";
import type { IntegrationDefinition } from "@/lib/integrations";
import { SCOPABLE_PROVIDERS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { disconnectIntegration, fetchInstallUrl } from "@/lib/coopApi";
import { formatIntegrationError } from "@/lib/integrationErrors";
import { GitHubConnectHandoff } from "./GitHubConnectHandoff";
import { ConnectHandoff } from "./ConnectHandoff";
import { HANDOFF_COPY, HANDOFF_PROVIDERS, type HandoffProvider } from "@/lib/connectHandoff";
import { AdminChip } from "./AdminChip";
import { StatusBadge } from "./StatusBadge";
import { IntegrationScopeModal } from "./IntegrationScopeModal";

type IntegrationCardProps = {
  definition: IntegrationDefinition;
  status?: IntegrationStatus;
  orgPlan?: string;
  onRefresh: () => void;
  refreshing?: boolean;
  refreshSuccess?: boolean;
  initialLoading?: boolean;
  compact?: boolean;
  readOnly?: boolean;
};

export function IntegrationCard({
  definition,
  status,
  orgPlan = "free",
  onRefresh,
  refreshing,
  refreshSuccess,
  initialLoading,
  compact,
  readOnly = false
}: IntegrationCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [awaitingOAuth, setAwaitingOAuth] = useState(false);
  const [githubHandoffAwaiting, setGithubHandoffAwaiting] = useState(false);
  const [connectHandoffAwaiting, setConnectHandoffAwaiting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comingSoon = definition.comingSoon;
  const isScopable = SCOPABLE_PROVIDERS.includes(
    definition.id as (typeof SCOPABLE_PROVIDERS)[number]
  );
  const isHandoffProvider = HANDOFF_PROVIDERS.includes(definition.id as HandoffProvider);

  async function handleConnect() {
    if (definition.id === "github" || isHandoffProvider) {
      return;
    }
    setConnecting(true);
    setError(null);
    const result = await fetchInstallUrl(definition.id);
    setConnecting(false);
    if (!result.ok) {
      setError(formatIntegrationError(definition.id, result.status, result.error));
      return;
    }
    if (result.data?.connected) {
      onRefresh();
      return;
    }
    if (!result.data?.url) {
      setError(formatIntegrationError(definition.id, result.status, "Install URL missing."));
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
    setAwaitingOAuth(true);
  }

  const installed = status?.installed ?? false;
  const needsReconnect = status?.needsReconnect ?? false;
  const connected = installed && !needsReconnect;
  const scopeStatus = status?.scopeStatus;
  const scopeActive = scopeStatus === "active";
  const scopeRequired = scopeStatus === "required";
  const wasConnectedRef = useRef(connected);

  const isGitHub = definition.id === "github";
  const awaitingConnect = awaitingOAuth || githubHandoffAwaiting || connectHandoffAwaiting;

  useEffect(() => {
    if (!awaitingConnect) {
      return;
    }
    const poll = window.setInterval(() => onRefresh(), 2000);
    const onFocus = () => onRefresh();
    window.addEventListener("focus", onFocus);
    const timeout = window.setTimeout(() => {
      setAwaitingOAuth(false);
      setGithubHandoffAwaiting(false);
      setConnectHandoffAwaiting(false);
    }, 120_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
    };
  }, [awaitingConnect, onRefresh]);

  useEffect(() => {
    if (awaitingConnect && connected) {
      setAwaitingOAuth(false);
      setGithubHandoffAwaiting(false);
      setConnectHandoffAwaiting(false);
    }
  }, [awaitingConnect, connected]);

  useEffect(() => {
    if (!wasConnectedRef.current && connected) {
      setAwaitingOAuth(false);
      setGithubHandoffAwaiting(false);
      setConnectHandoffAwaiting(false);
    }
    wasConnectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (scopeRequired && connected) {
      setScopeOpen(true);
    }
  }, [scopeRequired, connected]);

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${definition.name} for your entire organization?`)) return;
    setDisconnecting(true);
    setError(null);
    const result = await disconnectIntegration(definition.id);
    setDisconnecting(false);
    if (!result.ok) {
      setError(result.error ?? "Disconnect failed.");
      return;
    }
    onRefresh();
  }

  function connectionBadge() {
    if (comingSoon) {
      return <AdminChip>Coming soon</AdminChip>;
    }
    if (needsReconnect) {
      if (isGitHub && installed) {
        return <StatusBadge connected={false} label="Health check failed" showWhenDisconnected />;
      }
      return <StatusBadge connected={false} label="Reconnect required" showWhenDisconnected />;
    }
    if (githubHandoffAwaiting && !connected) {
      return <StatusBadge connected={false} label="Waiting for GitHub install" showWhenDisconnected />;
    }
    if (connectHandoffAwaiting && !connected && isHandoffProvider) {
      const label = HANDOFF_COPY[definition.id as HandoffProvider].waitingLabel;
      return <StatusBadge connected={false} label={label} showWhenDisconnected />;
    }
    if (connected && scopeRequired) {
      return <StatusBadge connected={false} label="Scope required" showWhenDisconnected />;
    }
    if (connected && scopeActive) {
      return <StatusBadge connected label="Active" />;
    }
    if (connected) {
      return <StatusBadge connected />;
    }
    return null;
  }

  return (
    <>
      <div
        className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${
          compact ? "py-3" : "py-5"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-white">{definition.name}</h3>
            {connectionBadge()}
          </div>
          <p className="mt-1 text-sm text-coop-muted">{definition.description}</p>
          {connected && status?.detail ? (
            <p className="mt-1 text-xs text-coop-muted">Connected as {status.detail}</p>
          ) : null}
          {isGitHub && !readOnly && !comingSoon ? (
            <GitHubConnectHandoff
              connected={connected}
              installed={installed}
              needsReconnect={needsReconnect}
              connectionKind={status?.connectionKind}
              compact={compact}
              onRefresh={onRefresh}
              onAwaitingChange={setGithubHandoffAwaiting}
            />
          ) : null}
          {isHandoffProvider && !readOnly && !comingSoon ? (
            <ConnectHandoff
              provider={definition.id as HandoffProvider}
              connected={connected}
              needsReconnect={needsReconnect}
              compact={compact}
              onRefresh={onRefresh}
              onAwaitingChange={setConnectHandoffAwaiting}
            />
          ) : null}
          {definition.id === "teams" && connected ? (
            <p className="mt-2 text-xs text-coop-muted">
              Channel allowlist scope — coming soon. All accessible Teams channels are indexed today.
            </p>
          ) : null}
          {status?.scopeSummary ? (
            <p className="mt-1 text-xs text-coop-index">{status.scopeSummary}</p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!readOnly && !comingSoon && !isGitHub && !isHandoffProvider && (!connected || needsReconnect) && (
            <button
              type="button"
              className="admin-btn-primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? "Opening…" : needsReconnect ? "Reconnect" : "Connect"}
            </button>
          )}
          {!readOnly && isScopable && connected && (
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => setScopeOpen(true)}
            >
              Manage access
            </button>
          )}
          {!readOnly && !comingSoon && (connected || needsReconnect) && (
            <button
              type="button"
              className="admin-btn-danger"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
          {!comingSoon && (
            <button
              type="button"
              className={`admin-btn-secondary inline-flex min-w-[5.5rem] items-center justify-center gap-1.5 ${
                refreshing ? "pointer-events-none opacity-60" : ""
              }`}
              onClick={onRefresh}
              disabled={refreshing || initialLoading}
              aria-busy={refreshing}
              aria-label={
                refreshing ? "Refreshing integration status" : refreshSuccess ? "Refreshed" : "Refresh"
              }
            >
              {refreshing ? (
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-coop-muted/30 border-t-coop-index"
                  aria-hidden
                />
              ) : refreshSuccess ? (
                <svg
                  className="h-3.5 w-3.5 text-coop-index"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M3.5 8.5L6.5 11.5L12.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                "Refresh"
              )}
            </button>
          )}
        </div>
      </div>

      {isScopable ? (
        <IntegrationScopeModal
          open={scopeOpen}
          onClose={() => setScopeOpen(false)}
          provider={definition.id}
          providerName={definition.name}
          connected={connected}
          onSaved={onRefresh}
        />
      ) : null}
    </>
  );
}

"use client";

import { useState } from "react";
import type { IntegrationDefinition, CodeHostProvider } from "@/lib/integrations";
import { CODE_HOST_PROVIDERS, SCOPABLE_PROVIDERS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { disconnectIntegration, fetchInstallUrl } from "@/lib/coopApi";
import { formatIntegrationError } from "@/lib/integrationErrors";
import { AdminChip } from "./AdminChip";
import { StatusBadge } from "./StatusBadge";
import { IntegrationScopePanel } from "./IntegrationScopePanel";

type IntegrationCardProps = {
  definition: IntegrationDefinition;
  status?: IntegrationStatus;
  orgPlan?: string;
  onRefresh: () => void;
  refreshing?: boolean;
  refreshSuccess?: boolean;
  initialLoading?: boolean;
  compact?: boolean;
  hideScopePanel?: boolean;
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
  hideScopePanel = false
}: IntegrationCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comingSoon = definition.comingSoon;
  const isCodeHost = CODE_HOST_PROVIDERS.includes(definition.id as CodeHostProvider);
  const requiresEnterprise =
    isCodeHost && definition.id !== "github" && orgPlan === "pro";
  const planBlocked = requiresEnterprise;
  const isScopable = SCOPABLE_PROVIDERS.includes(
    definition.id as (typeof SCOPABLE_PROVIDERS)[number]
  );

  async function handleConnect() {
    if (planBlocked) {
      setError("GitLab and Bitbucket require an Enterprise plan.");
      return;
    }
    setConnecting(true);
    setError(null);
    const result = await fetchInstallUrl(definition.id);
    setConnecting(false);
    if (!result.ok || !result.data?.url) {
      setError(formatIntegrationError(definition.id, result.status, result.error));
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  const installed = status?.installed ?? false;
  const needsReconnect = status?.needsReconnect ?? false;
  const connected = installed && !needsReconnect;
  const scopeStatus = status?.scopeStatus;
  const scopeActive = scopeStatus === "active";
  const scopeRequired = scopeStatus === "required";

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
    if (requiresEnterprise) {
      return <AdminChip variant="plan-enterprise">Enterprise</AdminChip>;
    }
    if (needsReconnect) {
      return <StatusBadge connected={false} label="Reconnect required" showWhenDisconnected />;
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
          {status?.detail ? (
            <p className="mt-1 text-xs text-coop-muted">Connected as {status.detail}</p>
          ) : null}
          {status?.scopeSummary ? (
            <p className="mt-1 text-xs text-coop-index">{status.scopeSummary}</p>
          ) : null}
          {requiresEnterprise && !connected ? (
            <p className="mt-1 text-xs text-coop-muted">
              GitLab and Bitbucket on Pro require Enterprise. Upgrade to connect {definition.name}.
            </p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!comingSoon && (!connected || needsReconnect) && (
            <button
              type="button"
              className="admin-btn-primary"
              onClick={handleConnect}
              disabled={connecting || planBlocked}
            >
              {connecting ? "Opening…" : needsReconnect ? "Reconnect" : "Connect"}
            </button>
          )}
          {!comingSoon && (connected || needsReconnect) && (
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

      {isScopable && !hideScopePanel ? (
        <IntegrationScopePanel
          provider={definition.id}
          orgPlan={orgPlan}
          connected={connected}
          onSaved={onRefresh}
        />
      ) : null}
    </>
  );
}

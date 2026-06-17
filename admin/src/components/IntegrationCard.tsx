"use client";

import { useState } from "react";
import type { IntegrationDefinition, CodeHostProvider } from "@/lib/integrations";
import { CODE_HOST_PROVIDERS } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { disconnectIntegration, fetchInstallUrl } from "@/lib/coopApi";
import { AdminChip } from "./AdminChip";
import { StatusBadge } from "./StatusBadge";

type IntegrationCardProps = {
  definition: IntegrationDefinition;
  status?: IntegrationStatus;
  orgPlan?: string;
  onRefresh: () => void;
  refreshing?: boolean;
};

export function IntegrationCard({
  definition,
  status,
  orgPlan = "free",
  onRefresh,
  refreshing
}: IntegrationCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comingSoon = definition.comingSoon;
  const isCodeHost = CODE_HOST_PROVIDERS.includes(definition.id as CodeHostProvider);
  const requiresPro = isCodeHost && orgPlan === "free";
  const requiresEnterprise =
    isCodeHost && definition.id !== "github" && orgPlan !== "enterprise" && orgPlan !== "free";
  const planBlocked = requiresPro || requiresEnterprise;

  async function handleConnect() {
    if (planBlocked) {
      setError(
        requiresPro
          ? "Code host connections require Pro. Free plan uses local workspace files only."
          : "GitLab and Bitbucket require an Enterprise plan."
      );
      return;
    }
    setConnecting(true);
    setError(null);
    const result = await fetchInstallUrl(definition.id);
    setConnecting(false);
    if (!result.ok || !result.data?.url) {
      setError(result.error ?? "Could not get install URL.");
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  const installed = status?.installed ?? false;
  const needsReconnect = status?.needsReconnect ?? false;
  const connected = installed && !needsReconnect;

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

  return (
    <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-white">{definition.name}</h3>
          {comingSoon ? (
            <AdminChip>Coming soon</AdminChip>
          ) : requiresPro ? (
            <AdminChip variant="plan-pro">Pro</AdminChip>
          ) : requiresEnterprise ? (
            <AdminChip variant="plan-enterprise">Enterprise</AdminChip>
          ) : needsReconnect ? (
            <StatusBadge connected={false} label="Reconnect required" showWhenDisconnected />
          ) : connected ? (
            <StatusBadge connected />
          ) : null}
        </div>
        <p className="mt-1 text-sm text-coop-muted">{definition.description}</p>
        {status?.detail ? (
          <p className="mt-1 text-xs text-coop-muted">Connected as {status.detail}</p>
        ) : null}
        {requiresPro && !connected ? (
          <p className="mt-1 text-xs text-coop-muted">
            Code host connections require Pro. The free plan is individual-only and uses local workspace files.
          </p>
        ) : requiresEnterprise && !connected ? (
          <p className="mt-1 text-xs text-coop-muted">
            Multi-code-host estate indexing is available on Enterprise. Upgrade to connect {definition.name}.
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
            className="admin-btn-secondary"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
    </div>
  );
}

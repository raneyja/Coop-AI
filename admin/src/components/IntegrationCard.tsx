"use client";

import { useState } from "react";
import type { IntegrationDefinition } from "@/lib/integrations";
import type { IntegrationStatus } from "@/lib/integrations";
import { disconnectIntegration, fetchInstallUrl } from "@/lib/coopApi";
import { AdminChip } from "./AdminChip";
import { StatusBadge } from "./StatusBadge";

type IntegrationCardProps = {
  definition: IntegrationDefinition;
  status?: IntegrationStatus;
  onRefresh: () => void;
  refreshing?: boolean;
};

export function IntegrationCard({ definition, status, onRefresh, refreshing }: IntegrationCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comingSoon = definition.comingSoon;

  async function handleConnect() {
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
    <div className="admin-card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{definition.name}</h3>
          <p className="mt-1 text-sm text-coop-muted">{definition.description}</p>
        </div>
        {comingSoon ? (
          <AdminChip>Coming soon</AdminChip>
        ) : installed ? (
          <StatusBadge connected />
        ) : null}
      </div>
      {status?.detail && (
        <p className="text-xs text-coop-muted">Connected as {status.detail}</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        {!comingSoon && !installed && (
          <button
            type="button"
            className="admin-btn-primary"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? "Opening…" : "Connect"}
          </button>
        )}
        {!comingSoon && installed && (
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

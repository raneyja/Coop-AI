"use client";

import { useEffect, useRef, useState } from "react";
import type { IntegrationDefinition, IntegrationStatus } from "@/lib/integrations";
import { SCOPABLE_PROVIDERS } from "@/lib/integrations";
import { disconnectIntegration, fetchInstallUrl } from "@/lib/coopApi";
import { formatIntegrationError } from "@/lib/integrationErrors";
import {
  SEND_LINK_COPY,
  clearSendLinkPending,
  isSendLinkPending,
  markSendLinkPending,
  supportsSendLink,
  type SendLinkProvider
} from "@/lib/sendLinkCopy";
import { AdminChip } from "./AdminChip";
import { StatusBadge } from "./StatusBadge";
import { IntegrationScopeModal } from "./IntegrationScopeModal";
import { Modal } from "./Modal";

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
  void orgPlan;
  const [connecting, setConnecting] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendLinkOpen, setSendLinkOpen] = useState(false);
  const [sendLinkUrl, setSendLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const comingSoon = definition.comingSoon;
  const isGitHub = definition.id === "github";
  const isScopable = SCOPABLE_PROVIDERS.includes(
    definition.id as (typeof SCOPABLE_PROVIDERS)[number]
  );
  const canSendLink = supportsSendLink(definition.id);
  const sendLinkCopy = canSendLink ? SEND_LINK_COPY[definition.id as SendLinkProvider] : null;

  const installed = status?.installed ?? false;
  const needsReconnect = status?.needsReconnect ?? false;
  const connected = installed && !needsReconnect;
  const scopeStatus = status?.scopeStatus;
  const scopeActive = scopeStatus === "active";
  const scopeRequired = scopeStatus === "required";

  const relinkAttempted = useRef(false);
  const wasConnectedRef = useRef(connected);

  useEffect(() => {
    if (canSendLink) {
      setAwaiting(isSendLinkPending(definition.id as SendLinkProvider) && !connected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition.id]);

  useEffect(() => {
    if (!isGitHub || connected || relinkAttempted.current) {
      return;
    }
    relinkAttempted.current = true;
    void (async () => {
      const result = await fetchInstallUrl("github", { mode: "app" });
      if (result.ok && result.data?.connected) {
        clearSendLinkPending("github");
        onRefresh();
      }
    })();
  }, [isGitHub, connected, onRefresh]);

  useEffect(() => {
    if (!awaiting) {
      return;
    }
    const poll = window.setInterval(() => onRefresh(), 2000);
    const onFocus = () => onRefresh();
    window.addEventListener("focus", onFocus);
    const timeout = window.setTimeout(() => setAwaiting(false), 120_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
    };
  }, [awaiting, onRefresh]);

  useEffect(() => {
    if (!wasConnectedRef.current && connected) {
      setAwaiting(false);
      if (canSendLink) {
        clearSendLinkPending(definition.id as SendLinkProvider);
      }
    }
    wasConnectedRef.current = connected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    if (scopeRequired && connected) {
      setScopeOpen(true);
    }
  }, [scopeRequired, connected]);

  async function requestInstallUrl() {
    return fetchInstallUrl(definition.id, isGitHub ? { mode: "app" } : undefined);
  }

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    const result = await requestInstallUrl();
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
      setError("Install URL missing.");
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
    if (canSendLink) {
      markSendLinkPending(definition.id as SendLinkProvider);
    }
    setAwaiting(true);
  }

  async function handleOpenSendLink() {
    setConnecting(true);
    setError(null);
    const result = await requestInstallUrl();
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
      setError("Install URL missing.");
      return;
    }
    setSendLinkUrl(result.data.url);
    setCopied(false);
    setSendLinkOpen(true);
    if (canSendLink) {
      markSendLinkPending(definition.id as SendLinkProvider);
    }
    setAwaiting(true);
  }

  async function handleCopyLink() {
    if (!sendLinkUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(sendLinkUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy — select the link and copy manually.");
    }
  }

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
    if (awaiting && !connected) {
      return (
        <StatusBadge
          connected={false}
          label={sendLinkCopy?.waitingLabel ?? "Connecting…"}
          showWhenDisconnected
        />
      );
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

  const showConnectActions = !readOnly && !comingSoon && (!connected || needsReconnect);
  const connectLabel = needsReconnect ? "Reconnect" : "Connect";

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
          {status?.scopeSummary ? (
            <p className="mt-1 text-xs text-coop-index">{status.scopeSummary}</p>
          ) : null}
          {showConnectActions && canSendLink ? (
            <button
              type="button"
              className="admin-link mt-2 inline-block text-sm underline"
              onClick={() => void handleOpenSendLink()}
              disabled={connecting}
            >
              Request Access
            </button>
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {showConnectActions ? (
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => void handleConnect()}
              disabled={connecting}
            >
              {connecting ? "Opening…" : connectLabel}
            </button>
          ) : null}
          {!readOnly && isScopable && connected ? (
            <button type="button" className="admin-btn-secondary" onClick={() => setScopeOpen(true)}>
              Manage access
            </button>
          ) : null}
          {!readOnly && !comingSoon && (connected || needsReconnect) ? (
            <button
              type="button"
              className="admin-btn-danger"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : null}
          {!comingSoon ? (
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
                <svg className="h-3.5 w-3.5 text-coop-index" viewBox="0 0 16 16" fill="none" aria-hidden>
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
          ) : null}
        </div>
      </div>

      {sendLinkCopy ? (
        <Modal
          open={sendLinkOpen}
          title={sendLinkCopy.modalTitle}
          onClose={() => setSendLinkOpen(false)}
        >
          <div className="space-y-4">
            <div>
              <p className="text-sm text-white">{sendLinkCopy.intro}</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-coop-muted">
                {sendLinkCopy.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
            <textarea
              readOnly
              className="admin-input min-h-[5rem] w-full font-mono text-xs"
              value={sendLinkUrl ?? ""}
              rows={3}
              aria-label={`${sendLinkCopy.vendorName} install link`}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => setSendLinkOpen(false)}
              >
                Go back
              </button>
              <button type="button" className="admin-btn-primary" onClick={() => void handleCopyLink()}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
          </div>
        </Modal>
      ) : null}

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

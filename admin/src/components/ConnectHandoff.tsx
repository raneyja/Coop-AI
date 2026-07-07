"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchInstallUrl } from "@/lib/coopApi";
import { formatIntegrationError } from "@/lib/integrationErrors";
import {
  HANDOFF_COPY,
  clearHandoffPending,
  isHandoffPending,
  markHandoffPending,
  type HandoffProvider
} from "@/lib/connectHandoff";
import { StatusBadge } from "./StatusBadge";

type ConnectHandoffProps = {
  provider: HandoffProvider;
  connected: boolean;
  needsReconnect?: boolean;
  compact?: boolean;
  onRefresh: () => void;
  onAwaitingChange: (awaiting: boolean) => void;
};

function OrgInstallChecklist({
  provider,
  compact
}: {
  provider: HandoffProvider;
  compact?: boolean;
}) {
  const copy = HANDOFF_COPY[provider];
  return (
    <div
      className={`rounded-lg border border-coop-border/60 bg-white/[0.03] ${
        compact ? "p-3 text-xs" : "p-4 text-sm"
      }`}
    >
      <p className="font-medium text-white">{copy.checklistTitle}</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-coop-muted">
        {copy.checklistSteps.map((step) => (
          <li key={step.role}>
            <span className="text-white/90">{step.role}</span> — {step.body}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ConnectHandoff({
  provider,
  connected,
  needsReconnect,
  compact,
  onRefresh,
  onAwaitingChange
}: ConnectHandoffProps) {
  const copy = HANDOFF_COPY[provider];
  const [connecting, setConnecting] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectHint, setConnectHint] = useState<string | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);

  useEffect(() => {
    setHandoffPending(isHandoffPending(provider));
  }, [provider]);

  useEffect(() => {
    if (connected) {
      clearHandoffPending(provider);
      setHandoffPending(false);
      setConnectHint(null);
    }
  }, [connected, provider]);

  useEffect(() => {
    onAwaitingChange(handoffPending && !connected);
  }, [handoffPending, connected, onAwaitingChange]);

  const loadInstallUrl = useCallback(async () => {
    return fetchInstallUrl(provider);
  }, [provider]);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    setConnectHint(null);
    const result = await loadInstallUrl();
    setConnecting(false);
    if (!result.ok) {
      setError(formatIntegrationError(provider, result.status, result.error));
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
    markHandoffPending(provider);
    setHandoffPending(true);
    setConnectHint(copy.connectHint);
  }

  async function handlePrepareHandoff() {
    setConnecting(true);
    setError(null);
    setConnectHint(null);
    const result = await loadInstallUrl();
    setConnecting(false);
    if (!result.ok) {
      setError(formatIntegrationError(provider, result.status, result.error));
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
    setHandoffUrl(result.data.url);
    setHandoffOpen(true);
    markHandoffPending(provider);
    setHandoffPending(true);
  }

  async function handleCopyHandoffLink() {
    if (!handoffUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(handoffUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy — select the link and copy manually.");
    }
  }

  if (connected) {
    return null;
  }

  const connectLabel = needsReconnect ? "Reconnect" : "Connect";
  const sendLinkLabel = `Send link to ${copy.vendorName} admin`;

  return (
    <div className="mt-3 space-y-3">
      <OrgInstallChecklist provider={provider} compact={compact} />

      {handoffPending && !connected ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge connected={false} label={copy.waitingLabel} showWhenDisconnected />
          <span className="text-xs text-coop-muted">
            Finish in the {copy.vendorName} tab, then click Refresh here.
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="admin-btn-primary"
          onClick={() => void handleConnect()}
          disabled={connecting}
        >
          {connecting ? "Opening…" : connectLabel}
        </button>
        <button
          type="button"
          className="admin-btn-secondary"
          onClick={() => void handlePrepareHandoff()}
          disabled={connecting}
        >
          {sendLinkLabel}
        </button>
      </div>

      {handoffOpen && handoffUrl ? (
        <div className="space-y-2 rounded-lg border border-coop-border/60 bg-black/20 p-3">
          <p className="text-xs font-medium text-white">{copy.handoffIntro}</p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-coop-muted">
            {copy.handoffSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <textarea
            readOnly
            className="admin-input min-h-[4.5rem] w-full font-mono text-xs"
            value={handoffUrl}
            rows={3}
            aria-label={`${copy.vendorName} install link`}
          />
          <button type="button" className="admin-btn-secondary text-sm" onClick={() => void handleCopyHandoffLink()}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}

      {connectHint ? <p className="text-xs text-coop-index">{connectHint}</p> : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

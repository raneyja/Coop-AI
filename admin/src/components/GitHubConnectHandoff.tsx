"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchInstallUrl } from "@/lib/coopApi";
import { formatIntegrationError } from "@/lib/integrationErrors";
import {
  GitHubOrgInstallChecklist,
  clearGithubHandoffPending,
  isGithubHandoffPending,
  markGithubHandoffPending
} from "@/lib/githubConnectHandoff";
import { StatusBadge } from "./StatusBadge";

type GitHubConnectHandoffProps = {
  connected: boolean;
  installed: boolean;
  needsReconnect: boolean;
  connectionKind?: "github_app" | "oauth";
  compact?: boolean;
  onRefresh: () => void;
  onAwaitingChange: (awaiting: boolean) => void;
};

function reconnectHint(reconnectMessage?: string): string {
  return (
    reconnectMessage ??
    "GitHub App is still installed on GitHub. In the new tab, open installation settings and click Save to finish reconnecting, then return here and click Refresh."
  );
}

export function GitHubConnectHandoff({
  connected,
  installed,
  needsReconnect,
  connectionKind,
  compact,
  onRefresh,
  onAwaitingChange
}: GitHubConnectHandoffProps) {
  const [connecting, setConnecting] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [oauthAvailable, setOauthAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectHint, setConnectHint] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);

  useEffect(() => {
    setHandoffPending(isGithubHandoffPending());
  }, []);

  useEffect(() => {
    if (connected) {
      clearGithubHandoffPending();
      setHandoffPending(false);
      setConnectHint(null);
    }
  }, [connected]);

  useEffect(() => {
    onAwaitingChange(handoffPending && !connected);
  }, [handoffPending, connected, onAwaitingChange]);

  const loadInstallUrl = useCallback(async (mode?: "app" | "oauth") => {
    const result = await fetchInstallUrl("github", mode ? { mode } : undefined);
    if (result.data?.oauthAvailable != null) {
      setOauthAvailable(Boolean(result.data.oauthAvailable));
    }
    return result;
  }, []);

  const handleRelinkSuccess = useCallback(
    (relinked?: boolean) => {
      setSuccessMessage(
        relinked
          ? "GitHub reconnected automatically — no GitHub login required."
          : "GitHub connected."
      );
      setConnectHint(null);
      setHandoffPending(false);
      clearGithubHandoffPending();
      onRefresh();
    },
    [onRefresh]
  );

  useEffect(() => {
    if (connected) {
      return;
    }
    void (async () => {
      const result = await loadInstallUrl("app");
      if (result.ok && result.data?.connected) {
        handleRelinkSuccess(result.data.relinked);
      }
    })();
  }, [connected, loadInstallUrl, handleRelinkSuccess]);

  async function handleConnectApp() {
    setConnecting(true);
    setError(null);
    setConnectHint(null);
    setSuccessMessage(null);
    const result = await loadInstallUrl("app");
    setConnecting(false);
    if (!result.ok) {
      setError(formatIntegrationError("github", result.status, result.error));
      return;
    }
    if (result.data?.connected) {
      handleRelinkSuccess(result.data.relinked);
      return;
    }
    if (!result.data?.url) {
      setError("Install URL missing.");
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
    markGithubHandoffPending();
    setHandoffPending(true);
    setConnectHint(
      result.data.reconnect
        ? "GitHub App is still installed on GitHub. Click Connect again after returning here — Coop may reconnect automatically. If a GitHub tab opens, use Configure → Save on your company org (not personal)."
        : "On GitHub, pick your company organization on the first screen (not your personal account). After install, return here — status updates automatically."
    );
  }

  async function handlePrepareHandoff() {
    setConnecting(true);
    setError(null);
    setConnectHint(null);
    setSuccessMessage(null);
    const result = await loadInstallUrl("app");
    setConnecting(false);
    if (!result.ok) {
      setError(formatIntegrationError("github", result.status, result.error));
      return;
    }
    if (result.data?.connected) {
      handleRelinkSuccess(result.data.relinked);
      return;
    }
    if (!result.data?.url) {
      setError("Install URL missing.");
      return;
    }
    setHandoffUrl(result.data.url);
    setHandoffOpen(true);
    markGithubHandoffPending();
    setHandoffPending(true);
    if (result.data.reconnect) {
      setConnectHint(reconnectHint(result.data.reconnectMessage));
    }
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

  async function handleOAuthConnect() {
    setConnecting(true);
    setError(null);
    setConnectHint(null);
    setSuccessMessage(null);
    const result = await loadInstallUrl("oauth");
    setConnecting(false);
    if (!result.ok) {
      setError(formatIntegrationError("github", result.status, result.error));
      return;
    }
    if (!result.data?.url) {
      setError("OAuth URL missing.");
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
    setHandoffPending(true);
  }

  if (connected) {
    if (connectionKind === "oauth") {
      return (
        <p className="mt-2 text-xs text-coop-muted">
          Connected via personal OAuth — indexes repos your account can read, not full org estate.
        </p>
      );
    }
    return null;
  }

  if (installed && needsReconnect) {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-xs text-coop-muted">
          GitHub App is linked to your organization, but the last health check did not pass. Click{" "}
          <span className="text-white/90">Reconnect</span> below — if repos appear under Indexing,
          the connection is working.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="admin-btn-primary"
            onClick={() => void handleConnectApp()}
            disabled={connecting}
          >
            {connecting ? "Opening…" : "Reconnect (GitHub App)"}
          </button>
        </div>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <GitHubOrgInstallChecklist compact={compact} />

      {handoffPending && !connected ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge connected={false} label="Waiting for GitHub" showWhenDisconnected />
          <span className="text-xs text-coop-muted">
            Finish in the GitHub tab (click Save if the app is already installed), then click Refresh here.
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="admin-btn-primary"
          onClick={() => void handleConnectApp()}
          disabled={connecting}
        >
          {connecting ? "Opening…" : needsReconnect ? "Reconnect (GitHub App)" : "Connect (GitHub App)"}
        </button>
        <button
          type="button"
          className="admin-btn-secondary"
          onClick={() => void handlePrepareHandoff()}
          disabled={connecting}
        >
          Send link to GitHub admin
        </button>
        {oauthAvailable ? (
          <button
            type="button"
            className="admin-btn-secondary"
            onClick={() => void handleOAuthConnect()}
            disabled={connecting}
            title="Indexes repos your GitHub user can read — not full org estate"
          >
            Limited connect (OAuth)
          </button>
        ) : null}
      </div>

      {handoffOpen && handoffUrl ? (
        <div className="space-y-2 rounded-lg border border-coop-border/60 bg-black/20 p-3">
          <p className="text-xs font-medium text-white">Send this link to your GitHub organization owner</p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-coop-muted">
            <li>They open the link while signed into GitHub.</li>
            <li>Choose your <span className="text-white/90">company organization</span> — not a personal account.</li>
            <li>Select repositories (or all), then click Install — or click Save if already installed.</li>
            <li>You return here — GitHub shows Connected when done.</li>
          </ol>
          <textarea
            readOnly
            className="admin-input min-h-[4.5rem] w-full font-mono text-xs"
            value={handoffUrl}
            rows={3}
            aria-label="GitHub App install link"
          />
          <button type="button" className="admin-btn-secondary text-sm" onClick={() => void handleCopyHandoffLink()}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}

      {oauthAvailable ? (
        <p className="text-xs text-coop-muted">
          <span className="text-white/80">Limited connect (OAuth)</span> — fallback if your GitHub org owner
          cannot install the app. Indexes repos <span className="text-white/80">you</span> can read
          (collaborator + org member), not the full company estate. Tokens may need reconnect periodically.
        </p>
      ) : null}

      {successMessage ? <p className="text-xs text-coop-index">{successMessage}</p> : null}

      {connectHint ? <p className="text-xs text-coop-index">{connectHint}</p> : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

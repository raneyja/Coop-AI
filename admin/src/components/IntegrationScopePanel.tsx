"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntegrationProvider, SlackScopeChannel } from "@/lib/integrations";
import {
  fetchIntegrationResources,
  fetchIntegrationScope,
  saveIntegrationScope,
  testIntegrationScope
} from "@/lib/coopApi";

type IntegrationScopePanelProps = {
  provider: IntegrationProvider;
  orgPlan: string;
  connected: boolean;
  onSaved: () => void;
};

const SCOPED_COLLABORATION: IntegrationProvider[] = ["slack", "atlassian", "notion", "google-docs"];

export function IntegrationScopePanel({
  provider,
  orgPlan,
  connected,
  onSaved
}: IntegrationScopePanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SlackScopeChannel[]>([]);
  const [resources, setResources] = useState<SlackScopeChannel[]>([]);
  const [scopeStatus, setScopeStatus] = useState<"none" | "required" | "active">("none");
  const [summary, setSummary] = useState<string | undefined>();

  const scopeSupported = provider === "slack";
  const scopeComingSoon = SCOPED_COLLABORATION.includes(provider) && !scopeSupported;
  const enterprise = orgPlan === "enterprise";

  const loadScope = useCallback(async () => {
    if (!connected || !scopeSupported) {
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchIntegrationScope(provider);
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not load scope.");
      return;
    }
    setScopeStatus(result.data.scopeStatus);
    setSummary(result.data.summary);
    const policy = result.data.policy;
    if (policy && typeof policy === "object" && Array.isArray((policy as { channels?: unknown }).channels)) {
      setSelected(
        (policy as { channels: SlackScopeChannel[] }).channels.map((channel) => ({
          id: channel.id,
          name: channel.name
        }))
      );
    } else {
      setSelected([]);
    }
  }, [connected, provider, scopeSupported]);

  const loadResources = useCallback(async () => {
    if (!scopeSupported || !open) {
      return;
    }
    const result = await fetchIntegrationResources(provider, search);
    if (!result.ok) {
      setError(result.error ?? "Could not load channels.");
      return;
    }
    setResources(
      (result.data?.resources ?? []).map((resource) => ({
        id: resource.id,
        name: resource.name
      }))
    );
  }, [open, provider, scopeSupported, search]);

  useEffect(() => {
    void loadScope();
  }, [loadScope]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = setTimeout(() => {
      void loadResources();
    }, 200);
    return () => clearTimeout(timer);
  }, [open, loadResources]);

  const selectedIds = useMemo(() => new Set(selected.map((channel) => channel.id)), [selected]);

  function toggleChannel(channel: SlackScopeChannel) {
    setSelected((current) => {
      if (current.some((entry) => entry.id === channel.id)) {
        return current.filter((entry) => entry.id !== channel.id);
      }
      return [...current, channel].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const result = await saveIntegrationScope(provider, {
      version: 1,
      mode: "allowlist",
      channels: selected
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save scope.");
      return;
    }
    setScopeStatus(result.data?.scopeStatus ?? "active");
    setSummary(result.data?.summary);
    setMessage("Access scope saved.");
    onSaved();
  }

  async function handleTest() {
    setTesting(true);
    setError(null);
    setMessage(null);
    const result = await testIntegrationScope(provider);
    setTesting(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Test failed.");
      return;
    }
    setMessage(result.data.message);
    if (!result.data.ok) {
      setError(result.data.message);
      setMessage(null);
    }
  }

  if (!connected || scopeComingSoon) {
    if (!connected || !scopeComingSoon) {
      return null;
    }
    return (
      <p className="mt-2 text-xs text-coop-muted">
        Scope configuration coming soon. Coop will let admins choose which projects, spaces, or folders
        are searchable.
      </p>
    );
  }

  if (!enterprise) {
    return (
      <p className="mt-2 text-xs text-coop-muted">
        Integration scope governance is available on Enterprise. Coop searches only what admins select — not
        your entire workspace.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-coop-border/50 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">Manage access</p>
          <p className="mt-1 text-xs text-coop-muted">
            Coop searches only what you select — not your entire workspace.
          </p>
          {summary ? <p className="mt-1 text-xs text-coop-index">{summary}</p> : null}
          {scopeStatus === "required" ? (
            <p className="mt-1 text-xs text-amber-300">Scope required before Slack context is used in chat.</p>
          ) : null}
        </div>
        <button type="button" className="admin-btn-secondary" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Manage access"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-3">
          <input
            type="search"
            className="admin-input w-full"
            placeholder="Search channels…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {loading ? <p className="text-xs text-coop-muted">Loading scope…</p> : null}
          <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-coop-border/40 p-2">
            {resources.length === 0 ? (
              <p className="text-xs text-coop-muted">
                {loading ? "Loading channels…" : "No channels found. Reconnect Slack if this stays empty."}
              </p>
            ) : (
              resources.map((channel) => (
                <label
                  key={channel.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-white/90 hover:bg-white/[0.04]"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(channel.id)}
                    onChange={() => toggleChannel(channel)}
                  />
                  <span>#{channel.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => void handleSave()}
              disabled={saving || selected.length === 0}
            >
              {saving ? "Saving…" : "Save scope"}
            </button>
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => void handleTest()}
              disabled={testing}
            >
              {testing ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className="mt-2 text-xs text-coop-index">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

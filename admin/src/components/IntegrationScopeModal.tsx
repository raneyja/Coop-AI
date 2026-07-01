"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AtlassianScopePolicy,
  GoogleDocsScopePolicy,
  IntegrationProvider,
  NotionScopePolicy,
  ScopableProvider,
  SlackScopeChannel,
  SlackScopePolicy
} from "@/lib/integrations";
import {
  fetchIntegrationResources,
  fetchIntegrationScope,
  saveIntegrationScope,
  testIntegrationScope
} from "@/lib/coopApi";
import { formatIntegrationError } from "@/lib/integrationErrors";

type IntegrationScopeModalProps = {
  open: boolean;
  onClose: () => void;
  provider: IntegrationProvider;
  providerName: string;
  connected: boolean;
  onSaved: () => void;
};

type ScopeItem = {
  id: string;
  name: string;
  key?: string;
  type?: string;
  kind?: string;
};

const SCOPE_UI: Record<
  ScopableProvider,
  {
    title: string;
    description: string;
    searchPlaceholder: string;
    emptyHint: string;
    itemPrefix: (item: ScopeItem) => string;
    itemSuffix: (item: ScopeItem) => string;
  }
> = {
  slack: {
    title: "Manage Slack access",
    description: "Choose which channels Coop can search — not your entire workspace.",
    searchPlaceholder: "Search channels…",
    emptyHint: "No channels found. Disconnect and reconnect Slack if this stays empty.",
    itemPrefix: () => "#",
    itemSuffix: () => ""
  },
  atlassian: {
    title: "Manage Jira & Confluence access",
    description: "Choose which Jira projects and Confluence spaces Coop can search.",
    searchPlaceholder: "Search projects or spaces…",
    emptyHint: "No projects or spaces found.",
    itemPrefix: (item) => (item.key ? `${item.key} · ` : ""),
    itemSuffix: () => ""
  },
  notion: {
    title: "Manage Notion access",
    description: "Choose which pages and databases Coop can search.",
    searchPlaceholder: "Search pages and databases…",
    emptyHint: "No pages or databases found.",
    itemPrefix: () => "",
    itemSuffix: (item) => (item.type ? ` (${item.type})` : "")
  },
  "google-docs": {
    title: "Manage Google Docs access",
    description: "Choose which folders and shared drives Coop can search.",
    searchPlaceholder: "Search folders…",
    emptyHint: "No folders or shared drives found.",
    itemPrefix: () => "",
    itemSuffix: (item) => (item.kind === "shared_drive" ? " · Shared drive" : "")
  }
};

export function IntegrationScopeModal({
  open,
  onClose,
  provider,
  providerName,
  connected,
  onSaved
}: IntegrationScopeModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [atlassianTab, setAtlassianTab] = useState<"jira" | "confluence">("jira");
  const [selectedSlack, setSelectedSlack] = useState<SlackScopeChannel[]>([]);
  const [selectedJira, setSelectedJira] = useState<ScopeItem[]>([]);
  const [selectedConfluence, setSelectedConfluence] = useState<ScopeItem[]>([]);
  const [selectedNotion, setSelectedNotion] = useState<ScopeItem[]>([]);
  const [selectedGoogle, setSelectedGoogle] = useState<ScopeItem[]>([]);
  const [resources, setResources] = useState<ScopeItem[]>([]);
  const [summary, setSummary] = useState<string | undefined>();

  const config = SCOPE_UI[provider as ScopableProvider];
  const scopableProvider = provider as ScopableProvider;

  const selectedCount = useMemo(() => {
    switch (scopableProvider) {
      case "slack":
        return selectedSlack.length;
      case "atlassian":
        return selectedJira.length + selectedConfluence.length;
      case "notion":
        return selectedNotion.length;
      case "google-docs":
        return selectedGoogle.length;
      default:
        return 0;
    }
  }, [scopableProvider, selectedSlack, selectedJira, selectedConfluence, selectedNotion, selectedGoogle]);

  const selectedIds = useMemo(() => {
    if (scopableProvider === "slack") {
      return new Set(selectedSlack.map((item) => item.id));
    }
    if (scopableProvider === "atlassian") {
      const tabItems = atlassianTab === "jira" ? selectedJira : selectedConfluence;
      return new Set(tabItems.map((item) => item.id));
    }
    if (scopableProvider === "notion") {
      return new Set(selectedNotion.map((item) => item.id));
    }
    return new Set(selectedGoogle.map((item) => item.id));
  }, [
    scopableProvider,
    atlassianTab,
    selectedSlack,
    selectedJira,
    selectedConfluence,
    selectedNotion,
    selectedGoogle
  ]);

  const loadScope = useCallback(async () => {
    if (!connected) {
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
    setSummary(result.data.summary);
    const policy = result.data.policy;
    if (!policy || typeof policy !== "object") {
      return;
    }

    if (scopableProvider === "slack" && Array.isArray((policy as SlackScopePolicy).channels)) {
      setSelectedSlack(
        (policy as SlackScopePolicy).channels.map((channel) => ({
          id: channel.id,
          name: channel.name
        }))
      );
      return;
    }

    if (scopableProvider === "atlassian") {
      const atlassianPolicy = policy as AtlassianScopePolicy;
      setSelectedJira(
        (atlassianPolicy.jiraProjects ?? []).map((project) => ({
          id: project.id,
          name: project.name,
          key: project.key
        }))
      );
      setSelectedConfluence(
        (atlassianPolicy.confluenceSpaces ?? []).map((space) => ({
          id: space.id,
          name: space.name,
          key: space.key
        }))
      );
      return;
    }

    if (scopableProvider === "notion" && Array.isArray((policy as NotionScopePolicy).resources)) {
      setSelectedNotion(
        (policy as NotionScopePolicy).resources.map((resource) => ({
          id: resource.id,
          name: resource.title,
          type: resource.type
        }))
      );
      return;
    }

    if (scopableProvider === "google-docs" && Array.isArray((policy as GoogleDocsScopePolicy).folders)) {
      setSelectedGoogle(
        (policy as GoogleDocsScopePolicy).folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          kind: folder.kind
        }))
      );
    }
  }, [connected, provider, scopableProvider]);

  const loadResources = useCallback(async () => {
    if (!open || !connected) {
      return;
    }
    const product = scopableProvider === "atlassian" ? atlassianTab : undefined;
    const result = await fetchIntegrationResources(provider, search, product);
    if (!result.ok) {
      setError(formatIntegrationError(provider, result.status, result.error));
      return;
    }
    setError(null);
    setResources(
      (result.data?.resources ?? []).map((resource) => ({
        id: resource.id,
        name: resource.name,
        key: resource.key,
        type: resource.type,
        kind: resource.kind
      }))
    );
  }, [open, connected, provider, scopableProvider, atlassianTab, search]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setError(null);
      setMessage(null);
      setResources([]);
      setAtlassianTab("jira");
      return;
    }
    document.body.style.overflow = "hidden";
    if (connected) {
      void loadScope();
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, connected, loadScope]);

  useEffect(() => {
    if (!open || !connected) {
      return;
    }
    const timer = setTimeout(() => {
      void loadResources();
    }, 200);
    return () => clearTimeout(timer);
  }, [open, connected, loadResources]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving && !testing) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, saving, testing]);

  function toggleItem(item: ScopeItem) {
    if (scopableProvider === "slack") {
      setSelectedSlack((current) => toggleInList(current, item));
      return;
    }
    if (scopableProvider === "atlassian") {
      if (atlassianTab === "jira") {
        setSelectedJira((current) => toggleInList(current, item));
      } else {
        setSelectedConfluence((current) => toggleInList(current, item));
      }
      return;
    }
    if (scopableProvider === "notion") {
      setSelectedNotion((current) => toggleInList(current, item));
      return;
    }
    setSelectedGoogle((current) => toggleInList(current, item));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);

    let policy:
      | SlackScopePolicy
      | AtlassianScopePolicy
      | NotionScopePolicy
      | GoogleDocsScopePolicy;

    if (scopableProvider === "slack") {
      policy = { version: 1, mode: "allowlist", channels: selectedSlack };
    } else if (scopableProvider === "atlassian") {
      policy = {
        version: 1,
        mode: "allowlist",
        jiraProjects: selectedJira.map((item) => ({
          id: item.id,
          key: item.key ?? item.id,
          name: item.name
        })),
        confluenceSpaces: selectedConfluence.map((item) => ({
          id: item.id,
          key: item.key ?? item.id,
          name: item.name
        }))
      };
    } else if (scopableProvider === "notion") {
      policy = {
        version: 1,
        mode: "allowlist",
        resources: selectedNotion.map((item) => ({
          id: item.id,
          title: item.name,
          type: item.type === "database" ? "database" : "page"
        }))
      };
    } else {
      policy = {
        version: 1,
        mode: "allowlist",
        folders: selectedGoogle.map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind === "shared_drive" ? "shared_drive" : "folder"
        }))
      };
    }

    const result = await saveIntegrationScope(provider, policy);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save scope.");
      return;
    }
    setSummary(result.data?.summary);
    setMessage("Access scope saved.");
    onSaved();
    onClose();
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
    if (!result.data.ok) {
      setError(result.data.message);
      return;
    }
    setMessage(result.data.message);
  }

  if (!open || !mounted || !config) {
    return null;
  }

  const busy = saving || testing;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div
        className="relative flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-coop-border bg-coop-dark shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-scope-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-coop-border/40 px-5 py-4">
          <h2 id="integration-scope-title" className="text-lg font-semibold text-white">
            {config.title}
          </h2>
          <p className="mt-1 text-sm text-coop-muted">{config.description}</p>
          {summary ? <p className="mt-1 text-xs text-coop-index">{summary}</p> : null}
          {scopableProvider === "atlassian" ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className={atlassianTab === "jira" ? "admin-btn-primary" : "admin-btn-secondary"}
                onClick={() => setAtlassianTab("jira")}
              >
                Jira ({selectedJira.length})
              </button>
              <button
                type="button"
                className={
                  atlassianTab === "confluence" ? "admin-btn-primary" : "admin-btn-secondary"
                }
                onClick={() => setAtlassianTab("confluence")}
              >
                Confluence ({selectedConfluence.length})
              </button>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!connected ? (
            <p className="text-sm text-coop-muted">Connect {providerName} before managing access.</p>
          ) : (
            <div className="space-y-3">
              <input
                type="search"
                className="admin-input w-full"
                placeholder={config.searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {loading ? <p className="text-xs text-coop-muted">Loading saved scope…</p> : null}
              <ul className="space-y-1">
                {resources.length === 0 ? (
                  <li className="text-xs text-coop-muted">
                    {loading ? "Loading…" : config.emptyHint}
                  </li>
                ) : (
                  resources.map((item) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-white/90 hover:bg-white/[0.04]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-coop-index"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleItem(item)}
                          disabled={busy}
                        />
                        <span>
                          {config.itemPrefix(item)}
                          {item.name}
                          {config.itemSuffix(item)}
                        </span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
              {message ? <p className="text-xs text-coop-index">{message}</p> : null}
              {error ? <p className="text-xs text-red-400">{error}</p> : null}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-coop-border/40 px-5 py-4">
          <p className="text-xs text-coop-muted">{selectedCount} selected</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="admin-btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {connected ? (
              <>
                <button
                  type="button"
                  className="admin-btn-secondary"
                  onClick={() => void handleTest()}
                  disabled={busy}
                >
                  {testing ? "Testing…" : "Test"}
                </button>
                <button
                  type="button"
                  className="admin-btn-primary"
                  onClick={() => void handleSave()}
                  disabled={busy || selectedCount === 0}
                >
                  {saving ? "Saving…" : "Save access"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function toggleInList(current: ScopeItem[], item: ScopeItem): ScopeItem[] {
  if (current.some((entry) => entry.id === item.id)) {
    return current.filter((entry) => entry.id !== item.id);
  }
  return [...current, item].sort((a, b) => a.name.localeCompare(b.name));
}

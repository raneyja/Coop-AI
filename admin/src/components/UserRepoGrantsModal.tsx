"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fetchOrgRepos, fetchUserRepoGrants, saveUserRepoGrants, type OrgRepoRecord } from "@/lib/coopApi";
import { shortRepoName } from "@/lib/indexingProgress";

type UserRepoGrantsModalProps = {
  open: boolean;
  userId: string;
  userEmail: string;
  onClose: () => void;
  onSaved: () => void;
};

export function UserRepoGrantsModal({
  open,
  userId,
  userEmail,
  onClose,
  onSaved
}: UserRepoGrantsModalProps): React.ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<OrgRepoRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const indexedRepos = useMemo(
    () => repos.filter((repo) => repo.lightningEnabled && repo.indexStatus !== "disabled"),
    [repos]
  );

  const filteredRepos = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return indexedRepos;
    }
    return indexedRepos.filter((repo) => shortRepoName(repo.repoId).toLowerCase().includes(needle));
  }, [indexedRepos, query]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(null);
      return;
    }
    document.body.style.overflow = "hidden";
    void load();
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, userId]);

  async function load() {
    setLoading(true);
    setError(null);
    const [reposResult, grantsResult] = await Promise.all([fetchOrgRepos(), fetchUserRepoGrants(userId)]);
    setLoading(false);
    if (!reposResult.ok) {
      setError(reposResult.error ?? "Failed to load repositories.");
      return;
    }
    setRepos(reposResult.data?.repos ?? []);
    if (!grantsResult.ok) {
      setError(grantsResult.error ?? "Failed to load repo access.");
      setSelected(new Set());
      return;
    }
    setSelected(new Set(grantsResult.data?.repoIds ?? []));
  }

  function toggleRepo(repoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await saveUserRepoGrants(userId, Array.from(selected));
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save repo access.");
      return;
    }
    onSaved();
    onClose();
  }

  if (!open || !mounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => {
        if (!saving) {
          onClose();
        }
      }}
    >
      <div
        className="relative flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-coop-border bg-coop-dark shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-repo-grants-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-coop-border/40 px-5 py-4">
          <h2 id="user-repo-grants-title" className="text-lg font-semibold text-white">
            Repository access
          </h2>
          <p className="mt-1 text-sm text-coop-muted">
            {userEmail} — select which Deep-Indexed repos this user can access in VS Code.
          </p>
        </div>

        <div className="shrink-0 border-b border-coop-border/40 px-5 py-3">
          <input
            type="search"
            className="admin-input w-full"
            placeholder="Search repositories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading || saving}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-coop-muted">Loading repositories…</p>
          ) : indexedRepos.length === 0 ? (
            <p className="text-sm text-coop-muted">
              No Deep-Indexed repos yet. Choose repos on the Indexing page first.
            </p>
          ) : filteredRepos.length === 0 ? (
            <p className="text-sm text-coop-muted">No repositories match your search.</p>
          ) : (
            <ul className="space-y-2">
              {filteredRepos.map((repo) => (
                <li key={repo.repoId}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2.5 hover:border-coop-border/40 hover:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-coop-index"
                      checked={selected.has(repo.repoId)}
                      disabled={saving}
                      onChange={() => toggleRepo(repo.repoId)}
                    />
                    <span className="font-mono text-sm text-white">{shortRepoName(repo.repoId)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-coop-border/40 px-5 py-4">
          <p className="text-xs text-coop-muted">{selected.size} repo{selected.size === 1 ? "" : "s"} selected</p>
          <div className="flex gap-2">
            <button type="button" className="admin-btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => void handleSave()}
              disabled={saving || loading}
            >
              {saving ? "Saving…" : "Save access"}
            </button>
          </div>
        </div>

        {error ? <p className="shrink-0 px-5 pb-4 text-xs text-red-400">{error}</p> : null}
      </div>
    </div>,
    document.body
  );
}

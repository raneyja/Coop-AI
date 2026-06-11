"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  addRepoToCollection,
  createCollection,
  fetchCollections,
  fetchOrgRepos,
  removeRepoFromCollection,
  type AdminCollection,
  type OrgRepoRecord
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";

function lightningLabel(repo: OrgRepoRecord): string {
  if (!repo.lightningEnabled) {
    return "Lightning off";
  }
  const status = repo.indexStatus ?? "idle";
  return `Lightning ${status}`;
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<AdminCollection[]>([]);
  const [repos, setRepos] = useState<OrgRepoRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [repoToAdd, setRepoToAdd] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId),
    [collections, selectedCollectionId]
  );

  const availableRepos = useMemo(() => {
    const memberIds = new Set(selectedCollection?.repos.map((entry) => entry.repoId) ?? []);
    return repos.filter((repo) => !memberIds.has(repo.repoId));
  }, [repos, selectedCollection]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [collectionsResult, reposResult] = await Promise.all([fetchCollections(), fetchOrgRepos()]);
    setLoading(false);

    if (collectionsResult.unavailable || reposResult.unavailable) {
      setUnavailable(true);
      setCollections([]);
      setRepos([]);
      return;
    }

    setUnavailable(false);
    if (!collectionsResult.ok) {
      setError(collectionsResult.error ?? "Failed to load collections.");
      return;
    }
    if (!reposResult.ok) {
      setError(reposResult.error ?? "Failed to load repositories.");
      return;
    }

    const nextCollections = collectionsResult.data?.collections ?? [];
    setCollections(nextCollections);
    setRepos(reposResult.data?.repos ?? []);
    setSelectedCollectionId((current) => current || nextCollections[0]?.id || "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Collection name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    const result = await createCollection(trimmed, description.trim() || undefined);
    setCreating(false);
    if (!result.ok || !result.data?.collection) {
      setError(result.error ?? "Failed to create collection.");
      return;
    }
    setName("");
    setDescription("");
    setSelectedCollectionId(result.data.collection.id);
    void load();
  }

  async function handleAddRepo() {
    if (!selectedCollectionId || !repoToAdd) {
      return;
    }
    setActionId(`add:${repoToAdd}`);
    const result = await addRepoToCollection(selectedCollectionId, repoToAdd);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Failed to add repository.");
      return;
    }
    setRepoToAdd("");
    void load();
  }

  async function handleRemoveRepo(repoId: string) {
    if (!selectedCollectionId) {
      return;
    }
    setActionId(`remove:${repoId}`);
    const result = await removeRepoFromCollection(selectedCollectionId, repoId);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Failed to remove repository.");
      return;
    }
    void load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Collections</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Group indexed repositories for cross-repo Lightning search and chat @ mentions.
        </p>
      </div>

      {unavailable && <UnavailableBanner />}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <form onSubmit={handleCreate} className="admin-card space-y-3">
        <h2 className="text-sm font-medium">Create collection</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-coop-muted">Name</span>
            <input
              className="mt-1 w-full rounded-sm border border-coop-border bg-coop-dark px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Platform team"
            />
          </label>
          <label className="block text-sm">
            <span className="text-coop-muted">Description (optional)</span>
            <input
              className="mt-1 w-full rounded-sm border border-coop-border bg-coop-dark px-3 py-2"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Core services repos"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-sm border border-coop-border px-3 py-1.5 text-sm hover:bg-white/[0.04] disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create collection"}
        </button>
      </form>

      <div className="admin-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Collections</h2>
          {collections.length > 0 ? (
            <select
              className="rounded-sm border border-coop-border bg-coop-dark px-3 py-1.5 text-sm"
              value={selectedCollectionId}
              onChange={(event) => setSelectedCollectionId(event.target.value)}
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-coop-muted">Loading…</p>
        ) : collections.length === 0 ? (
          <p className="text-sm text-coop-muted">No collections yet. Create one above.</p>
        ) : selectedCollection ? (
          <>
            {selectedCollection.description ? (
              <p className="text-sm text-coop-muted">{selectedCollection.description}</p>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">
                <span className="text-coop-muted">Add repository</span>
                <select
                  className="mt-1 min-w-[280px] rounded-sm border border-coop-border bg-coop-dark px-3 py-2"
                  value={repoToAdd}
                  onChange={(event) => setRepoToAdd(event.target.value)}
                >
                  <option value="">Select repo…</option>
                  {availableRepos.map((repo) => (
                    <option key={repo.repoId} value={repo.repoId}>
                      {repo.repoId} — {lightningLabel(repo)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!repoToAdd || actionId !== null}
                onClick={() => void handleAddRepo()}
                className="rounded-sm border border-coop-border px-3 py-2 text-sm hover:bg-white/[0.04] disabled:opacity-50"
              >
                Add repo
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-coop-border text-coop-muted">
                    <th className="py-2 pr-4 font-medium">Repository</th>
                    <th className="py-2 pr-4 font-medium">Lightning</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {selectedCollection.repos.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-3 text-coop-muted">
                        No repositories in this collection.
                      </td>
                    </tr>
                  ) : (
                    selectedCollection.repos.map((entry) => {
                      const repo = repos.find((item) => item.repoId === entry.repoId);
                      return (
                        <tr key={entry.repoId} className="border-b border-coop-border/60">
                          <td className="py-2 pr-4 font-mono text-xs">{entry.repoId}</td>
                          <td className="py-2 pr-4 text-coop-muted">
                            {repo ? lightningLabel(repo) : "Unknown"}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              disabled={actionId !== null}
                              onClick={() => void handleRemoveRepo(entry.repoId)}
                              className="text-xs text-coop-muted hover:text-white"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      <div className="admin-card">
        <h2 className="mb-3 text-sm font-medium">Organization repositories</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-coop-border text-coop-muted">
                <th className="py-2 pr-4 font-medium">Repository</th>
                <th className="py-2 font-medium">Lightning status</th>
              </tr>
            </thead>
            <tbody>
              {repos.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-3 text-coop-muted">
                    No repositories registered yet. Enable Lightning from the VS Code extension.
                  </td>
                </tr>
              ) : (
                repos.map((repo) => (
                  <tr key={repo.repoId} className="border-b border-coop-border/60">
                    <td className="py-2 pr-4 font-mono text-xs">{repo.repoId}</td>
                    <td className="py-2 text-coop-muted">{lightningLabel(repo)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

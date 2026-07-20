"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addRepoToCollection,
  createCollection,
  fetchCollections,
  fetchOrg,
  fetchOrgRepos,
  isOrgSuspendedResult,
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
  const router = useRouter();
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
    const [collectionsResult, reposResult, orgResult] = await Promise.all([
      fetchCollections(),
      fetchOrgRepos(),
      fetchOrg()
    ]);
    setLoading(false);

    if (orgResult.ok && orgResult.data?.plan === "free") {
      router.replace("/");
      return;
    }

    if (collectionsResult.unavailable || reposResult.unavailable) {
      setUnavailable(true);
      setCollections([]);
      setRepos([]);
      return;
    }

    setUnavailable(false);
    if (!collectionsResult.ok) {
      if (!isOrgSuspendedResult(collectionsResult)) {
        setError(collectionsResult.error ?? "Failed to load collections.");
      }
      return;
    }
    if (!reposResult.ok) {
      if (!isOrgSuspendedResult(reposResult)) {
        setError(reposResult.error ?? "Failed to load repositories.");
      }
      return;
    }

    const nextCollections = collectionsResult.data?.collections ?? [];
    setCollections(nextCollections);
    setRepos(reposResult.data?.repos ?? []);
    setSelectedCollectionId((current) => current || nextCollections[0]?.id || "");
  }, [router]);

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
        <h1 className="admin-page-title">Collections</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Group indexed repositories for cross-repo Lightning search and chat @ mentions.
        </p>
      </div>

      {unavailable && <UnavailableBanner />}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <form onSubmit={handleCreate} className="admin-card">
        <h2 className="admin-section-label">Create collection</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="admin-label !mb-1">Name</span>
            <input
              className="admin-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Platform team"
            />
          </label>
          <label className="block text-sm">
            <span className="admin-label !mb-1">Description (optional)</span>
            <input
              className="admin-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Core services repos"
            />
          </label>
        </div>
        <button type="submit" disabled={creating} className="admin-btn-secondary">
          {creating ? "Creating…" : "Create collection"}
        </button>
      </form>

      <section className="admin-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="admin-section-label">Collections</h2>
          {collections.length > 0 ? (
            <select
              className="admin-input !w-auto py-1.5"
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
                <span className="admin-label !mb-1">Add repository</span>
                <select
                  className="admin-input !w-auto min-w-[280px] py-2"
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
                className="admin-btn-secondary"
              >
                Add repo
              </button>
            </div>
            <div className="admin-card--table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Lightning</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {selectedCollection.repos.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-coop-muted">
                        No repositories in this collection.
                      </td>
                    </tr>
                  ) : (
                    selectedCollection.repos.map((entry) => {
                      const repo = repos.find((item) => item.repoId === entry.repoId);
                      return (
                        <tr key={entry.repoId}>
                          <td className="font-mono text-xs">{entry.repoId}</td>
                          <td className="text-coop-muted">
                            {repo ? lightningLabel(repo) : "Unknown"}
                          </td>
                          <td className="text-right">
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
      </section>

      <section className="admin-card">
        <h2 className="admin-section-label">Organization repositories</h2>
        <div className="admin-card--table mt-4 !border-b-0">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Lightning status</th>
              </tr>
            </thead>
            <tbody>
              {repos.length === 0 ? (
                <tr>
                  <td colSpan={2} className="text-coop-muted">
                    No repositories registered yet. Enable Lightning from the VS Code extension.
                  </td>
                </tr>
              ) : (
                repos.map((repo) => (
                  <tr key={repo.repoId}>
                    <td className="font-mono text-xs">{repo.repoId}</td>
                    <td className="text-coop-muted">{lightningLabel(repo)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

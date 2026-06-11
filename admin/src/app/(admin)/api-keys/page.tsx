"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
  type AdminApiKey
} from "@/lib/coopApi";
import { Modal } from "@/components/Modal";
import { UnavailableBanner } from "@/components/UnavailableBanner";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<AdminApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [newKeyModal, setNewKeyModal] = useState<{ rawKey: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchApiKeys();
    setLoading(false);
    if (result.unavailable) {
      setUnavailable(true);
      setKeys([]);
      return;
    }
    setUnavailable(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load API keys.");
      return;
    }
    setKeys(result.data?.keys ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const result = await createApiKey(label.trim() || "API key");
    setCreating(false);
    if (!result.ok || !result.data?.rawKey) {
      setError(result.error ?? "Failed to create key.");
      return;
    }
    setLabel("");
    setNewKeyModal({ rawKey: result.data.rawKey, label: result.data.key.label });
    void load();
  }

  async function handleRevoke(keyId: string) {
    if (!confirm("Revoke this API key? Applications using it will stop working.")) return;
    setRevokingId(keyId);
    const result = await revokeApiKey(keyId);
    setRevokingId(null);
    if (!result.ok) {
      setError(result.error ?? "Failed to revoke key.");
      return;
    }
    void load();
  }

  async function copyKey() {
    if (!newKeyModal) return;
    await navigator.clipboard.writeText(newKeyModal.rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatDate(iso?: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Create keys for automation and service accounts. Raw keys are shown once at creation.
        </p>
      </div>

      {unavailable && <UnavailableBanner />}

      <form onSubmit={handleCreate} className="admin-card flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="keyLabel" className="admin-label">
            Label
          </label>
          <input
            id="keyLabel"
            type="text"
            className="admin-input"
            placeholder="CI pipeline"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={unavailable}
          />
        </div>
        <button type="submit" className="admin-btn-primary" disabled={creating || unavailable}>
          {creating ? "Creating…" : "Create key"}
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="admin-card overflow-x-auto p-0">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-coop-muted">
                  {unavailable ? "Key management unavailable until admin API is deployed." : "No API keys yet."}
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.label}</td>
                  <td>{formatDate(key.createdAt)}</td>
                  <td>{formatDate(key.lastUsedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn-danger text-xs"
                      onClick={() => handleRevoke(key.id)}
                      disabled={revokingId === key.id}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(newKeyModal)}
        title="API key created"
        onClose={() => setNewKeyModal(null)}
      >
        <p className="mb-3 text-sm text-coop-muted">
          Copy this key now — you won&apos;t be able to see it again.
        </p>
        <div className="flex gap-2">
          <code className="flex-1 break-all rounded-sm border border-coop-border bg-coop-dark px-3 py-2 font-mono text-xs">
            {newKeyModal?.rawKey}
          </code>
          <button type="button" className="admin-btn-secondary shrink-0" onClick={copyKey}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button
          type="button"
          className="admin-btn-primary mt-4 w-full"
          onClick={() => setNewKeyModal(null)}
        >
          Done
        </button>
      </Modal>
    </div>
  );
}

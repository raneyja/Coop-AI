"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAudit, type AuditEntry } from "@/lib/coopApi";

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    const isInitial = !cursor;
    if (isInitial) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    const result = await fetchAudit(cursor ? { cursor } : undefined);

    if (isInitial) {
      setLoading(false);
    } else {
      setLoadingMore(false);
    }

    if (!result.ok) {
      setError(result.error ?? "Failed to load audit log.");
      return;
    }

    const page = result.data?.entries ?? [];
    setEntries((prev) => (isInitial ? page : [...prev, ...page]));
    setNextCursor(result.data?.nextCursor);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-coop-muted">Recent admin actions in your organization.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="admin-card overflow-x-auto p-0">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-coop-muted">
                  No audit entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-xs text-coop-muted">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="font-mono text-xs">{entry.action}</td>
                  <td className="text-xs text-coop-muted">{entry.principal ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <button
          type="button"
          className="admin-btn-secondary"
          onClick={() => void load(nextCursor)}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

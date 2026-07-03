"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMeAudit, type AuditEntry } from "@/lib/coopApi";

export default function MyActivityPage() {
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

    const result = await fetchMeAudit(cursor ? { cursor } : undefined);

    if (isInitial) {
      setLoading(false);
    } else {
      setLoadingMore(false);
    }

    if (!result.ok) {
      setError(result.error ?? "Failed to load activity log.");
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
        <h1 className="admin-page-title">My Activity</h1>
        <p className="mt-1 text-sm text-coop-muted">Your recent actions in Coop.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="admin-card--table">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-8 text-center text-coop-muted">
                  No activity yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-xs text-coop-muted">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="font-mono text-xs">{entry.action}</td>
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

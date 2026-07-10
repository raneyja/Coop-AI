"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchOperatorActivity,
  formatDateTime,
  type OperatorAuditEntry
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";

function formatAction(entry: OperatorAuditEntry): string {
  const meta = entry.metadata ?? {};
  const detail = typeof meta.detail === "string" ? meta.detail : undefined;
  if (detail) return `${entry.action} — ${detail}`;
  return entry.action;
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<OperatorAuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    const isInitial = !cursor;
    if (isInitial) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }

    const result = await fetchOperatorActivity(cursor ? { cursor } : { limit: 50 });

    if (isInitial) {
      setLoading(false);
    } else {
      setLoadingMore(false);
    }

    if (result.unavailable) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);

    if (!result.ok) {
      setError(result.error ?? "Failed to load activity.");
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
        <h1 className="admin-page-title">Operator activity</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Platform-wide audit of operator actions across all customer organizations.
        </p>
      </div>

      {unavailable && <UnavailableBanner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="admin-card--table">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Operator</th>
              <th>Action</th>
              <th>Customer</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-coop-muted">
                  {unavailable ? "Activity feed unavailable until operator API is deployed." : "No operator activity yet."}
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-xs text-coop-muted">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="text-xs">{entry.operatorEmail ?? entry.operatorId ?? "—"}</td>
                  <td className="font-mono text-xs">{formatAction(entry)}</td>
                  <td className="text-xs">
                    {entry.orgId ? (
                      <Link href={`/customers/${entry.orgId}`} className="admin-link">
                        {entry.orgName ?? entry.orgId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
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

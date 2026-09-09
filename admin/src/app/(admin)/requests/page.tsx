"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSeatUpgradeRequests,
  resolveSeatUpgradeRequest,
  type SeatUpgradeRequest
} from "@/lib/coopApi";
import { displayUsageTierName } from "@/lib/planNudge";

type Filter = "pending" | "confirmed" | "denied" | "all";

function statusLabel(status: string | undefined): string {
  if (status === "confirmed") {
    return "Completed";
  }
  if (status === "denied") {
    return "Denied";
  }
  return "Pending";
}

function tierName(value: string): string {
  if (value === "pro_plus" || value === "max" || value === "pro") {
    return displayUsageTierName(value);
  }
  return value;
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<SeatUpgradeRequest[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchSeatUpgradeRequests();
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load requests.");
      return;
    }
    setRequests(result.data?.requests ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }
    const timer = window.setTimeout(() => setSuccessMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  const visible = useMemo(() => {
    if (filter === "all") {
      return requests;
    }
    return requests.filter((request) => (request.status ?? "pending") === filter);
  }, [filter, requests]);

  const pendingCount = requests.filter((request) => (request.status ?? "pending") === "pending").length;

  async function handleAction(requestId: string, action: "confirm" | "deny") {
    setActionId(requestId);
    const result = await resolveSeatUpgradeRequest(requestId, action);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not update that request.");
      return;
    }
    setSuccessMessage(action === "confirm" ? "Seat upgraded. Stripe prorated the change." : "Request denied.");
    void load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Requests</h1>
        <p className="mt-1 text-sm text-coop-muted">
          Seat upgrades members asked for. Confirm charges the company card for that person only.
        </p>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-300">{successMessage}</p> : null}

      <div className="flex flex-wrap gap-2">
        {(["pending", "confirmed", "denied", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "admin-btn-primary text-xs" : "admin-btn-secondary text-xs"}
            onClick={() => setFilter(value)}
          >
            {value === "confirmed" ? "Completed" : value === "all" ? "All" : value === "denied" ? "Denied" : "Pending"}
            {value === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      <div className="admin-card--table">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>From</th>
              <th>To</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-coop-muted">
                  {filter === "pending" ? "No pending upgrade requests." : "Nothing in this view."}
                </td>
              </tr>
            ) : (
              visible.map((request) => {
                const pending = (request.status ?? "pending") === "pending";
                return (
                  <tr key={request.id}>
                    <td>{request.memberEmail ?? request.userId}</td>
                    <td>{tierName(request.fromTier)}</td>
                    <td>{tierName(request.toTier)}</td>
                    <td className="capitalize">{statusLabel(request.status)}</td>
                    <td className="text-coop-muted">
                      {request.createdAt ? new Date(request.createdAt).toLocaleString() : "—"}
                    </td>
                    <td>
                      {pending ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="admin-btn-primary text-xs"
                            disabled={actionId === request.id}
                            onClick={() => void handleAction(request.id, "confirm")}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="admin-btn-secondary text-xs"
                            disabled={actionId === request.id}
                            onClick={() => void handleAction(request.id, "deny")}
                          >
                            Deny
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-coop-muted">
                          {request.resolvedAt ? new Date(request.resolvedAt).toLocaleString() : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

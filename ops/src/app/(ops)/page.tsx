"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAttentionQueue,
  formatDate,
  type AttentionQueue
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";

function AttentionCount({ count }: { count: number }) {
  if (count === 0) {
    return <span className="admin-chip admin-chip--muted">None</span>;
  }
  return <span className="admin-chip admin-chip--warn">{count}</span>;
}

export default function AttentionQueuePage() {
  const [queue, setQueue] = useState<AttentionQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAttentionQueue();
    setLoading(false);
    if (result.unavailable) {
      setUnavailable(true);
      setQueue(null);
      return;
    }
    setUnavailable(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load attention queue.");
      return;
    }
    setQueue(result.data ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSignals =
    (queue?.enterpriseLeads.length ?? 0) +
    (queue?.pastDue.length ?? 0) +
    (queue?.invitePending.length ?? 0) +
    (queue?.indexingErrors.length ?? 0) +
    (queue?.seatOverage.length ?? 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">Attention queue</h1>
          <p className="mt-1 text-sm text-coop-muted">
            Items that need operator follow-up across all customer organizations.
          </p>
        </div>
        <Link href="/customers/new" className="admin-btn-primary">
          Provision customer
        </Link>
      </div>

      {unavailable && <UnavailableBanner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-coop-muted">Loading attention signals…</p>
      ) : (
        <>
          <div className="admin-stat-row">
            <div className="admin-stat">
              <p className="admin-section-label">Total signals</p>
              <p className="mt-1 text-2xl font-semibold text-white">{totalSignals}</p>
            </div>
            <div className="admin-stat">
              <p className="admin-section-label">Enterprise leads</p>
              <p className="mt-1">
                <AttentionCount count={queue?.enterpriseLeads.length ?? 0} />
              </p>
            </div>
            <div className="admin-stat">
              <p className="admin-section-label">Past due</p>
              <p className="mt-1">
                <AttentionCount count={queue?.pastDue.length ?? 0} />
              </p>
            </div>
            <div className="admin-stat">
              <p className="admin-section-label">Stale invites</p>
              <p className="mt-1">
                <AttentionCount count={queue?.invitePending.length ?? 0} />
              </p>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="admin-section-label">Enterprise upgrade requests</h2>
            {queue?.enterpriseLeads.length ? (
              <div className="admin-list">
                {queue.enterpriseLeads.map((lead) => (
                  <div key={lead.id} className="attention-card attention-card--warn">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{lead.orgName}</p>
                        <p className="text-sm text-coop-muted">
                          {lead.name} · {lead.email}
                        </p>
                        {lead.notes ? (
                          <p className="mt-2 text-sm text-white/80">{lead.notes}</p>
                        ) : null}
                      </div>
                      <span className="text-xs text-coop-muted">{formatDate(lead.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-coop-muted">No pending Enterprise leads.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="admin-section-label">Past due billing</h2>
            {queue?.pastDue.length ? (
              <div className="admin-list">
                {queue.pastDue.map((org) => (
                  <div key={org.id} className="admin-list-row flex-wrap justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{org.name}</p>
                      <p className="text-xs text-coop-muted">Follow up on payment · open Stripe from customer detail</p>
                    </div>
                    <Link href={`/customers/${org.id}?focus=billing`} className="admin-btn-secondary shrink-0">
                      Open billing
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-coop-muted">No past-due organizations.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="admin-section-label">Invites pending &gt; 7 days</h2>
            {queue?.invitePending.length ? (
              <div className="admin-list">
                {queue.invitePending.map((item) => (
                  <div
                    key={`${item.orgId}-${item.email}`}
                    className="admin-list-row flex-wrap justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-white">{item.orgName}</p>
                      <p className="text-xs text-coop-muted">{item.email}</p>
                      <p className="mt-1 text-xs text-coop-muted">Next step: resend invite from Users</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="admin-chip admin-chip--warn">{item.daysPending}d pending</span>
                      <Link
                        href={`/customers/${item.orgId}?focus=users`}
                        className="admin-btn-secondary"
                      >
                        Resend invite
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-coop-muted">No stale invites.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="admin-section-label">Indexing errors</h2>
            {queue?.indexingErrors.length ? (
              <div className="admin-list">
                {queue.indexingErrors.map((item) => (
                  <div key={item.orgId} className="admin-list-row flex-wrap justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{item.orgName}</p>
                      <p className="mt-1 text-xs text-coop-muted">
                        Next step: open customer → check GitHub App install / Deep-Index for this repo.
                      </p>
                      {item.lastError ? (
                        <p className="mt-2 break-words text-xs text-coop-muted/90">{item.lastError}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="admin-chip admin-chip--danger">{item.errorCount} errors</span>
                      <Link href={`/customers/${item.orgId}`} className="admin-btn-secondary">
                        Review customer
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-coop-muted">No indexing errors flagged.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="admin-section-label">Seat overage</h2>
            {queue?.seatOverage.length ? (
              <div className="admin-list">
                {queue.seatOverage.map((item) => (
                  <div key={item.orgId} className="admin-list-row flex-wrap justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{item.orgName}</p>
                      <p className="mt-1 text-xs text-coop-muted">
                        Next step: create a Stripe seat-change approval link on billing.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="admin-chip admin-chip--warn">
                        {item.seatsUsed} / {item.seats} seats
                      </span>
                      <Link
                        href={`/customers/${item.orgId}?focus=billing`}
                        className="admin-btn-secondary"
                      >
                        Request seats
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-coop-muted">No seat overages.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

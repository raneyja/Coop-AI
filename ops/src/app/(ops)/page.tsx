"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAttentionQueue,
  formatDate,
  type AttentionQueue,
  type CustomerSummary
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";

function AttentionCount({ count }: { count: number }) {
  if (count === 0) {
    return <span className="admin-chip admin-chip--muted">None</span>;
  }
  return <span className="admin-chip admin-chip--warn">{count}</span>;
}

function CustomerRow({ org }: { org: CustomerSummary }) {
  return (
    <Link href={`/customers/${org.id}`} className="admin-list-row">
      <div className="min-w-0">
        <p className="truncate font-medium text-white">{org.name}</p>
        <p className="truncate text-xs text-coop-muted">{org.adminEmail ?? org.billingEmail ?? org.id}</p>
      </div>
      <span className={org.plan === "enterprise" ? "admin-chip admin-chip--plan-enterprise" : org.plan === "pro" ? "admin-chip admin-chip--plan-pro" : "admin-chip admin-chip--plan-free"}>
        {org.plan}
      </span>
    </Link>
  );
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
                  <CustomerRow key={org.id} org={org} />
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
                  <Link key={`${item.orgId}-${item.email}`} href={`/customers/${item.orgId}`} className="admin-list-row">
                    <div>
                      <p className="font-medium text-white">{item.orgName}</p>
                      <p className="text-xs text-coop-muted">{item.email}</p>
                    </div>
                    <span className="admin-chip admin-chip--warn">{item.daysPending}d pending</span>
                  </Link>
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
                  <Link key={item.orgId} href={`/customers/${item.orgId}`} className="admin-list-row">
                    <div>
                      <p className="font-medium text-white">{item.orgName}</p>
                      {item.lastError ? (
                        <p className="truncate text-xs text-red-300">{item.lastError}</p>
                      ) : null}
                    </div>
                    <span className="admin-chip admin-chip--danger">{item.errorCount} errors</span>
                  </Link>
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
                  <Link key={item.orgId} href={`/customers/${item.orgId}`} className="admin-list-row">
                    <p className="font-medium text-white">{item.orgName}</p>
                    <span className="admin-chip admin-chip--warn">
                      {item.seatsUsed} / {item.seats} seats
                    </span>
                  </Link>
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

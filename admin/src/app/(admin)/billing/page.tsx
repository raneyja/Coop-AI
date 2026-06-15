"use client";

import { useCallback, useEffect, useState } from "react";
import { getStoredMe, displayOrgName } from "@/lib/auth";
import { fetchBilling, openBillingPortal } from "@/lib/coopApi";
import { PlanBadge } from "@/components/PlanBadge";

export default function BillingPage() {
  const me = getStoredMe();
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof fetchBilling>>["data"]>();
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchBilling();
    setLoading(false);
    if (result.ok) setBilling(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handlePortal() {
    setOpening(true);
    setError(null);
    const result = await openBillingPortal();
    setOpening(false);
    if (!result.ok || !result.data?.url) {
      setError(result.error ?? "Could not open billing portal.");
      return;
    }
    window.location.href = result.data.url;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-coop-muted">Plan, seats, and subscription management.</p>
      </div>

      <div className="admin-card max-w-lg space-y-4">
        <div>
          <p className="admin-section-label">Current plan</p>
          <div className="mt-2 flex items-center gap-3">
            <PlanBadge plan={billing?.plan ?? me?.plan ?? "free"} />
            <span className="text-sm text-coop-muted">{displayOrgName(me)}</span>
          </div>
        </div>

        {!loading && billing && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-coop-muted">Status</dt>
              <dd className="mt-1 capitalize">{billing.status}</dd>
            </div>
            <div>
              <dt className="text-coop-muted">Seats</dt>
              <dd className="mt-1">{billing.seats ?? "—"}</dd>
            </div>
            {billing.billingEmail && (
              <div className="col-span-2">
                <dt className="text-coop-muted">Billing email</dt>
                <dd className="mt-1">{billing.billingEmail}</dd>
              </div>
            )}
          </dl>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {billing?.hasStripeCustomer ? (
          <button type="button" className="admin-btn-primary" onClick={() => void handlePortal()} disabled={opening}>
            {opening ? "Opening…" : "Manage subscription"}
          </button>
        ) : (
          <div className="rounded-md border border-coop-border bg-coop-dark px-4 py-3 text-sm text-coop-muted">
            No Stripe subscription on this org. Purchase Pro at{" "}
            <a href="https://coop-ai.dev/signup" className="admin-link">
              coop-ai.dev/signup
            </a>{" "}
            or contact sales for Enterprise.
          </div>
        )}
      </div>
    </div>
  );
}

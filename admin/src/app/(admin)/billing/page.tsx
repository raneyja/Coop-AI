"use client";

import { useCallback, useEffect, useState } from "react";
import { getStoredMe, displayOrgName } from "@/lib/auth";
import { createUpgradeCheckoutSession, fetchBilling, openBillingPortal } from "@/lib/coopApi";
import { PlanBadge } from "@/components/PlanBadge";
import { EnterpriseUpgradeRequestForm } from "@/components/EnterpriseUpgradeRequestForm";

export default function BillingPage() {
  const me = getStoredMe();
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof fetchBilling>>["data"]>();
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgraded, setUpgraded] = useState(false);
  const [enterpriseFormOpen, setEnterpriseFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchBilling();
    setLoading(false);
    if (result.ok) setBilling(result.data);
  }, []);

  useEffect(() => {
    void load();
    if (typeof window !== "undefined") {
      setUpgraded(new URLSearchParams(window.location.search).get("upgraded") === "1");
    }
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

  async function handleUpgrade() {
    setUpgrading(true);
    setError(null);
    const result = await createUpgradeCheckoutSession();
    setUpgrading(false);
    if (!result.ok || !result.data?.url) {
      setError(result.error ?? "Could not start checkout.");
      return;
    }
    window.location.href = result.data.url;
  }

  const plan = billing?.plan ?? me?.plan ?? "free";
  const isFree = plan === "free";
  const isPro = plan === "pro";
  const isEnterprise = plan === "enterprise";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Billing</h1>
        <p className="mt-1 text-sm text-coop-muted">Plan, seats, and subscription management.</p>
      </div>

      {upgraded && (
        <div className="admin-panel-inset text-sm text-coop-index">
          Upgrade complete — your organization is now on Pro. Refresh if plan details look stale.
        </div>
      )}

      <section className="admin-card max-w-lg">
        <div>
          <p className="admin-section-label">Current plan</p>
          <div className="mt-3 flex items-center gap-3">
            <PlanBadge plan={plan} />
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

        {isEnterprise ? null : billing?.hasStripeCustomer ? (
          <div className="space-y-3">
            <button type="button" className="admin-btn-primary" onClick={() => void handlePortal()} disabled={opening}>
              {opening ? "Opening…" : "Manage subscription"}
            </button>
            {isPro ? (
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => setEnterpriseFormOpen(true)}
              >
                Request Upgrade to Enterprise
              </button>
            ) : null}
          </div>
        ) : isFree ? (
          <div className="space-y-3">
            <p className="text-sm text-coop-muted">
              Upgrade to Pro for unlimited Deep-Indexed repos, additional models, and team seats (up to 5 users).
            </p>
            <button
              type="button"
              className="admin-btn-primary"
              onClick={() => void handleUpgrade()}
              disabled={upgrading}
            >
              {upgrading ? "Redirecting…" : "Upgrade to Pro"}
            </button>
          </div>
        ) : isPro ? (
          <div className="space-y-3">
            <p className="text-sm text-coop-muted">
              Enterprise adds SAML SSO, integration scope controls, 5 workspace repos per seat, and uncapped org indexing.
            </p>
            <button type="button" className="admin-btn-primary" onClick={() => setEnterpriseFormOpen(true)}>
              Request Upgrade to Enterprise
            </button>
          </div>
        ) : (
          <div className="admin-panel-inset text-sm text-coop-muted">
            No Stripe subscription on this org. Purchase Pro at{" "}
            <a href="https://coop-ai.dev/signup" className="admin-link">
              coop-ai.dev/signup
            </a>
            .
          </div>
        )}
      </section>

      <EnterpriseUpgradeRequestForm open={enterpriseFormOpen} onClose={() => setEnterpriseFormOpen(false)} />
    </div>
  );
}

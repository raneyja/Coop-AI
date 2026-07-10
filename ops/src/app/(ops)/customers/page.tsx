"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  fetchOrganizations,
  formatDate,
  planBadgeClass,
  planLabel,
  type CustomerSummary,
  type OrgPlan
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { StatusBadge } from "@/components/StatusBadge";

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [organizations, setOrganizations] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [plan, setPlan] = useState<OrgPlan | "">((searchParams.get("plan") as OrgPlan) ?? "");
  const [billingStatus, setBillingStatus] = useState(searchParams.get("billingStatus") ?? "");
  const [onboardingIncomplete, setOnboardingIncomplete] = useState(
    searchParams.get("onboardingIncomplete") === "true"
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchOrganizations({
      q: q.trim() || undefined,
      plan: plan || undefined,
      billingStatus: billingStatus || undefined,
      onboardingIncomplete: onboardingIncomplete || undefined,
      sort: "name",
      order: "asc",
      limit: 100
    });
    setLoading(false);
    if (result.unavailable) {
      setUnavailable(true);
      setOrganizations([]);
      return;
    }
    setUnavailable(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to load customers.");
      return;
    }
    setOrganizations(result.data?.organizations ?? []);
  }, [q, plan, billingStatus, onboardingIncomplete]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (plan) params.set("plan", plan);
    if (billingStatus) params.set("billingStatus", billingStatus);
    if (onboardingIncomplete) params.set("onboardingIncomplete", "true");
    const query = params.toString();
    router.replace(query ? `/customers?${query}` : "/customers");
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">Customers</h1>
          <p className="mt-1 text-sm text-coop-muted">
            Search by name, billing email, admin email, org ID, or Stripe customer ID.
          </p>
        </div>
        <Link href="/customers/new" className="admin-btn-primary">
          Provision new
        </Link>
      </div>

      <form onSubmit={applyFilters} className="admin-card flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="search" className="admin-label">
            Search
          </label>
          <input
            id="search"
            type="search"
            className="admin-input"
            placeholder="Acme, admin@acme.com, org_…, cus_…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="plan" className="admin-label">
            Plan
          </label>
          <select
            id="plan"
            className="admin-input"
            value={plan}
            onChange={(e) => setPlan(e.target.value as OrgPlan | "")}
          >
            <option value="">All plans</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
        <div>
          <label htmlFor="billingStatus" className="admin-label">
            Billing status
          </label>
          <select
            id="billingStatus"
            className="admin-input"
            value={billingStatus}
            onChange={(e) => setBillingStatus(e.target.value)}
          >
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
            <option value="trialing">Trialing</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-coop-muted">
          <input
            type="checkbox"
            checked={onboardingIncomplete}
            onChange={(e) => setOnboardingIncomplete(e.target.checked)}
            className="rounded border-coop-border"
          />
          Onboarding incomplete
        </label>
        <button type="submit" className="admin-btn-secondary">
          Apply filters
        </button>
      </form>

      {unavailable && <UnavailableBanner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="admin-card--table">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Plan</th>
              <th>Billing</th>
              <th>Seats</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : organizations.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-coop-muted">
                  {unavailable ? "Customer list unavailable until operator API is deployed." : "No customers match your filters."}
                </td>
              </tr>
            ) : (
              organizations.map((org) => (
                <tr key={org.id} className="hover:bg-white/[0.02]">
                  <td>
                    <Link href={`/customers/${org.id}`} className="admin-link font-medium">
                      {org.name}
                    </Link>
                    <p className="mt-0.5 truncate font-mono text-xs text-coop-muted">
                      {org.adminEmail ?? org.billingEmail ?? org.id}
                    </p>
                  </td>
                  <td>
                    <span className={planBadgeClass(org.plan)}>{planLabel(org.plan)}</span>
                  </td>
                  <td className="text-xs text-coop-muted">{org.billingStatus ?? "—"}</td>
                  <td className="text-xs">
                    {org.seatsUsed != null && org.seats != null
                      ? `${org.seatsUsed} / ${org.seats}`
                      : org.seats ?? "—"}
                  </td>
                  <td>
                    {org.operatorStatus === "suspended" ? (
                      <StatusBadge connected={false} label="Suspended" variant="danger" showWhenDisconnected />
                    ) : org.onboardingIncomplete ? (
                      <StatusBadge connected={false} label="Onboarding" variant="warn" showWhenDisconnected />
                    ) : (
                      <StatusBadge connected label="Active" />
                    )}
                  </td>
                  <td className="text-xs text-coop-muted">{formatDate(org.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

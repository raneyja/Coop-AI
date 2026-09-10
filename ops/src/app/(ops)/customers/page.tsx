"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getStoredMe } from "@/lib/auth";
import { canSuperAdmin } from "@/lib/operatorRbac";
import {
  activateOrganization,
  cancelOrganization,
  fetchOrganizations,
  formatDate,
  formatUsdFromCents,
  formatUsagePercent,
  planBadgeClass,
  planLabel,
  suspendOrganization,
  type CustomerSummary,
  type OrgPlan
} from "@/lib/coopApi";
import { ConfirmOrgNameModal } from "@/components/ConfirmOrgNameModal";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { OperatorOrgStatusBadge } from "@/components/StatusBadge";
import { UsageMeterBar } from "@/components/UsageMeterBar";

type ConfirmAction = "suspend" | "cancel";

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = getStoredMe();
  const [organizations, setOrganizations] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ action: ConfirmAction; org: CustomerSummary } | null>(null);
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [plan, setPlan] = useState<OrgPlan | "">((searchParams.get("plan") as OrgPlan) ?? "");
  const [billingStatus, setBillingStatus] = useState(searchParams.get("billingStatus") ?? "");
  const [onboardingIncomplete, setOnboardingIncomplete] = useState(
    searchParams.get("onboardingIncomplete") === "true"
  );
  const [sort, setSort] = useState<"name" | "usage">(
    searchParams.get("sort") === "usage" ? "usage" : "name"
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchOrganizations({
      q: q.trim() || undefined,
      plan: plan || undefined,
      billingStatus: billingStatus || undefined,
      onboardingIncomplete: onboardingIncomplete || undefined,
      sort,
      order: sort === "usage" ? "desc" : "asc",
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
  }, [q, plan, billingStatus, onboardingIncomplete, sort]);

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
    if (sort === "usage") params.set("sort", "usage");
    const query = params.toString();
    router.replace(query ? `/customers?${query}` : "/customers");
    void load();
  }

  async function handleActivate(org: CustomerSummary) {
    if (!me || !canSuperAdmin(me)) return;
    setBusy(`activate-${org.id}`);
    setActionError(null);
    const result = await activateOrganization(org.id);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error ?? "Failed to activate organization.");
      return;
    }
    void load();
  }

  async function handleConfirm(result: { continueBilling?: boolean }) {
    if (!me || !canSuperAdmin(me) || !confirm) return;
    setBusy(`${confirm.action}-${confirm.org.id}`);
    setActionError(null);
    const apiResult =
      confirm.action === "cancel"
        ? await cancelOrganization(confirm.org.id, {
            confirmName: confirm.org.name,
            reason: "Cancelled by operator"
          })
        : await suspendOrganization(confirm.org.id, {
            confirmName: confirm.org.name,
            reason: "Suspended by operator",
            continueBilling: result.continueBilling
          });
    setBusy(null);
    setConfirm(null);
    if (!apiResult.ok) {
      setActionError(apiResult.error ?? `Failed to ${confirm.action} organization.`);
      return;
    }
    void load();
  }

  const showActions = Boolean(me && canSuperAdmin(me));

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
            placeholder="Acme, admin@acme.com, UUID, cus_…"
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
        <div>
          <label htmlFor="sort" className="admin-label">
            Sort
          </label>
          <select
            id="sort"
            className="admin-input"
            value={sort}
            onChange={(e) => setSort(e.target.value === "usage" ? "usage" : "name")}
          >
            <option value="name">Name</option>
            <option value="usage">Highest usage</option>
          </select>
        </div>
        <button type="submit" className="admin-btn-secondary">
          Apply filters
        </button>
      </form>

      {unavailable && <UnavailableBanner />}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {actionError && <p className="text-sm text-red-400">{actionError}</p>}

      <div className="admin-card--table">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Plan</th>
              <th>Billing</th>
              <th>Seats</th>
              <th>Usage</th>
              <th>Cost</th>
              <th>Margin</th>
              <th>Status</th>
              <th>Created</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={showActions ? 10 : 9} className="py-8 text-center text-coop-muted">
                  Loading…
                </td>
              </tr>
            ) : organizations.length === 0 ? (
              <tr>
                <td colSpan={showActions ? 10 : 9} className="py-8 text-center text-coop-muted">
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
                    <UsageMeterBar
                      ratio={org.usage?.usedRatio}
                      label={formatUsagePercent(org.usage?.usedRatio)}
                    />
                  </td>
                  <td className="text-xs">{formatUsdFromCents(org.usage?.usedCents)}</td>
                  <td
                    className={`text-xs ${
                      org.usage?.marginCents != null && org.usage.marginCents < 0 ? "text-coop-warn" : "text-coop-muted"
                    }`}
                  >
                    {formatUsdFromCents(org.usage?.marginCents)}
                  </td>
                  <td>
                    <OperatorOrgStatusBadge
                      status={org.operatorStatus}
                      onboardingIncomplete={org.onboardingIncomplete}
                    />
                  </td>
                  <td className="text-xs text-coop-muted">{formatDate(org.createdAt)}</td>
                  {showActions && (
                    <td className="whitespace-nowrap">
                      {org.operatorStatus === "cancelled" ? (
                        <span className="text-xs text-coop-muted">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {org.operatorStatus === "suspended" ? (
                            <button
                              type="button"
                              className="admin-link text-xs"
                              onClick={() => void handleActivate(org)}
                              disabled={busy === `activate-${org.id}`}
                            >
                              {busy === `activate-${org.id}` ? "Activating…" : "Activate"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="admin-link text-xs"
                              onClick={() => setConfirm({ action: "suspend", org })}
                              disabled={Boolean(busy)}
                            >
                              Suspend
                            </button>
                          )}
                          <button
                            type="button"
                            className="admin-link text-xs text-red-300"
                            onClick={() => setConfirm({ action: "cancel", org })}
                            disabled={Boolean(busy)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmOrgNameModal
        open={Boolean(confirm)}
        title={confirm?.action === "cancel" ? "Cancel customer" : "Suspend organization"}
        orgName={confirm?.org.name ?? ""}
        description={
          confirm?.action === "cancel"
            ? "Ends this customer. They lose access, billing stops, and they can sign up again later with the same email. We keep this record for history."
            : "Suspended organizations lose API access immediately. Their email stays on this account, so they cannot sign up again until you activate."
        }
        confirmLabel={confirm?.action === "cancel" ? "Cancel customer" : "Suspend"}
        askContinueBilling={confirm?.action === "suspend" && Boolean(confirm.org.stripeCustomerId)}
        onConfirm={handleConfirm}
        onClose={() => setConfirm(null)}
        loading={Boolean(confirm && busy === `${confirm.action}-${confirm.org.id}`)}
      />
    </div>
  );
}

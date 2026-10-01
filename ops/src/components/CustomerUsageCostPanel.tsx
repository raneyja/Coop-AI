"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CostLineChart } from "@/components/charts/CostLineChart";
import { UsageMeterBar } from "@/components/UsageMeterBar";
import {
  fetchOrganizationUsage,
  fetchPlatformFinancials,
  fetchOrganizationUsageCost,
  formatDateTime,
  formatUsdFromCents,
  formatUsagePercent,
  tokensToCredits,
  type OperatorCostRangeKind,
  type OrgCostBreakdown,
  type OrgUsageSnapshot
} from "@/lib/coopApi";

const RANGE_OPTIONS: Array<{ kind: OperatorCostRangeKind; label: string }> = [
  { kind: "7d", label: "7 days" },
  { kind: "30d", label: "30 days" },
  { kind: "90d", label: "90 days" }
];

export function CustomerUsageCostPanel({
  orgId,
  userId,
  usersHref,
  onRangeChange
}: {
  orgId?: string;
  /** When set, chart + totals are scoped to this seat. */
  userId?: string;
  /** Optional deep-link for “see all users” from org view. */
  usersHref?: string;
  onRangeChange?: (range: OperatorCostRangeKind) => void;
}) {
  const searchParams = useSearchParams();
  const initialRange = searchParams.get("range");
  const [rangeKind, setRangeKind] = useState<OperatorCostRangeKind>(
    initialRange === "7d" || initialRange === "90d" ? initialRange : "30d"
  );
  const [usage, setUsage] = useState<OrgUsageSnapshot | null>(null);
  const [cost, setCost] = useState<OrgCostBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      const [usageRes, costRes] = await Promise.all([
        orgId ? fetchOrganizationUsage(orgId) : Promise.resolve({ ok: true, data: undefined }),
        orgId ? fetchOrganizationUsageCost(orgId, { range: rangeKind, userId }) : fetchPlatformFinancials(rangeKind)
      ]);
      if (!active) return;
      setLoading(false);
      if (usageRes.ok) {
        setUsage(usageRes.data ?? null);
      } else {
        setUsage(null);
      }
      if (!costRes.ok || !costRes.data) {
        setCost(null);
        setError(costRes.error ?? "Could not load model cost.");
        return;
      }
      setCost(costRes.data);
    };
    void load();
    return () => {
      active = false;
    };
  }, [orgId, rangeKind, userId]);

  const showByUser = !userId && (cost?.byUser.length ?? 0) > 0;

  return (
    <section id="ops-usage" className="admin-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-section-label">{orgId ? "Usage & cost" : "All customers · financial overview"}</h2>
          <p className="mt-1 text-sm text-coop-muted">
            Finalized invoice amounts (including tax, net of credit notes), by creation date. Profit = billed − model cost; excludes other operating costs.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-coop-border/60 bg-coop-surface/40 p-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                rangeKind === option.kind
                  ? "bg-white/[0.08] text-white"
                  : "text-coop-muted hover:bg-white/[0.04] hover:text-white"
              }`}
              onClick={() => {
                setRangeKind(option.kind);
                onRangeChange?.(option.kind);
              }}
              aria-pressed={rangeKind === option.kind}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-coop-muted">Loading cost…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : cost ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="admin-metric">
              <p className="admin-stat-label">Total Billed</p>
              <p className="admin-metric-value">{formatUsdFromCents(cost.totals.billedCents)}</p>
              <p className="mt-2 text-xs text-coop-muted">{cost.range.label}</p>
            </div>
            <div className="admin-metric">
              <p className="admin-stat-label">Total Cost</p>
              <p className="admin-metric-value">{formatUsdFromCents(cost.totals.usedCents)}</p>
              <p className="mt-2 text-xs text-coop-muted">
                Auto {formatUsdFromCents(cost.totals.autoCents)} · Frontier {formatUsdFromCents(cost.totals.frontierCents)}
              </p>
            </div>
            <div className="admin-metric">
              <p className="admin-stat-label">Total Profit</p>
              <p className={`admin-metric-value ${cost.totals.profitCents != null && cost.totals.profitCents < 0 ? "!text-coop-warn" : ""}`}>
                {formatUsdFromCents(cost.totals.profitCents)}
              </p>
              <p className="mt-2 text-xs text-coop-muted">Billed less model cost</p>
            </div>
          </div>
          {cost.totals.billedCents == null ? (
            <p className="text-xs text-coop-muted">
              {userId ? "Invoices are billed to the organization; billed revenue and profit are not attributed to individual users." : "Invoice data is unavailable. Billed and profit are not estimated."}
            </p>
          ) : null}
          <div>
            <p className="mb-3 text-sm font-medium text-white/90">Model cost over time</p>
            <CostLineChart data={cost.days.map((day) => ({
              day: day.day, autoCents: day.autoCents, frontierCents: day.frontierCents
            }))} />
          </div>
          {orgId ? <div className="admin-mix">
            <span>Chat {cost.productMix.chat}</span>
            <span>Completions {cost.productMix.completions}</span>
            <span>Quick actions {cost.productMix.quickActions}</span>
            <span>Lightning {cost.productMix.lightning}</span>
          </div> : null}

          {usage?.capKind === "free_credits" && usage.free ? (
            <div className="rounded-md border border-coop-border/50 bg-white/[0.02] p-4">
              <p className="admin-stat-label">Free allowance (not billed cost)</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {tokensToCredits(usage.free.usedTokens)}K
                <span className="ml-2 text-sm font-normal text-coop-muted">
                  of {tokensToCredits(usage.free.limitTokens)}K credits
                </span>
              </p>
              <div className="mt-3 max-w-md">
                <UsageMeterBar
                  size="lg"
                  ratio={usage.free.usedRatio}
                  label={`${formatUsagePercent(usage.free.usedRatio)} of free allowance`}
                />
              </div>
              <p className="mt-2 text-xs text-coop-muted">
                Resets {formatDateTime(usage.free.resetsAt)}. Separate from the $ chart above.
              </p>
            </div>
          ) : null}

          {usage?.capKind === "paid_included" && usage.includedCents != null ? (
            <div className="rounded-md border border-coop-border/50 bg-white/[0.02] p-4">
              <p className="admin-stat-label">Included usage this billing period</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatUsdFromCents(usage.usedCents)}
                <span className="ml-2 text-sm font-normal text-coop-muted">
                  of {formatUsdFromCents(usage.includedCents)}
                </span>
              </p>
              {usage.usedRatio != null ? (
                <div className="mt-3 max-w-md">
                  <UsageMeterBar
                    size="lg"
                    ratio={usage.usedRatio}
                    label={`${formatUsagePercent(usage.usedRatio)} of included`}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {showByUser ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="admin-stat-label">Cost by user · {cost.range.label}</p>
                {usersHref ? (
                  <Link href={usersHref} className="admin-link text-xs">
                    Manage users
                  </Link>
                ) : null}
              </div>
              <div className="admin-card--table">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Total Billed</th>
                      <th>Total Cost</th>
                      <th>Total Profit</th>
                      <th>Auto</th>
                      <th>Frontier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cost.byUser.map((row) => (
                      <tr key={row.userId}>
                        <td>
                          <Link
                            href={`/customers/${orgId}/users/${row.userId}?range=${rangeKind}`}
                            className="admin-link"
                          >
                            {row.email}
                          </Link>
                        </td>
                        <td className="text-xs text-coop-muted" title="Organization invoices are not attributed to users">—</td>
                        <td className="text-xs">{formatUsdFromCents(row.usedCents)}</td>
                        <td className="text-xs text-coop-muted" title="Requires user billing attribution">—</td>
                        <td className="text-xs text-coop-muted">
                          {formatUsdFromCents(row.autoCents)}
                        </td>
                        <td className="text-xs text-coop-muted">
                          {formatUsdFromCents(row.frontierCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-coop-muted">Usage is unavailable for this customer right now.</p>
      )}
    </section>
  );
}

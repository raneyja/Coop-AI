"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CostLineChart } from "@/components/charts/CostLineChart";
import { UsageMeterBar } from "@/components/UsageMeterBar";
import {
  fetchOrganizationUsage,
  fetchOrganizationUsageCost,
  formatBilledAmount,
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
  { kind: "month", label: "Month" }
];

export function CustomerUsageCostPanel({
  orgId,
  userId,
  usersHref
}: {
  orgId: string;
  /** When set, chart + totals are scoped to this seat. */
  userId?: string;
  /** Optional deep-link for “see all users” from org view. */
  usersHref?: string;
}) {
  const [rangeKind, setRangeKind] = useState<OperatorCostRangeKind>("30d");
  const [usage, setUsage] = useState<OrgUsageSnapshot | null>(null);
  const [cost, setCost] = useState<OrgCostBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [usageRes, costRes] = await Promise.all([
      fetchOrganizationUsage(orgId),
      fetchOrganizationUsageCost(orgId, { range: rangeKind, userId })
    ]);
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
  }, [orgId, rangeKind, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const showByUser = !userId && (cost?.byUser.length ?? 0) > 0;

  return (
    <section id="ops-usage" className="admin-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-section-label">Usage & cost</h2>
          <p className="mt-1 text-sm text-coop-muted">
            Coop’s real model spend — shown whether or not the customer was billed.
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
              onClick={() => setRangeKind(option.kind)}
              aria-pressed={rangeKind === option.kind}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !cost ? (
        <p className="text-sm text-coop-muted">Loading cost…</p>
      ) : error && !cost ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : cost ? (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div>
              <p className="admin-stat-label">LLM cost · {cost.range.label}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-white">
                {formatUsdFromCents(cost.totals.usedCents)}
              </p>
              <p className="mt-2 text-sm text-coop-muted">
                Auto {formatUsdFromCents(cost.totals.autoCents)} · Frontier{" "}
                {formatUsdFromCents(cost.totals.frontierCents)}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="admin-stat-label">Billed (seats)</p>
                  <p className="admin-stat-value--quiet">
                    {formatBilledAmount(usage?.seatRevenueCents)}
                  </p>
                </div>
                <div>
                  <p className="admin-stat-label">Margin</p>
                  <p
                    className={`admin-stat-value--quiet ${
                      usage?.marginCents != null && usage.marginCents < 0 ? "text-coop-warn" : ""
                    }`}
                  >
                    {usage?.marginCents == null
                      ? "—"
                      : formatUsdFromCents(usage.marginCents)}
                  </p>
                </div>
              </div>
              <div className="admin-mix mt-4">
                <span>Chat {cost.productMix.chat}</span>
                <span>Completions {cost.productMix.completions}</span>
                <span>Quick actions {cost.productMix.quickActions}</span>
                <span>Lightning {cost.productMix.lightning}</span>
              </div>
            </div>

            <div>
              <CostLineChart
                data={cost.days.map((day) => ({
                  day: day.day,
                  autoCents: day.autoCents,
                  frontierCents: day.frontierCents
                }))}
              />
            </div>
          </div>

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
                      <th>Cost</th>
                      <th>Auto</th>
                      <th>Frontier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cost.byUser.map((row) => (
                      <tr key={row.userId}>
                        <td>
                          <Link
                            href={`/customers/${orgId}/users/${row.userId}`}
                            className="admin-link"
                          >
                            {row.email}
                          </Link>
                        </td>
                        <td className="text-xs">{formatUsdFromCents(row.usedCents)}</td>
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

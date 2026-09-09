"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import type { QuotaSnapshot } from "@/lib/coopApi";
import {
  isFreeQuotaExhausted,
  quotaUsedPercent,
  resolveFreeQuotaCredits
} from "@/lib/quotaSnapshot";
import {
  formatFreeQuotaResumeParts,
  formatPaidUsageResetCopy,
  formatQuotaUsageSummary
} from "@/lib/usageResetCopy";
import { stackedUsagePercents } from "@/lib/stackedUsagePercents";
import { SeatUsageHelper, SeatUsageLegend } from "@/components/SeatUsageBar";

type UsageQuotaMeterProps = {
  snapshot?: QuotaSnapshot;
  loading?: boolean;
  showUpgradeLink?: boolean;
  mixLine?: string | null;
};

function FreeUsageMeter({
  credits
}: {
  credits: NonNullable<ReturnType<typeof resolveFreeQuotaCredits>>;
}): ReactElement {
  const exhausted = isFreeQuotaExhausted(credits);
  const pct = quotaUsedPercent(credits.usedCredits, credits.limitCredits);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!exhausted) {
      return;
    }
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [exhausted]);

  const resume = exhausted
    ? formatFreeQuotaResumeParts(
        { resetsAt: credits.resetsAt, windowHours: credits.windowHours },
        now
      )
    : null;

  return (
    <div className="space-y-2">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-white/10"
        role="img"
        aria-label={`${pct}% of free AI credits used`}
      >
        {pct > 0 ? <div className="h-full bg-coop-index" style={{ width: `${pct}%` }} /> : null}
      </div>
      <p className="text-sm text-coop-muted">{formatQuotaUsageSummary(credits, { exhausted })}</p>
      {resume ? (
        <p className="text-sm text-white" aria-live="polite">
          Paused at <span className="font-medium">{resume.pausedAtLabel}</span>
          {" · resumes at "}
          <span className="font-medium">{resume.resumesAtLabel}</span>
          <span className="text-coop-muted"> ({resume.countdown})</span>
        </p>
      ) : null}
    </div>
  );
}

export function UsageQuotaMeter({ snapshot, loading, showUpgradeLink = true, mixLine }: UsageQuotaMeterProps) {
  const meters = snapshot?.usageMeters;
  const paidResetLabel = formatPaidUsageResetCopy(meters?.periodEnd);
  const unlimited = Boolean(snapshot?.unlimited);
  const isPaidMeters = Boolean(meters) && !unlimited;
  const freeCredits = !isPaidMeters && !unlimited ? resolveFreeQuotaCredits(snapshot) : null;
  const autoRatio = meters?.auto.usedRatio ?? 0;
  const frontierRatio = meters?.frontier.usedRatio ?? 0;
  const totalRatio =
    typeof meters?.usedRatio === "number" ? meters.usedRatio : Math.min(1, autoRatio + frontierRatio);
  const segments = stackedUsagePercents(autoRatio, frontierRatio);
  const totalPct = Math.round(Math.max(0, Math.min(100, totalRatio * 100)));
  const windowHours = freeCredits?.windowHours ?? snapshot?.windowHours ?? 5;

  return (
    <section className="admin-card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-section-label">Usage quota</h2>
          <p className="mt-1 text-sm text-coop-muted">
            {isPaidMeters
              ? `${meters?.displayName ?? "Pro"} includes monthly usage that resets on your signup anniversary. This bar is your seat, not a shared team pool.`
              : `Free includes ${freeCredits?.limitCredits ?? 80}K AI credits per ${windowHours}-hour window.`}
          </p>
          {mixLine ? <p className="mt-1 text-xs text-coop-muted">{mixLine}</p> : null}
        </div>
        {showUpgradeLink ? (
          <Link href="/billing" className="admin-link text-sm">
            {isPaidMeters ? "Adjust plan" : "Upgrade to Pro"}
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3" aria-live="polite">
          <div className="h-2 w-full animate-pulse rounded-full bg-white/10" />
          <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
          <p className="text-xs text-coop-muted">Loading usage…</p>
        </div>
      ) : unlimited ? (
        <div className="space-y-2">
          <p className="text-2xl font-semibold text-white">No hard usage cap</p>
          <p className="text-sm text-coop-muted">Enterprise usage is not hard-stopped in this view.</p>
        </div>
      ) : meters ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-white">Monthly usage</p>
            <p className="text-xs text-coop-muted">{totalPct}% used</p>
          </div>
          <div
            className="flex h-2 overflow-hidden rounded-full bg-white/10"
            role="img"
            aria-label={`${totalPct}% of monthly usage used`}
          >
            {segments.auto > 0 ? (
              <div className="h-full bg-coop-index" style={{ width: `${segments.auto}%` }} />
            ) : null}
            {segments.frontier > 0 ? (
              <div className="h-full bg-[#58a6ff]" style={{ width: `${segments.frontier}%` }} />
            ) : null}
          </div>
          <SeatUsageLegend />
          <SeatUsageHelper />
          {paidResetLabel ? <p className="text-xs text-coop-muted">{paidResetLabel}</p> : null}
        </div>
      ) : freeCredits ? (
        <FreeUsageMeter credits={freeCredits} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-coop-muted">Usage limits are not available for this organization yet.</p>
        </div>
      )}
    </section>
  );
}

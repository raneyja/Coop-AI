import Link from "next/link";
import type { QuotaSnapshot } from "@/lib/coopApi";

type UsageQuotaMeterProps = {
  snapshot?: QuotaSnapshot;
  loading?: boolean;
  showUpgradeLink?: boolean;
};

function formatCreditCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, value));
}

function formatResetTime(resetsAt: string | undefined): string | null {
  if (!resetsAt) return null;
  const parsed = new Date(resetsAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function percentUsed(used: number | undefined, limit: number | undefined): number {
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) {
    return 0;
  }
  const ratio = (used / limit) * 100;
  return Math.max(0, Math.min(100, ratio));
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function resolveTokenFields(snapshot?: QuotaSnapshot): {
  usedTokens?: number;
  limitTokens?: number;
  remainingTokens?: number;
} {
  const limitTokens =
    typeof snapshot?.limitTokens === "number"
      ? snapshot.limitTokens
      : typeof snapshot?.limitCredits === "number"
        ? snapshot.limitCredits * 1000
        : undefined;
  const usedTokens =
    typeof snapshot?.usedTokens === "number"
      ? snapshot.usedTokens
      : typeof snapshot?.usedCredits === "number"
        ? snapshot.usedCredits * 1000
        : undefined;
  const remainingTokens =
    typeof snapshot?.remainingTokens === "number"
      ? snapshot.remainingTokens
      : typeof limitTokens === "number" && typeof usedTokens === "number"
        ? Math.max(0, limitTokens - usedTokens)
        : typeof snapshot?.remainingCredits === "number"
          ? snapshot.remainingCredits * 1000
          : undefined;
  return { usedTokens, limitTokens, remainingTokens };
}

function PoolBar({
  label,
  caption,
  usedCents,
  limitCents,
  usedRatio
}: {
  label: string;
  caption: string;
  usedCents: number;
  limitCents: number;
  usedRatio: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(usedRatio * 100)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-coop-muted">{pct}% used</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-coop-index transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <p className="text-xs text-coop-muted">{caption}</p>
      <p className="text-xs text-coop-muted">
        {formatUsd(usedCents)} of {formatUsd(limitCents)} included
      </p>
    </div>
  );
}

export function UsageQuotaMeter({ snapshot, loading, showUpgradeLink = true }: UsageQuotaMeterProps) {
  const { usedTokens, limitTokens, remainingTokens } = resolveTokenFields(snapshot);
  const meters = snapshot?.usageMeters;
  const resetLabel = formatResetTime(snapshot?.resetsAt ?? meters?.periodEnd);
  const exhausted = typeof remainingTokens === "number" && remainingTokens <= 0;
  const displayUsed =
    exhausted && typeof limitTokens === "number" ? limitTokens : (usedTokens ?? 0);
  const displayRemaining = exhausted ? 0 : (remainingTokens ?? 0);
  const usedPercent = percentUsed(displayUsed, limitTokens);
  const unlimited = Boolean(snapshot?.unlimited);
  const windowHours = snapshot?.windowHours ?? 5;
  const isPaidMeters = Boolean(meters) && !unlimited;

  return (
    <section className="admin-card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-section-label">Usage quota</h2>
          <p className="mt-1 text-sm text-coop-muted">
            {isPaidMeters
              ? `${meters?.displayName ?? "Pro"} includes Coop Auto and Frontier usage that resets each calendar month.`
              : `Free plan includes ${formatCreditCount(limitTokens ?? 80_000)} AI credits per ${windowHours}-hour window (GPT-4o mini).`}
          </p>
        </div>
        {showUpgradeLink ? (
          <Link href="/billing" className="admin-link text-sm">
            {isPaidMeters ? "Adjust plan" : "Upgrade plan"}
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
        <div className="space-y-5">
          <PoolBar
            label="Coop Auto"
            caption="Includes Coop-assigned models (Auto). Extra Auto use consumes Frontier."
            usedCents={meters.auto.usedCents}
            limitCents={meters.auto.limitCents}
            usedRatio={meters.auto.usedRatio}
          />
          <PoolBar
            label="Frontier"
            caption="Claude, GPT, Gemini, and other models you pick. Extra use requires an upgrade."
            usedCents={meters.frontier.usedCents}
            limitCents={meters.frontier.limitCents}
            usedRatio={meters.frontier.usedRatio}
          />
          {resetLabel ? <p className="text-xs text-coop-muted">Limits reset {resetLabel}</p> : null}
        </div>
      ) : typeof limitTokens === "number" ? (
        <div className="space-y-2">
          <p className="text-2xl font-semibold tabular-nums text-white">
            {formatCreditCount(displayUsed)}
            <span className="text-base font-medium text-coop-muted">
              {" "}
              / {formatCreditCount(limitTokens)} AI credits
            </span>
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-coop-index transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(4, usedPercent)}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-coop-muted">
            <span>{formatCreditCount(displayRemaining)} AI credits remaining</span>
            <span>{Math.round(usedPercent)}% used</span>
          </div>
          <p className="text-xs text-coop-muted">
            {exhausted && resetLabel
              ? `Account paused · resets at ${resetLabel}`
              : "Account pauses when exhausted"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-coop-muted">Usage limits are not available for this organization yet.</p>
        </div>
      )}
    </section>
  );
}

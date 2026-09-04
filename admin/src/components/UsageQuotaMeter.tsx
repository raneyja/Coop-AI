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

function stackedPercents(autoRatio: number, frontierRatio: number): { auto: number; frontier: number } {
  const auto = Math.max(0, autoRatio) * 100;
  const frontier = Math.max(0, frontierRatio) * 100;
  const total = auto + frontier;
  if (total <= 100) {
    return { auto, frontier };
  }
  const scale = 100 / total;
  return { auto: auto * scale, frontier: frontier * scale };
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
  const autoRatio = meters?.auto.usedRatio ?? 0;
  const frontierRatio = meters?.frontier.usedRatio ?? 0;
  const totalRatio =
    typeof meters?.usedRatio === "number" ? meters.usedRatio : Math.min(1, autoRatio + frontierRatio);
  const segments = stackedPercents(autoRatio, frontierRatio);
  const totalPct = Math.round(Math.max(0, Math.min(100, totalRatio * 100)));

  return (
    <section className="admin-card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-section-label">Usage quota</h2>
          <p className="mt-1 text-sm text-coop-muted">
            {isPaidMeters
              ? `${meters?.displayName ?? "Pro"} includes monthly usage that resets each calendar month.`
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
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-white">Monthly usage</p>
            <p className="text-xs text-coop-muted">{totalPct}% used</p>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${totalPct}% of monthly usage used`}>
            {segments.auto > 0 ? (
              <div className="h-full bg-coop-index" style={{ width: `${segments.auto}%` }} />
            ) : null}
            {segments.frontier > 0 ? (
              <div className="h-full bg-[#58a6ff]" style={{ width: `${segments.frontier}%` }} />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-coop-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-coop-index" aria-hidden />
              Auto
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#58a6ff]" aria-hidden />
              Frontier
            </span>
          </div>
          <p className="text-xs text-coop-muted">
            Chat, quick actions, and models you pick share one bar. Frontier models fill it faster.
          </p>
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
              style={{ width: `${usedPercent}%` }}
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

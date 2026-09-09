"use client";

import type { ReactElement } from "react";
import { stackedUsagePercents } from "@/lib/stackedUsagePercents";
import {
  USAGE_METER_BASE_LABEL,
  USAGE_METER_FRONTIER_LABEL,
  USAGE_METER_HELPER
} from "@/lib/usageMeterCopy";
import type { SeatUsageBarMeters } from "@/lib/demoSeatUsage";

export type { SeatUsageBarMeters };

export function SeatUsageLegend(): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-coop-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-coop-index" aria-hidden />
        {USAGE_METER_BASE_LABEL}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[#58a6ff]" aria-hidden />
        {USAGE_METER_FRONTIER_LABEL}
      </span>
    </div>
  );
}

export function SeatUsageHelper(): ReactElement {
  return <p className="text-xs text-coop-muted">{USAGE_METER_HELPER}</p>;
}

export function SeatUsageBar({
  meters,
  sample
}: {
  meters: SeatUsageBarMeters;
  sample?: boolean;
}): ReactElement {
  const autoRatio = meters.auto?.usedRatio ?? 0;
  const frontierRatio = meters.frontier?.usedRatio ?? 0;
  const usedRatio =
    typeof meters.usedRatio === "number" ? meters.usedRatio : Math.min(1, autoRatio + frontierRatio);
  const segments = stackedUsagePercents(autoRatio, frontierRatio);
  const pct = Math.round(Math.max(0, Math.min(100, usedRatio * 100)));
  return (
    <div className="mt-1.5 flex max-w-xs items-center gap-2">
      <div
        className="flex h-1.5 min-w-[7rem] flex-1 overflow-hidden rounded-full bg-white/10"
        role="img"
        aria-label={`${pct}% of monthly usage used${sample ? " (sample)" : ""}`}
      >
        {segments.auto > 0 ? (
          <div className="h-full bg-coop-index" style={{ width: `${segments.auto}%` }} />
        ) : null}
        {segments.frontier > 0 ? (
          <div className="h-full bg-[#58a6ff]" style={{ width: `${segments.frontier}%` }} />
        ) : null}
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-coop-muted">
        {pct}% used{sample ? " · sample" : ""}
      </span>
    </div>
  );
}

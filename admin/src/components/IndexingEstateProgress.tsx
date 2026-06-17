"use client";

import type { IndexingProgressStats } from "@/lib/indexingProgress";

export function IndexingEstateProgress({
  stats,
  loading
}: {
  stats: IndexingProgressStats;
  loading: boolean;
}): React.ReactElement {
  const inFlightParts: string[] = [];
  if (stats.indexing > 0) {
    inFlightParts.push(`${stats.indexing} indexing`);
  }
  if (stats.queued > 0) {
    inFlightParts.push(`${stats.queued} queued`);
  }
  const label = loading
    ? "Loading estate index…"
    : stats.inFlight > 0
      ? `${stats.ready} of ${stats.total} ready · ${inFlightParts.join(" · ")}`
      : `${stats.ready} of ${stats.total} ready`;

  const barClass = stats.inFlight > 0 && !loading ? "bg-coop-index animate-pulse" : "bg-coop-index";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-coop-muted">
        <span>{label}</span>
        <span className="font-mono text-white">{loading ? "—" : `${stats.progressPercent}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: loading ? "0%" : `${stats.progressPercent}%` }}
        />
      </div>
    </div>
  );
}

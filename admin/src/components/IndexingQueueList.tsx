"use client";

import type { IndexingQueueItem } from "@/lib/indexingProgress";
import { formatRelativeTime } from "@/lib/indexingProgress";

type IndexingQueueListProps = {
  inFlight: IndexingQueueItem[];
  attention: IndexingQueueItem[];
  ready?: IndexingQueueItem[];
  compact?: boolean;
  maxReady?: number;
};

function statusDotClass(item: IndexingQueueItem): string {
  if (item.indexStatus === "indexing" || item.indexStatus === "cloning") {
    return "bg-sky-400 shadow-[0_0_0_2px_rgba(56,189,248,0.25)] animate-pulse";
  }
  if (item.indexStatus === "queued") {
    return "bg-amber-300/90";
  }
  if (item.indexStatus === "error") {
    return "bg-red-400";
  }
  if (item.displayStatus === "Embeddings pending") {
    return "bg-amber-300";
  }
  if (item.indexStatus === "ready") {
    return "bg-emerald-400";
  }
  return "bg-white/30";
}

function QueueRow({
  item,
  compact
}: {
  item: IndexingQueueItem;
  compact?: boolean;
}): React.ReactElement {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(item)}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate font-mono text-xs text-white">{item.repoName}</span>
          <span className="text-[11px] uppercase tracking-wide text-coop-muted">{item.displayStatus}</span>
        </div>
        {!compact && item.errorNote ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-red-300/90">{item.errorNote}</p>
        ) : null}
      </div>
      {!compact ? (
        <span className="shrink-0 text-[11px] text-coop-muted">{formatRelativeTime(item.lastIndexedAt)}</span>
      ) : null}
    </li>
  );
}

function QueueSection({
  title,
  items,
  compact
}: {
  title: string;
  items: IndexingQueueItem[];
  compact?: boolean;
}): React.ReactElement | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-coop-muted">
        {title} <span className="text-white/70">({items.length})</span>
      </p>
      <ul className="divide-y divide-white/[0.06]">
        {items.map((item) => (
          <QueueRow key={item.repoId} item={item} compact={compact} />
        ))}
      </ul>
    </div>
  );
}

export function IndexingQueueList({
  inFlight,
  attention,
  ready = [],
  compact = false,
  maxReady = 5
}: IndexingQueueListProps): React.ReactElement | null {
  const readySlice = ready.slice(0, maxReady);
  const hasQueue = inFlight.length > 0 || attention.length > 0 || readySlice.length > 0;

  if (!hasQueue) {
    return null;
  }

  return (
    <div className={`space-y-3 ${compact ? "" : "rounded-sm border border-coop-border bg-white/[0.02] p-4"}`}>
      <QueueSection title="In progress" items={inFlight} compact={compact} />
      <QueueSection title="Needs attention" items={attention} compact={compact} />
      {readySlice.length > 0 ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-coop-muted">
            Recently ready{" "}
            <span className="text-white/70">
              ({readySlice.length}
              {ready.length > readySlice.length ? ` of ${ready.length}` : ""})
            </span>
          </p>
          <ul className="divide-y divide-white/[0.06]">
            {readySlice.map((item) => (
              <QueueRow key={item.repoId} item={item} compact={compact} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

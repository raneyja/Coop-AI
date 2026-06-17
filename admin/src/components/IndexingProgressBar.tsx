"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrgRepos, type OrgRepoRecord } from "@/lib/coopApi";
import {
  buildIndexingQueue,
  computeIndexingStats,
  dismissIndexingProgress,
  INDEXING_DISMISS_KEY,
  INDEXING_SYNC_EVENT,
  isIndexingDismissed,
  notifyIndexingSyncStarted,
  type IndexingProgressStats
} from "@/lib/indexingProgress";
import { IndexingQueueList } from "@/components/IndexingQueueList";

const POLL_MS = 10_000;
const COMPLETE_FLASH_MS = 45_000;
const SHOW_DELAY_MS = 400;

type DisplayPhase = "hidden" | "active" | "complete";

function statusLine(stats: IndexingProgressStats, phase: DisplayPhase): string {
  if (phase === "complete") {
    if (stats.error > 0) {
      return `Indexing finished — ${stats.ready} ready, ${stats.error} failed`;
    }
    if (stats.readyWithEmbeddingWarning > 0) {
      return `Indexing complete — ${stats.ready} ready (${stats.readyWithEmbeddingWarning} embedding warning${stats.readyWithEmbeddingWarning === 1 ? "" : "s"})`;
    }
    return `Indexing complete — ${stats.ready} repo${stats.ready === 1 ? "" : "s"} ready`;
  }
  const parts = [`${stats.ready}/${stats.total} ready`];
  if (stats.indexing > 0) {
    parts.push(`${stats.indexing} running`);
  }
  if (stats.queued > 0) {
    parts.push(`${stats.queued} queued`);
  }
  if (stats.error > 0) {
    parts.push(`${stats.error} failed`);
  }
  if (stats.readyWithEmbeddingWarning > 0) {
    parts.push(`${stats.readyWithEmbeddingWarning} embedding warning${stats.readyWithEmbeddingWarning === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function ProgressTrack({
  stats,
  phase
}: {
  stats: IndexingProgressStats;
  phase: DisplayPhase;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            phase === "complete" ? "bg-emerald-400" : "bg-coop-index"
          }`}
          style={{ width: `${stats.progressPercent}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-xs text-coop-muted">
        {stats.progressPercent}%
      </span>
    </div>
  );
}

function ActionButtons({
  onDismiss,
  minimize
}: {
  onDismiss: () => void;
  minimize?: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {minimize ? (
        <button type="button" className="admin-btn-secondary !px-2 !py-1 text-xs" onClick={minimize}>
          Minimize
        </button>
      ) : null}
      <Link href="/indexing" className="admin-btn-secondary !px-2 !py-1 text-xs">
        Details
      </Link>
      <button
        type="button"
        className="admin-btn-secondary !px-2 !py-1 text-xs"
        aria-label="Dismiss indexing progress"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

export function IndexingProgressBar(): React.ReactElement | null {
  const [repos, setRepos] = useState<OrgRepoRecord[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<DisplayPhase>("hidden");
  const [visible, setVisible] = useState(false);
  const wasInFlightRef = useRef(false);
  const completeTimerRef = useRef<number | null>(null);
  const showDelayTimerRef = useRef<number | null>(null);

  const stats = computeIndexingStats(repos);
  const queue = buildIndexingQueue(repos);

  const refresh = useCallback(async () => {
    const result = await fetchOrgRepos();
    if (result.ok && result.data?.repos) {
      setRepos(result.data.repos);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    dismissIndexingProgress();
    setDismissed(true);
    setVisible(false);
  }, []);

  useEffect(() => {
    setDismissed(isIndexingDismissed());
    void refresh();
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const onSync = () => {
      sessionStorage.removeItem(INDEXING_DISMISS_KEY);
      setDismissed(false);
      void refresh();
    };
    window.addEventListener(INDEXING_SYNC_EVENT, onSync);
    return () => window.removeEventListener(INDEXING_SYNC_EVENT, onSync);
  }, [refresh]);

  useEffect(() => {
    if (stats.inFlight > 0) {
      wasInFlightRef.current = true;
      if (completeTimerRef.current) {
        window.clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
      setPhase("active");
      return;
    }

    if (wasInFlightRef.current && stats.total > 0) {
      wasInFlightRef.current = false;
      setPhase(stats.ready > 0 ? "complete" : "hidden");
      if (stats.ready > 0) {
        completeTimerRef.current = window.setTimeout(() => {
          setPhase("hidden");
          setVisible(false);
          completeTimerRef.current = null;
        }, COMPLETE_FLASH_MS);
      }
      return;
    }

    if (phase === "active") {
      setPhase("hidden");
    }
  }, [stats.inFlight, stats.total, stats.ready, phase]);

  useEffect(() => {
    if (showDelayTimerRef.current) {
      window.clearTimeout(showDelayTimerRef.current);
      showDelayTimerRef.current = null;
    }

    if (dismissed || phase === "hidden" || stats.total === 0) {
      setVisible(false);
      return;
    }

    if (phase === "complete") {
      setVisible(true);
      return;
    }

    if (stats.inFlight > 0) {
      showDelayTimerRef.current = window.setTimeout(() => {
        setVisible(true);
        showDelayTimerRef.current = null;
      }, SHOW_DELAY_MS);
      return;
    }

    setVisible(false);
  }, [dismissed, phase, stats.inFlight, stats.total]);

  useEffect(() => {
    return () => {
      if (completeTimerRef.current) {
        window.clearTimeout(completeTimerRef.current);
      }
      if (showDelayTimerRef.current) {
        window.clearTimeout(showDelayTimerRef.current);
      }
    };
  }, []);

  if (!visible) {
    return null;
  }

  const line = statusLine(stats, phase);
  const title = phase === "complete" ? "Indexing complete" : "Deep index in progress";
  const barClass =
    phase === "complete"
      ? "border-emerald-500/40 bg-emerald-950/40"
      : "border-coop-index/30 bg-coop-dark/95";

  if (!expanded) {
    return (
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 w-[min(100vw-2rem,20rem)]">
        <div
          className={`pointer-events-auto rounded-md border px-3 py-2.5 shadow-lg backdrop-blur-sm ${barClass}`}
        >
          <div className="flex items-start gap-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpanded(true)}>
              <p className="text-xs font-medium text-white">
                {phase === "complete" ? "Indexing complete" : "Indexing in progress"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-coop-muted">{line}</p>
              <div className="mt-2">
                <ProgressTrack stats={stats} phase={phase} />
              </div>
            </button>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-sm leading-none text-coop-muted hover:bg-white/5 hover:text-white"
              aria-label="Dismiss indexing progress"
              onClick={handleDismiss}
            >
              ×
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 w-[min(100vw-2rem,22rem)]">
      <div
        className={`pointer-events-auto rounded-md border px-4 py-3 shadow-xl backdrop-blur-sm ${barClass}`}
      >
        <p className="text-sm font-medium leading-snug text-white">{title}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-coop-muted">{line}</p>
        <div className="mt-3">
          <ProgressTrack stats={stats} phase={phase} />
        </div>
        {phase === "active" && (queue.inFlight.length > 0 || queue.attention.length > 0) ? (
          <div className="mt-3 max-h-48 overflow-y-auto border-t border-white/10 pt-3">
            <IndexingQueueList
              inFlight={queue.inFlight}
              attention={queue.attention}
              compact
              maxReady={0}
            />
          </div>
        ) : null}
        <div className="mt-3 border-t border-white/10 pt-3">
          <ActionButtons onDismiss={handleDismiss} minimize={() => setExpanded(false)} />
        </div>
      </div>
    </div>
  );
}

/** Re-export for indexing page after sync. */
export { notifyIndexingSyncStarted };

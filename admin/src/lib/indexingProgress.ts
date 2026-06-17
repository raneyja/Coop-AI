import type { OrgRepoRecord } from "@/lib/coopApi";
import type { CodeHostProvider } from "@/lib/integrations";
import { codeHostLabel } from "@/lib/coopApi";

export type IndexingProgressStats = {
  total: number;
  ready: number;
  readyWithEmbeddingWarning: number;
  queued: number;
  indexing: number;
  error: number;
  idle: number;
  inFlight: number;
  progressPercent: number;
};

export const INDEXING_DISMISS_KEY = "coop_admin_indexing_progress_dismissed";
export const INDEXING_SYNC_EVENT = "coop:indexing-sync-started";

export function hasEmbeddingWarning(repo: OrgRepoRecord): boolean {
  return repo.indexStatus === "ready" && repo.embeddingStatus === "failed";
}

export function computeIndexingStats(repos: OrgRepoRecord[]): IndexingProgressStats {
  let total = 0;
  let ready = 0;
  let readyWithEmbeddingWarning = 0;
  let queued = 0;
  let indexing = 0;
  let error = 0;
  let idle = 0;

  for (const repo of repos) {
    if (!repo.lightningEnabled) {
      continue;
    }
    total += 1;
    const status = repo.indexStatus ?? "idle";
    if (status === "ready") {
      ready += 1;
      if (hasEmbeddingWarning(repo)) {
        readyWithEmbeddingWarning += 1;
      }
    } else if (status === "queued") {
      queued += 1;
    } else if (status === "indexing" || status === "cloning") {
      indexing += 1;
    } else if (status === "error") {
      error += 1;
    } else {
      idle += 1;
    }
  }

  const inFlight = queued + indexing;
  const fullyReady = Math.max(0, ready - readyWithEmbeddingWarning);
  const progressPercent =
    total > 0
      ? Math.min(
          100,
          Math.round(
            ((fullyReady + readyWithEmbeddingWarning * 0.9 + indexing * 0.5 + queued * 0.1) / total) *
              100
          )
        )
      : 0;

  return {
    total,
    ready,
    readyWithEmbeddingWarning,
    queued,
    indexing,
    error,
    idle,
    inFlight,
    progressPercent
  };
}

export function notifyIndexingSyncStarted(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (window.location.pathname.startsWith("/indexing")) {
    return;
  }
  sessionStorage.removeItem(INDEXING_DISMISS_KEY);
  window.dispatchEvent(new CustomEvent(INDEXING_SYNC_EVENT));
}

export function isIndexingDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return sessionStorage.getItem(INDEXING_DISMISS_KEY) === "1";
}

export function dismissIndexingProgress(): void {
  sessionStorage.setItem(INDEXING_DISMISS_KEY, "1");
}

export type IndexingQueueBucket = "in_flight" | "attention" | "ready" | "idle";

export type IndexingQueueItem = {
  repoId: string;
  repoName: string;
  indexStatus: string;
  embeddingStatus?: string;
  displayStatus: string;
  bucket: IndexingQueueBucket;
  lastIndexedAt?: string;
  errorNote?: string;
};

export type IndexingQueueSections = {
  inFlight: IndexingQueueItem[];
  attention: IndexingQueueItem[];
  ready: IndexingQueueItem[];
  idle: IndexingQueueItem[];
};

export function shortRepoName(repoId: string): string {
  const slash = repoId.indexOf(":");
  return slash >= 0 ? repoId.slice(slash + 1) : repoId;
}

export function parseCodeHostFromRepoId(repoId: string): CodeHostProvider | null {
  const colon = repoId.indexOf(":");
  if (colon < 0) {
    return "github";
  }
  const prefix = repoId.slice(0, colon);
  if (prefix === "github" || prefix === "gitlab" || prefix === "bitbucket") {
    return prefix;
  }
  return null;
}

export type EmbeddingBadgeTone = "complete" | "failed" | "skipped" | "pending" | "legacy" | "none";

export function embeddingBadgeTone(repo: OrgRepoRecord): EmbeddingBadgeTone {
  if (isRepoInFlight(repo)) {
    if (repo.indexStatus === "queued") {
      return "none";
    }
    return "pending";
  }
  if (repo.indexStatus === "ready" && !repo.embeddingStatus) {
    return "legacy";
  }
  const status = repo.embeddingStatus;
  if (!status) {
    return "none";
  }
  if (status === "complete" || status === "failed" || status === "skipped" || status === "pending") {
    return status;
  }
  return "none";
}

export function formatEmbeddingBadgeLabel(repo: OrgRepoRecord): string {
  const tone = embeddingBadgeTone(repo);
  if (tone === "none") {
    return "—";
  }
  if (tone === "complete") {
    return "Complete";
  }
  if (tone === "failed") {
    return "Failed";
  }
  if (tone === "skipped") {
    return "Skipped";
  }
  if (tone === "legacy") {
    return "Not recorded";
  }
  return "Pending";
}

export function isRepoInFlight(repo: OrgRepoRecord): boolean {
  const status = repo.indexStatus ?? "idle";
  return status === "queued" || status === "indexing" || status === "cloning";
}

export function codeHostBadgeLabel(repoId: string): string {
  const host = parseCodeHostFromRepoId(repoId);
  return host ? codeHostLabel(host) : "Unknown";
}

export function filterReposForIndexingView(
  repos: OrgRepoRecord[],
  query: string,
  hostFilter: CodeHostProvider | "all" = "all"
): OrgRepoRecord[] {
  const normalizedQuery = query.trim().toLowerCase();

  return repos.filter((repo) => {
    const host = parseCodeHostFromRepoId(repo.repoId);
    if (hostFilter !== "all" && host !== hostFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [
      repo.repoId,
      shortRepoName(repo.repoId),
      host ? codeHostLabel(host) : "",
      repo.indexStatus,
      repo.embeddingStatus,
      formatIndexingDisplayStatus(repo),
      formatEmbeddingBadgeLabel(repo),
      repo.error,
      repo.embeddingError,
      repo.lastJobId
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function formatIndexingDisplayStatus(repo: OrgRepoRecord): string {
  if (repo.indexStatus === "ready" && repo.embeddingStatus === "failed") {
    return "Embeddings pending";
  }
  if (repo.indexStatus === "indexing") {
    return "Indexing";
  }
  if (repo.indexStatus === "cloning") {
    return "Cloning";
  }
  if (repo.indexStatus === "queued") {
    return "Queued";
  }
  if (repo.indexStatus === "error") {
    return "Failed";
  }
  if (repo.indexStatus === "ready") {
    return "Ready";
  }
  return repo.indexStatus ?? "Idle";
}

const IN_FLIGHT_RANK: Record<string, number> = {
  indexing: 0,
  cloning: 1,
  queued: 2
};

export function buildIndexingQueue(repos: OrgRepoRecord[]): IndexingQueueSections {
  const inFlight: IndexingQueueItem[] = [];
  const attention: IndexingQueueItem[] = [];
  const ready: IndexingQueueItem[] = [];
  const idle: IndexingQueueItem[] = [];

  for (const repo of repos) {
    if (!repo.lightningEnabled) {
      continue;
    }

    const status = repo.indexStatus ?? "idle";
    const item: IndexingQueueItem = {
      repoId: repo.repoId,
      repoName: shortRepoName(repo.repoId),
      indexStatus: status,
      embeddingStatus: repo.embeddingStatus,
      displayStatus: formatIndexingDisplayStatus(repo),
      bucket: "idle",
      lastIndexedAt: repo.lastIndexedAt,
      errorNote:
        status === "error"
          ? repo.error
          : repo.embeddingStatus === "failed"
            ? repo.embeddingError
            : undefined
    };

    if (status === "queued" || status === "indexing" || status === "cloning") {
      item.bucket = "in_flight";
      inFlight.push(item);
    } else if (status === "error" || hasEmbeddingWarning(repo)) {
      item.bucket = "attention";
      attention.push(item);
    } else if (status === "ready") {
      item.bucket = "ready";
      ready.push(item);
    } else {
      item.bucket = "idle";
      idle.push(item);
    }
  }

  inFlight.sort(
    (a, b) =>
      (IN_FLIGHT_RANK[a.indexStatus] ?? 9) - (IN_FLIGHT_RANK[b.indexStatus] ?? 9) ||
      a.repoName.localeCompare(b.repoName)
  );
  attention.sort((a, b) => a.repoName.localeCompare(b.repoName));
  ready.sort((a, b) => String(b.lastIndexedAt ?? "").localeCompare(String(a.lastIndexedAt ?? "")));
  idle.sort((a, b) => a.repoName.localeCompare(b.repoName));

  return { inFlight, attention, ready, idle };
}

export function sortReposForIndexingView(repos: OrgRepoRecord[]): OrgRepoRecord[] {
  const rank = (repo: OrgRepoRecord): number => {
    const status = repo.indexStatus ?? "idle";
    if (status === "indexing" || status === "cloning") {
      return 0;
    }
    if (status === "queued") {
      return 1;
    }
    if (status === "error") {
      return 2;
    }
    if (hasEmbeddingWarning(repo)) {
      return 3;
    }
    if (status === "ready") {
      return 4;
    }
    return 5;
  };

  return [...repos].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) {
      return byRank;
    }
    return shortRepoName(a.repoId).localeCompare(shortRepoName(b.repoId));
  });
}

export function formatRelativeTime(iso?: string): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 60_000) {
    return "just now";
  }
  if (deltaMs < 3_600_000) {
    return `${Math.round(deltaMs / 60_000)}m ago`;
  }
  if (deltaMs < 86_400_000) {
    return `${Math.round(deltaMs / 3_600_000)}h ago`;
  }
  return date.toLocaleString();
}

export function reposMatchingQueue(
  items: IndexingQueueItem[],
  repos: OrgRepoRecord[]
): OrgRepoRecord[] {
  const byId = new Map(repos.map((repo) => [repo.repoId, repo]));
  return items
    .map((item) => byId.get(item.repoId))
    .filter((repo): repo is OrgRepoRecord => Boolean(repo));
}

"use client";

import { useMemo, useState } from "react";
import type { OrgRepoRecord } from "@/lib/coopApi";
import { codeHostLabel } from "@/lib/coopApi";
import type { CodeHostProvider } from "@/lib/integrations";
import { AdminChip } from "@/components/AdminChip";
import {
  buildIndexingQueue,
  codeHostBadgeLabel,
  embeddingBadgeTone,
  filterReposForIndexingView,
  formatEmbeddingBadgeLabel,
  formatIndexingDisplayStatus,
  formatRelativeTime,
  hasBrowseFailure,
  hasEmbeddingWarning,
  isFullyUsable,
  isRepoInFlight,
  parseCodeHostFromRepoId,
  reposMatchingQueue,
  shortRepoName,
  type EmbeddingBadgeTone,
  type IndexingQueueSections
} from "@/lib/indexingProgress";

type IndexingRepoSectionsProps = {
  repos: OrgRepoRecord[];
  actionId: string | null;
  onReindex: (repoId: string) => void;
  onDisable?: (repoId: string) => void;
  onVerifyBrowse?: (repoId: string) => void;
  onExplainProgress?: (repo: OrgRepoRecord) => void;
  indexedRepoLimit?: number | null;
  indexedRepoCount?: number;
};

const EMBEDDING_BADGE_CLASS: Record<EmbeddingBadgeTone, string> = {
  complete: "border-emerald-500/30 bg-emerald-950/40 text-emerald-200",
  failed: "border-amber-500/30 bg-amber-950/40 text-amber-200",
  skipped: "border-white/10 bg-white/[0.04] text-coop-muted",
  pending: "border-sky-500/30 bg-sky-950/40 text-sky-200",
  legacy: "border-white/10 bg-white/[0.03] text-coop-muted",
  none: "border-white/10 bg-white/[0.02] text-coop-muted"
};

const CODE_HOST_CHIP_CLASS: Record<CodeHostProvider, string> = {
  github: "border-white/15 bg-white/[0.06] text-white",
  gitlab: "border-orange-500/30 bg-orange-950/30 text-orange-200",
  bitbucket: "border-sky-500/30 bg-sky-950/30 text-sky-200"
};

function statusDotClass(repo: OrgRepoRecord): string {
  const status = repo.indexStatus ?? "idle";
  if (status === "indexing" || status === "cloning") {
    return "bg-sky-400 shadow-[0_0_0_2px_rgba(56,189,248,0.25)] animate-pulse";
  }
  if (status === "queued") {
    return "bg-amber-300/90";
  }
  if (status === "error" || hasBrowseFailure(repo)) {
    return "bg-red-400";
  }
  if (hasEmbeddingWarning(repo)) {
    return "bg-amber-300";
  }
  if (isFullyUsable(repo)) {
    return "bg-emerald-400";
  }
  if (status === "ready") {
    return "bg-emerald-400/70";
  }
  return "bg-white/30";
}

function statusTextClass(repo: OrgRepoRecord): string {
  if (hasBrowseFailure(repo)) {
    return "text-red-300";
  }
  if (hasEmbeddingWarning(repo)) {
    return "text-amber-300";
  }
  if (repo.indexStatus === "error") {
    return "text-red-300";
  }
  if (repo.indexStatus === "indexing" || repo.indexStatus === "queued" || repo.indexStatus === "cloning") {
    return "text-sky-300";
  }
  if (isFullyUsable(repo)) {
    return "text-emerald-300";
  }
  return "";
}

function detailNote(repo: OrgRepoRecord): string {
  if (isRepoInFlight(repo) && repo.indexStageDetail) {
    return repo.indexStageDetail;
  }
  if (repo.indexStatus === "error") {
    return repo.error ?? "—";
  }
  if (hasBrowseFailure(repo)) {
    return repo.browseError ?? "Browse verification failed.";
  }
  if (repo.embeddingError) {
    return repo.embeddingError;
  }
  return "—";
}

function EmbeddingBadge({ repo }: { repo: OrgRepoRecord }): React.ReactElement {
  const tone = embeddingBadgeTone(repo);
  const label = formatEmbeddingBadgeLabel(repo);
  const title =
    tone === "legacy"
      ? "Indexed before embedding status was tracked. Reindex to refresh."
      : repo.embeddingError;
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${EMBEDDING_BADGE_CLASS[tone]}`}
      title={title}
    >
      {label}
    </span>
  );
}

function IndexStatusCell({ repo }: { repo: OrgRepoRecord }): React.ReactElement {
  const inFlight = isRepoInFlight(repo);
  const progress =
    typeof repo.indexProgress === "number" ? Math.max(0, Math.min(100, repo.indexProgress)) : undefined;

  return (
    <div className="min-w-[7rem]">
      <span className={statusTextClass(repo)}>{formatIndexingDisplayStatus(repo)}</span>
      {inFlight ? (
        <div className="mt-1.5">
          <div className="h-1.5 w-full max-w-[7rem] overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                repo.indexStatus === "queued"
                  ? "bg-amber-300/90"
                  : progress !== undefined && progress >= 65 && progress <= 85
                    ? "bg-sky-400 animate-pulse"
                    : "bg-sky-400"
              }`}
              style={{
                width: `${
                  progress ?? (repo.indexStatus === "queued" ? 8 : 20)
                }%`
              }}
            />
          </div>
          {progress !== undefined ? (
            <p className="mt-0.5 font-mono text-[10px] text-coop-muted">{progress}%</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function IndexDetailsCell({
  repo,
  onExplainProgress
}: {
  repo: OrgRepoRecord;
  onExplainProgress?: (repo: OrgRepoRecord) => void;
}): React.ReactElement {
  const inFlight = isRepoInFlight(repo);
  const note = detailNote(repo);

  return (
    <div className="max-w-[16rem]">
      <p className="text-xs leading-snug text-coop-muted">{note}</p>
      {onExplainProgress && inFlight ? (
        <button
          type="button"
          className="mt-1 text-[10px] text-coop-index hover:underline"
          onClick={() => onExplainProgress(repo)}
        >
          What’s happening?
        </button>
      ) : null}
    </div>
  );
}

function CodeHostBadge({ repoId }: { repoId: string }): React.ReactElement {
  const host = parseCodeHostFromRepoId(repoId);
  const label = codeHostBadgeLabel(repoId);
  if (!host) {
    return <span className="text-xs text-coop-muted">{label}</span>;
  }
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${CODE_HOST_CHIP_CLASS[host]}`}
    >
      {label}
    </span>
  );
}

function shortJobId(jobId?: string): string {
  if (!jobId) {
    return "—";
  }
  if (jobId.length <= 12) {
    return jobId;
  }
  return `${jobId.slice(0, 8)}…`;
}

function RepoRow({
  repo,
  actionId,
  onReindex,
  onDisable,
  onVerifyBrowse,
  onExplainProgress,
  showJobIds
}: {
  repo: OrgRepoRecord;
  actionId: string | null;
  onReindex: (repoId: string) => void;
  onDisable?: (repoId: string) => void;
  onVerifyBrowse?: (repoId: string) => void;
  onExplainProgress?: (repo: OrgRepoRecord) => void;
  showJobIds: boolean;
}): React.ReactElement {
  const disableId = `off:${repo.repoId}`;
  const verifyId = `verify:${repo.repoId}`;
  return (
    <tr className="border-b border-coop-border/40">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(repo)}`} aria-hidden />
          <span className="font-mono text-xs text-white" title={repo.repoId}>
            {shortRepoName(repo.repoId)}
          </span>
        </div>
      </td>
      <td className="px-4 py-2">
        <CodeHostBadge repoId={repo.repoId} />
      </td>
      <td className="px-4 py-2">{repo.lightningEnabled ? "On" : "Off"}</td>
      <td className="px-4 py-2">
        <IndexStatusCell repo={repo} />
      </td>
      <td className="px-4 py-2">
        <IndexDetailsCell repo={repo} onExplainProgress={onExplainProgress} />
      </td>
      <td className="px-4 py-2">
        <EmbeddingBadge repo={repo} />
      </td>
      <td className="px-4 py-2 text-coop-muted" title={repo.lastIndexedAt ?? undefined}>
        {formatRelativeTime(repo.lastIndexedAt)}
      </td>
      {showJobIds ? (
        <td className="px-4 py-2 font-mono text-[11px] text-coop-muted" title={repo.lastJobId ?? undefined}>
          {shortJobId(repo.lastJobId)}
        </td>
      ) : null}
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {repo.lightningEnabled ? (
            <button
              type="button"
              className={`admin-btn-secondary min-w-[4.75rem] !px-2 !py-1 text-xs ${
                actionId === repo.repoId ? "pointer-events-none opacity-60" : ""
              }`}
              aria-busy={actionId === repo.repoId}
              onClick={() => onReindex(repo.repoId)}
            >
              Reindex
            </button>
          ) : null}
          {repo.lightningEnabled && onVerifyBrowse && (hasBrowseFailure(repo) || repo.indexStatus === "ready") ? (
            <button
              type="button"
              className={`admin-btn-secondary min-w-[4.75rem] !px-2 !py-1 text-xs ${
                actionId === verifyId ? "pointer-events-none opacity-60" : ""
              }`}
              aria-busy={actionId === verifyId}
              onClick={() => onVerifyBrowse(repo.repoId)}
            >
              Re-verify
            </button>
          ) : null}
          {repo.lightningEnabled && onDisable ? (
            <button
              type="button"
              className={`admin-btn-danger min-w-[4.75rem] !px-2 !py-1 text-xs ${
                actionId === disableId ? "pointer-events-none opacity-60" : ""
              }`}
              aria-busy={actionId === disableId}
              onClick={() => onDisable(repo.repoId)}
            >
              Turn off
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function SectionHeader({
  title,
  count,
  total,
  colSpan
}: {
  title: string;
  count: number;
  total?: number;
  colSpan: number;
}): React.ReactElement {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-coop-muted">
        {title}{" "}
        <span className="text-white/80">
          ({count}
          {total !== undefined && total !== count ? ` of ${total}` : ""})
        </span>
      </td>
    </tr>
  );
}

function RepoSection({
  title,
  items,
  repos,
  count,
  total,
  actionId,
  onReindex,
  onDisable,
  onVerifyBrowse,
  onExplainProgress,
  showJobIds,
  colSpan
}: {
  title: string;
  items: IndexingQueueSections["inFlight"];
  repos: OrgRepoRecord[];
  count: number;
  total?: number;
  actionId: string | null;
  onReindex: (repoId: string) => void;
  onDisable?: (repoId: string) => void;
  onVerifyBrowse?: (repoId: string) => void;
  onExplainProgress?: (repo: OrgRepoRecord) => void;
  showJobIds: boolean;
  colSpan: number;
}): React.ReactElement | null {
  const sectionRepos = reposMatchingQueue(items, repos);
  if (sectionRepos.length === 0) {
    return null;
  }
  return (
    <>
      <SectionHeader title={title} count={count} total={total} colSpan={colSpan} />
      {sectionRepos.map((repo) => (
        <RepoRow
          key={repo.repoId}
          repo={repo}
          actionId={actionId}
          onReindex={onReindex}
          onDisable={onDisable}
          onVerifyBrowse={onVerifyBrowse}
          onExplainProgress={onExplainProgress}
          showJobIds={showJobIds}
        />
      ))}
    </>
  );
}

export function IndexingRepoSections({
  repos,
  actionId,
  onReindex,
  onDisable,
  onVerifyBrowse,
  onExplainProgress
}: IndexingRepoSectionsProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState("");
  const [hostFilter, setHostFilter] = useState<CodeHostProvider | "all">("all");
  const [showJobIds, setShowJobIds] = useState(false);

  const availableHosts = useMemo(() => {
    const hosts = new Set<CodeHostProvider>();
    for (const repo of repos) {
      const host = parseCodeHostFromRepoId(repo.repoId);
      if (host) {
        hosts.add(host);
      }
    }
    return Array.from(hosts).sort();
  }, [repos]);

  const filteredRepos = useMemo(
    () => filterReposForIndexingView(repos, searchQuery, hostFilter),
    [repos, searchQuery, hostFilter]
  );

  const queue = useMemo(() => buildIndexingQueue(filteredRepos), [filteredRepos]);
  const indexedTotal = queue.ready.length;
  const indexedPoolTotal =
    queue.inFlight.length + queue.attention.length + queue.ready.length + queue.idle.length;
  const colSpan = showJobIds ? 9 : 8;

  const hasRows =
    queue.inFlight.length > 0 ||
    queue.attention.length > 0 ||
    queue.ready.length > 0 ||
    queue.idle.length > 0;

  const filterActive = searchQuery.trim().length > 0 || hostFilter !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <label className="admin-section-label block" htmlFor="indexing-search">
            Search repositories
          </label>
          <input
            id="indexing-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Name, status, error, job ID…"
            className="admin-input"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {availableHosts.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              <HostFilterChip active={hostFilter === "all"} onClick={() => setHostFilter("all")}>
                All hosts
              </HostFilterChip>
              {availableHosts.map((host) => (
                <HostFilterChip
                  key={host}
                  active={hostFilter === host}
                  onClick={() => setHostFilter(host)}
                >
                  {codeHostLabel(host)}
                </HostFilterChip>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className={`admin-btn-secondary !px-2 !py-1 text-xs ${showJobIds ? "!border-coop-index/40" : ""}`}
            onClick={() => setShowJobIds((value) => !value)}
          >
            {showJobIds ? "Hide job IDs" : "Show job IDs"}
          </button>
        </div>
      </div>

      {filterActive ? (
        <p className="text-xs text-coop-muted">
          Showing {filteredRepos.length} of {repos.length} repositories
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="admin-table min-w-full">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Host</th>
              <th>Deep index</th>
              <th>Status</th>
              <th>Details</th>
              <th>Embeddings</th>
              <th>Last indexed</th>
              {showJobIds ? <th>Job ID</th> : null}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <RepoSection
              title="In progress"
              items={queue.inFlight}
              repos={filteredRepos}
              count={queue.inFlight.length}
              actionId={actionId}
              onReindex={onReindex}
              onDisable={onDisable}
              onVerifyBrowse={onVerifyBrowse}
              onExplainProgress={onExplainProgress}
              showJobIds={showJobIds}
              colSpan={colSpan}
            />
            <RepoSection
              title="Needs attention"
              items={queue.attention}
              repos={filteredRepos}
              count={queue.attention.length}
              actionId={actionId}
              onReindex={onReindex}
              onDisable={onDisable}
              onVerifyBrowse={onVerifyBrowse}
              onExplainProgress={onExplainProgress}
              showJobIds={showJobIds}
              colSpan={colSpan}
            />
            <RepoSection
              title="Usable repos"
              items={queue.ready}
              repos={filteredRepos}
              count={indexedTotal}
              total={indexedPoolTotal}
              actionId={actionId}
              onReindex={onReindex}
              onDisable={onDisable}
              onVerifyBrowse={onVerifyBrowse}
              onExplainProgress={onExplainProgress}
              showJobIds={showJobIds}
              colSpan={colSpan}
            />
            <RepoSection
              title="Awaiting index"
              items={queue.idle}
              repos={filteredRepos}
              count={queue.idle.length}
              actionId={actionId}
              onReindex={onReindex}
              onDisable={onDisable}
              onVerifyBrowse={onVerifyBrowse}
              onExplainProgress={onExplainProgress}
              showJobIds={showJobIds}
              colSpan={colSpan}
            />
            {!hasRows ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-6 text-center text-coop-muted">
                  {filterActive
                    ? "No repositories match your search."
                    : "No indexed repositories yet. Use Configure on the Indexing page to choose repos."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HostFilterChip({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  if (active) {
    return <AdminChip variant="plan-pro">{children}</AdminChip>;
  }
  return (
    <button
      type="button"
      className="rounded border border-coop-border px-2 py-1 text-xs text-coop-muted hover:border-white/20 hover:text-white"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

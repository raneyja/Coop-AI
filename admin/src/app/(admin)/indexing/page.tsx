"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodeHostProvider } from "@/lib/integrations";
import { CODE_HOST_PROVIDERS } from "@/lib/integrations";
import {
  codeHostLabel,
  enableLightningRepo,
  fetchIntegrations,
  fetchOrg,
  fetchOrgRepos,
  reindexEmbeddingFailures,
  syncCatalog,
  type OrgRepoRecord
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { AdminStat, AdminStatRow } from "@/components/AdminStatRow";
import { IndexingEstateProgress } from "@/components/IndexingEstateProgress";
import { IndexingRepoSections } from "@/components/IndexingRepoSections";
import { computeIndexingStats, shortRepoName } from "@/lib/indexingProgress";

function statusBucket(status?: string, embeddingStatus?: string): "ready" | "indexing" | "error" | "warning" | "other" {
  if (status === "ready") {
    return embeddingStatus === "failed" ? "warning" : "ready";
  }
  if (status === "indexing" || status === "queued" || status === "cloning") {
    return "indexing";
  }
  if (status === "error") {
    return "error";
  }
  return "other";
}

export default function IndexingPage() {
  const [repos, setRepos] = useState<OrgRepoRecord[]>([]);
  const [connectedHosts, setConnectedHosts] = useState<CodeHostProvider[]>([]);
  const [orgPlan, setOrgPlan] = useState<string>("free");
  const [initialLoading, setInitialLoading] = useState(true);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const stats = useMemo(() => computeIndexingStats(repos), [repos]);
  const inFlightCount = stats.inFlight;

  const summary = useMemo(() => {
    const buckets = { total: repos.length, ready: 0, warning: 0, indexing: 0, error: 0 };
    for (const repo of repos) {
      const bucket = statusBucket(repo.indexStatus, repo.embeddingStatus);
      if (bucket === "ready") {
        buckets.ready += 1;
      } else if (bucket === "warning") {
        buckets.warning += 1;
        buckets.ready += 1;
      } else if (bucket === "indexing") {
        buckets.indexing += 1;
      } else if (bucket === "error") {
        buckets.error += 1;
      }
    }
    return buckets;
  }, [repos]);

  const syncableHosts = useMemo(() => {
    if (orgPlan === "enterprise") {
      return connectedHosts;
    }
    return connectedHosts.filter((provider) => provider === "github");
  }, [connectedHosts, orgPlan]);

  const load = useCallback(async (options?: { silent?: boolean; manual?: boolean }) => {
    const silent = options?.silent ?? false;
    const manual = options?.manual ?? false;
    if (manual) {
      setManualRefreshing(true);
    } else if (!silent) {
      setInitialLoading(true);
      setError(null);
    }

    const [reposResult, integrationsResult, orgResult] = await Promise.all([
      fetchOrgRepos(),
      fetchIntegrations(),
      fetchOrg()
    ]);

    if (manual) {
      setManualRefreshing(false);
    } else if (!silent) {
      setInitialLoading(false);
    }

    if (reposResult.unavailable) {
      setUnavailable(true);
      if (!silent) {
        setRepos([]);
      }
      return;
    }

    setUnavailable(false);
    if (!reposResult.ok) {
      if (!silent) {
        setError(reposResult.error ?? "Failed to load repositories.");
      }
      return;
    }

    setRepos(reposResult.data?.repos ?? []);
    if (integrationsResult.ok && integrationsResult.data) {
      setConnectedHosts(
        CODE_HOST_PROVIDERS.filter((provider) =>
          integrationsResult.data!.some((entry) => entry.provider === provider && entry.installed)
        )
      );
    }
    if (orgResult.ok && orgResult.data?.plan) {
      setOrgPlan(orgResult.data.plan);
    }
  }, []);

  useEffect(() => {
    void load();
    const intervalMs = inFlightCount > 0 ? 3_000 : 10_000;
    const timer = window.setInterval(() => void load({ silent: true }), intervalMs);
    return () => window.clearInterval(timer);
  }, [load, inFlightCount]);

  async function handleSync(provider: CodeHostProvider) {
    setActionId(`sync:${provider}`);
    setSyncMessage(null);
    setError(null);
    const result = await syncCatalog(provider);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Catalog sync failed.");
      return;
    }
    const data = result.data;
    const label = codeHostLabel(provider);
    setSyncMessage(
      data
        ? `${label}: discovered ${data.discovered} repos · queued ${data.queued} · skipped ${data.skipped}`
        : `${label} catalog sync started.`
    );
    await load({ silent: true });
  }

  async function handleReindex(repoId: string) {
    setActionId(repoId);
    setError(null);
    setActionMessage(null);
    const result = await enableLightningRepo(repoId);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Re-index failed.");
      return;
    }
    setActionMessage(`Queued ${shortRepoName(repoId)} for indexing.`);
    await load({ silent: true });
  }

  async function handleRetryEmbeddingFailures() {
    setActionId("retry-embeddings");
    setError(null);
    setActionMessage(null);
    const result = await reindexEmbeddingFailures();
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Failed to queue embedding retries.");
      return;
    }
    const data = result.data;
    setActionMessage(
      data
        ? `Queued ${data.queued} repo(s) for embedding retry · skipped ${data.skipped}`
        : "Embedding retry queued."
    );
    await load({ silent: true });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title flex items-center gap-2">
            Indexing
            <span
              className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-coop-muted/30 border-t-coop-index transition-opacity duration-200 ${
                manualRefreshing ? "animate-spin opacity-100" : "opacity-0"
              }`}
              aria-hidden
            />
          </h1>
          <p className="mt-1 text-sm text-coop-muted">
            Deep-indexed repos across your connected code hosts — status refreshes every 10 seconds.
            {orgPlan === "enterprise"
              ? " Enterprise orgs can sync GitHub, GitLab, and Bitbucket independently."
              : " Pro orgs sync GitHub; add GitLab or Bitbucket on Enterprise."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.warning > 0 ? (
            <button
              type="button"
              className={`admin-btn-primary min-w-[10rem] ${actionId === "retry-embeddings" ? "pointer-events-none opacity-60" : ""}`}
              disabled={unavailable || initialLoading}
              aria-busy={actionId === "retry-embeddings"}
              onClick={() => void handleRetryEmbeddingFailures()}
            >
              Retry failed embeddings
            </button>
          ) : null}
          {syncableHosts.map((provider) => {
            const syncing = actionId === `sync:${provider}`;
            return (
              <button
                key={provider}
                type="button"
                className={`admin-btn-secondary min-w-[7.5rem] ${syncing ? "pointer-events-none opacity-60" : ""}`}
                disabled={unavailable || initialLoading}
                aria-busy={syncing}
                onClick={() => void handleSync(provider)}
              >
                {`Sync ${codeHostLabel(provider)}`}
              </button>
            );
          })}
          <button
            type="button"
            className={`admin-btn-secondary min-w-[5.5rem] ${manualRefreshing ? "pointer-events-none opacity-60" : ""}`}
            disabled={initialLoading}
            aria-busy={manualRefreshing}
            onClick={() => void load({ silent: true, manual: true })}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="min-h-5">
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {!error && syncMessage ? <p className="text-sm text-emerald-300">{syncMessage}</p> : null}
        {!error && !syncMessage && actionMessage ? (
          <p className="text-sm text-emerald-300">{actionMessage}</p>
        ) : null}
      </div>

      {unavailable ? <UnavailableBanner /> : null}
      {!initialLoading && syncableHosts.length === 0 ? (
        <p className="text-sm text-coop-muted">
          Connect a code host under Integrations to enable catalog sync.
        </p>
      ) : null}

      <AdminStatRow>
        <AdminStat label="Total repos" value={initialLoading ? "—" : String(summary.total)} />
        <AdminStat label="Ready" value={initialLoading ? "—" : String(summary.ready)} />
        <AdminStat label="Embeddings warn" value={initialLoading ? "—" : String(summary.warning)} />
        <AdminStat label="Indexing" value={initialLoading ? "—" : String(summary.indexing)} />
        <AdminStat label="Errors" value={initialLoading ? "—" : String(summary.error)} />
      </AdminStatRow>

      <IndexingEstateProgress stats={stats} loading={initialLoading} />

      {initialLoading ? (
        <div className="py-8 text-center text-sm text-coop-muted">Loading repositories…</div>
      ) : (
        <IndexingRepoSections repos={repos} actionId={actionId} onReindex={(id) => void handleReindex(id)} />
      )}
    </div>
  );
}

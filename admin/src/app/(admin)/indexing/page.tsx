"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodeHostProvider } from "@/lib/integrations";
import { CODE_HOST_PROVIDERS } from "@/lib/integrations";
import {
  codeHostLabel,
  disableLightningRepo,
  enableLightningRepo,
  fetchIntegrations,
  fetchOrg,
  fetchOrgRepos,
  reindexEmbeddingFailures,
  syncCatalog,
  type OrgRepoRecord
} from "@/lib/coopApi";
import { UnavailableBanner } from "@/components/UnavailableBanner";
import { IndexingRepoPickerModal } from "@/components/IndexingRepoPickerModal";
import { IndexingRepoSections } from "@/components/IndexingRepoSections";
import { computeIndexingStats, shortRepoName } from "@/lib/indexingProgress";

type PickerState = {
  open: boolean;
  provider: CodeHostProvider;
};

export default function IndexingPage() {
  const [repos, setRepos] = useState<OrgRepoRecord[]>([]);
  const [connectedHosts, setConnectedHosts] = useState<CodeHostProvider[]>([]);
  const [orgPlan, setOrgPlan] = useState<string>("free");
  const [initialLoading, setInitialLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>({ open: false, provider: "github" });

  const stats = useMemo(() => computeIndexingStats(repos), [repos]);
  const inFlightCount = stats.inFlight;
  const indexedRepos = useMemo(() => repos.filter((repo) => repo.lightningEnabled), [repos]);
  const indexedCount = indexedRepos.length;
  const indexedRepoLimit = orgPlan === "free" ? 3 : null;

  const syncableHosts = useMemo(() => {
    if (orgPlan === "enterprise" || orgPlan === "free") {
      return connectedHosts;
    }
    return connectedHosts.filter((provider) => provider === "github");
  }, [connectedHosts, orgPlan]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setInitialLoading(true);
      setError(null);
    }

    const [reposResult, integrationsResult, orgResult] = await Promise.all([
      fetchOrgRepos(),
      fetchIntegrations(),
      fetchOrg()
    ]);

    if (!silent) {
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
    const trimmed = reposResult.data?.quotaReconciled?.trimmed;
    if (trimmed && trimmed > 0) {
      setActionMessage(
        `Free plan allows 3 Deep-Indexed repos — turned off ${trimmed} extra repo${trimmed === 1 ? "" : "s"} that exceeded the limit.`
      );
    }
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

  useEffect(() => {
    if (!syncMessage) {
      return;
    }
    const timer = window.setTimeout(() => setSyncMessage(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [syncMessage]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }
    const timer = window.setTimeout(() => setActionMessage(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  async function handleConfigure(provider: CodeHostProvider) {
    setActionId(`configure:${provider}`);
    setSyncMessage(null);
    setError(null);
    const result = await syncCatalog(provider);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not load repository catalog.");
      return;
    }
    await load({ silent: true });

    const latestRepos = await fetchOrgRepos();
    if (latestRepos.ok && latestRepos.data?.repos) {
      setRepos(latestRepos.data.repos);
    }
    const currentIndexed = (latestRepos.data?.repos ?? []).filter((repo) => repo.lightningEnabled).length;
    const label = codeHostLabel(provider);
    const discovered = result.data?.discovered ?? 0;
    const remaining = (indexedRepoLimit ?? 999) - currentIndexed;
    if (indexedRepoLimit != null && remaining <= 0) {
      setSyncMessage(
        `${label} — ${discovered} repos available. At the ${indexedRepoLimit}-repo limit — turn off a repo to swap.`
      );
    } else {
      setSyncMessage(`${label} — select repos to Deep-Index.`);
    }
    setPicker({ open: true, provider });
  }

  async function handlePickerConfirm(repoIds: string[]) {
    for (const repoId of repoIds) {
      setActionId(repoId);
      const result = await enableLightningRepo(repoId);
      setActionId(null);
      if (!result.ok) {
        throw new Error(result.error ?? `Failed to Deep-Index ${shortRepoName(repoId)}.`);
      }
    }
    setActionMessage(`Queued ${repoIds.length} repo(s) for Deep-Index.`);
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

  async function handleDisable(repoId: string) {
    setActionId(`off:${repoId}`);
    setError(null);
    setActionMessage(null);
    const result = await disableLightningRepo(repoId);
    setActionId(null);
    if (!result.ok) {
      setError(result.error ?? "Could not turn off Deep-Index.");
      return;
    }
    setActionMessage(`Turned off Deep-Index for ${shortRepoName(repoId)}.`);
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

  const capMessage =
    indexedRepoLimit != null
      ? `${indexedCount}/${indexedRepoLimit} repos Deep-Indexed (Free plan limit).`
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="admin-page-title">Indexing</h1>
          <p className="mt-1 text-sm text-coop-muted">
            Repositories your org has chosen to Deep-Index. Use Configure to add more from a connected code host.
          </p>
          {syncMessage ? (
            <p className="mt-2 text-sm text-emerald-300">{syncMessage}</p>
          ) : capMessage ? (
            <p className="mt-2 text-sm text-coop-muted">{capMessage}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {repos.some(
            (repo) => repo.embeddingStatus === "failed" || repo.embeddingStatus === "skipped"
          ) ? (
            <button
              type="button"
              className={`admin-btn-primary min-w-[10rem] ${actionId === "retry-embeddings" ? "pointer-events-none opacity-60" : ""}`}
              disabled={unavailable || initialLoading}
              aria-busy={actionId === "retry-embeddings"}
              onClick={() => void handleRetryEmbeddingFailures()}
            >
              Run embeddings
            </button>
          ) : null}
          {syncableHosts.map((provider) => {
            const configuring = actionId === `configure:${provider}`;
            return (
              <button
                key={provider}
                type="button"
                className={`admin-btn-secondary min-w-[7.5rem] ${configuring ? "pointer-events-none opacity-60" : ""}`}
                disabled={unavailable || initialLoading}
                aria-busy={configuring}
                onClick={() => void handleConfigure(provider)}
              >
                {`Configure ${codeHostLabel(provider)}`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-5">
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {!error && actionMessage ? <p className="text-sm text-emerald-300">{actionMessage}</p> : null}
      </div>

      {unavailable ? <UnavailableBanner /> : null}
      {!initialLoading && syncableHosts.length === 0 ? (
        <p className="text-sm text-coop-muted">
          Connect a code host under Integrations, then return here to choose repos to Deep-Index.
        </p>
      ) : null}

      {!initialLoading && indexedCount === 0 && syncableHosts.length > 0 ? (
        <div className="rounded-lg border border-coop-border/60 bg-white/[0.02] px-5 py-8 text-center">
          <p className="text-sm font-medium text-white">No repositories indexed yet</p>
          <p className="mt-2 text-sm text-coop-muted">
            Click <span className="text-white">Configure {codeHostLabel(syncableHosts[0])}</span> above to
            browse your repositories and choose which ones to Deep-Index.
          </p>
        </div>
      ) : null}

      {initialLoading ? (
        <div className="py-8 text-center text-sm text-coop-muted">Loading repositories…</div>
      ) : indexedCount > 0 ? (
        <IndexingRepoSections
          repos={indexedRepos}
          actionId={actionId}
          onReindex={(id) => void handleReindex(id)}
          onDisable={(id) => void handleDisable(id)}
          indexedRepoLimit={indexedRepoLimit}
          indexedRepoCount={indexedCount}
        />
      ) : null}

      <IndexingRepoPickerModal
        open={picker.open}
        provider={picker.provider}
        repos={repos}
        maxSelect={indexedRepoLimit ?? 999}
        alreadyIndexed={indexedCount}
        onClose={() => setPicker((current) => ({ ...current, open: false }))}
        onConfirm={handlePickerConfirm}
      />
    </div>
  );
}

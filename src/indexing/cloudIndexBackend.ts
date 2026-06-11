import type { CoopBackendClient } from "../api/CoopBackendClient";
import { isLightningEnabledForRepo, type LightningConfiguration } from "../config/lightningConfig";
import { resolveLicenseStatus, canUseLightningMode } from "../license/licenseChecker";
import type { IndexBackend, IndexRepoStatus } from "./indexBackend";
import type { LocalDependentsResult, LocalSearchResult } from "./types";

export class CloudIndexBackend implements IndexBackend {
  public readonly kind = "cloud" as const;

  public constructor(
    private readonly client: CoopBackendClient,
    private readonly getBaseUrl: () => string,
    private readonly secrets?: import("vscode").SecretStorage
  ) {}

  public async isEnabledForRepo(repoId?: string): Promise<boolean> {
    if (!repoId) {
      return false;
    }
    const license = await resolveLicenseStatus(this.secrets, this.getBaseUrl(), () => this.client);
    const config = await this.readConfigFromSettings();
    return isLightningEnabledForRepo(repoId, license, config);
  }

  public async enableRepo(
    ref: { repoId: string; owner: string; repo: string; branch?: string; provider?: string }
  ): Promise<IndexRepoStatus> {
    const baseUrl = this.getBaseUrl();
    const result = await this.client.enableLightningRepo(baseUrl, ref.repoId);
    await this.markRepoEnabledLocally(ref.repoId, true);
    return {
      repoId: ref.repoId,
      enabled: true,
      status: result.status === "queued" ? "queued" : "indexing",
      lastIndexedAt: undefined,
      error: undefined
    };
  }

  public async disableRepo(repoId: string): Promise<void> {
    await this.client.disableLightningRepo(this.getBaseUrl(), repoId);
    await this.markRepoEnabledLocally(repoId, false);
  }

  public async refreshRepo(ref: { repoId: string; owner: string; repo: string; branch?: string }): Promise<IndexRepoStatus> {
    return this.enableRepo(ref);
  }

  public async getRepoStatus(repoId: string): Promise<IndexRepoStatus | undefined> {
    const status = await this.client.getLightningStatus(this.getBaseUrl(), repoId);
    const repo = status.repo as Record<string, unknown> | undefined;
    if (!repo) {
      return undefined;
    }
    return cloudRecordToStatus(repo);
  }

  public async listRepoStatuses(config: LightningConfiguration): Promise<IndexRepoStatus[]> {
    try {
      const { repos } = await this.client.listOrgRepos(this.getBaseUrl());
      const records = Array.isArray(repos) ? repos : [];
      return records.map((record) => {
        const status = cloudRecordToStatus(record as Record<string, unknown>);
        const local = config.repos.find((entry) => entry.repoId === status.repoId);
        return {
          ...status,
          enabled: local?.enabled ?? status.enabled
        };
      });
    } catch {
      return config.repos.map((entry) => ({
        repoId: entry.repoId,
        enabled: entry.enabled,
        status: entry.enabled ? "ready" : "disabled",
        lastIndexedAt: undefined,
        error: undefined
      }));
    }
  }

  public async search(
    repoId: string,
    pattern: string,
    options?: import("./indexBackend").IndexSearchOptions
  ): Promise<LocalSearchResult> {
    if (!(await this.isEnabledForRepo(repoId))) {
      return { source: "fallback", hits: [], symbols: [], stale: false };
    }
    try {
      const remote = (await this.client.graphSearch(
        this.getBaseUrl(),
        repoId,
        pattern,
        options?.collectionId
      )) as {
        data?: Array<{ path: string; size?: number }>;
        symbols?: Array<{
          symbol: string;
          kind: string;
          file: string;
          line: number;
          displayName?: string;
        }>;
        freshness?: string;
        stale?: boolean;
      };
      const hits = (remote.data ?? []).map((entry, index) => ({
        fileName: entry.path,
        repoId: (entry as { repoId?: string }).repoId,
        lineNumber: index + 1,
        content: entry.path,
        score: 1
      }));
      const symbols = (remote.symbols ?? []).map((entry) => ({
        symbol: entry.symbol,
        kind: entry.kind,
        file: entry.file,
        line: entry.line,
        character: 0,
        displayName: entry.displayName ?? entry.symbol
      }));
      const source =
        remote.freshness === "embedding"
          ? "embedding"
          : remote.freshness === "scip"
            ? "scip"
            : hits.length > 0
              ? "zoekt"
              : "fallback";
      return {
        source,
        hits,
        symbols,
        stale: Boolean(remote.stale)
      };
    } catch {
      return { source: "fallback", hits: [], symbols: [], stale: false };
    }
  }

  public async dependents(repoId: string, file: string): Promise<LocalDependentsResult> {
    if (!(await this.isEnabledForRepo(repoId))) {
      return { file, dependents: [], source: "remote" };
    }
    try {
      const remote = (await this.client.graphDependents(this.getBaseUrl(), repoId, file)) as {
        data?: Array<{ from: string }>;
      };
      const dependents = (remote.data ?? []).map((edge) => edge.from);
      return {
        file,
        dependents,
        source: dependents.length > 0 ? "scip" : "remote"
      };
    } catch {
      return { file, dependents: [], source: "remote" };
    }
  }

  public async summarize(config: LightningConfiguration): Promise<{
    enabledRepos: number;
    totalDiskBytes: number;
    readyRepos: number;
    indexingRepos: number;
  }> {
    const statuses = await this.listRepoStatuses(config);
    const enabled = statuses.filter((entry) => entry.enabled);
    return {
      enabledRepos: enabled.length,
      totalDiskBytes: 0,
      readyRepos: enabled.filter((entry) => entry.status === "ready").length,
      indexingRepos: enabled.filter((entry) => entry.status === "indexing" || entry.status === "queued" || entry.status === "cloning").length
    };
  }

  private async readConfigFromSettings(): Promise<LightningConfiguration> {
    const { readLightningConfiguration } = await import("../config/lightningConfig");
    return readLightningConfiguration();
  }

  private async markRepoEnabledLocally(repoId: string, enabled: boolean): Promise<void> {
    const { setRepoLightningEnabled } = await import("../config/lightningConfig");
    await setRepoLightningEnabled(repoId, enabled);
  }
}

function cloudRecordToStatus(record: Record<string, unknown>): IndexRepoStatus {
  return {
    repoId: String(record.repoId ?? record.repo_id ?? ""),
    enabled: Boolean(record.lightningEnabled ?? record.lightning_enabled),
    status: String(record.indexStatus ?? record.index_status ?? "idle") as IndexRepoStatus["status"],
    lastIndexedAt: record.lastIndexedAt
      ? String(record.lastIndexedAt)
      : record.last_indexed_at
        ? String(record.last_indexed_at)
        : undefined,
    error: record.error ? String(record.error) : undefined
  };
}

export async function cloudLightningAllowed(secrets?: import("vscode").SecretStorage, baseUrl?: string, client?: CoopBackendClient): Promise<boolean> {
  const license = await resolveLicenseStatus(secrets, baseUrl, () => client);
  return canUseLightningMode(license);
}

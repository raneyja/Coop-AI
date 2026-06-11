import type { IndexManager } from "./indexManager";
import type { LightningConfiguration } from "../config/lightningConfig";
import type { IndexBackend, IndexRepoStatus } from "./indexBackend";

export class LocalIndexBackend implements IndexBackend {
  public readonly kind = "local" as const;

  public constructor(private readonly indexManager: IndexManager) {}

  public async isEnabledForRepo(repoId?: string): Promise<boolean> {
    return this.indexManager.isEnabledForRepo(repoId);
  }

  public async enableRepo(
    ref: { repoId: string; owner: string; repo: string; branch?: string; provider?: string },
    localPath?: string
  ): Promise<IndexRepoStatus> {
    const manifest = await this.indexManager.enableRepo(
      {
        repoId: ref.repoId,
        owner: ref.owner,
        repo: ref.repo,
        branch: ref.branch,
        provider: ref.provider as "github" | "gitlab" | "bitbucket" | undefined
      },
      localPath
    );
    return manifestToStatus(manifest);
  }

  public async disableRepo(repoId: string): Promise<void> {
    await this.indexManager.disableRepo(repoId);
  }

  public async refreshRepo(ref: { repoId: string; owner: string; repo: string; branch?: string }): Promise<IndexRepoStatus> {
    const manifest = await this.indexManager.indexRepo({
      repoId: ref.repoId,
      owner: ref.owner,
      repo: ref.repo,
      branch: ref.branch
    });
    return manifestToStatus(manifest);
  }

  public async getRepoStatus(repoId: string): Promise<IndexRepoStatus | undefined> {
    const manifest = this.indexManager.readManifest(repoId);
    return manifest ? manifestToStatus(manifest) : undefined;
  }

  public async listRepoStatuses(config: LightningConfiguration): Promise<IndexRepoStatus[]> {
    return this.indexManager.listIndexedRepos().map((manifest) => ({
      ...manifestToStatus(manifest),
      enabled: config.repos.some((repo) => repo.repoId === manifest.repoId && repo.enabled)
    }));
  }

  public async search(repoId: string, pattern: string, _options?: import("./indexBackend").IndexSearchOptions) {
    return this.indexManager.search(repoId, pattern);
  }

  public async dependents(repoId: string, file: string) {
    return this.indexManager.dependents(repoId, file);
  }

  public async summarize(config: LightningConfiguration) {
    return this.indexManager.summarize(config);
  }

  public getLicenseStatus() {
    return this.indexManager.getLicenseStatus();
  }
}

function manifestToStatus(manifest: {
  repoId: string;
  status: IndexRepoStatus["status"];
  lastIndexedAt?: string;
  error?: string;
  zoektAvailable: boolean;
  scipAvailable: boolean;
  diskUsageBytes: number;
  localPath: string;
}): IndexRepoStatus {
  return {
    repoId: manifest.repoId,
    enabled: true,
    status: manifest.status,
    lastIndexedAt: manifest.lastIndexedAt,
    error: manifest.error,
    zoektAvailable: manifest.zoektAvailable,
    scipAvailable: manifest.scipAvailable,
    diskUsageBytes: manifest.diskUsageBytes,
    localPath: manifest.localPath
  };
}

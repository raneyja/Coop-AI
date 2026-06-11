import type { IndexManifest, LocalDependentsResult, LocalSearchResult } from "./types";
import type { LightningConfiguration } from "../config/lightningConfig";

export type IndexBackendKind = "local" | "cloud";

export type IndexSearchOptions = {
  collectionId?: string;
};

export type IndexRepoStatus = {
  repoId: string;
  enabled: boolean;
  status: IndexManifest["status"] | "queued";
  lastIndexedAt?: string;
  error?: string;
  zoektAvailable?: boolean;
  scipAvailable?: boolean;
  diskUsageBytes?: number;
  localPath?: string;
};

export interface IndexBackend {
  readonly kind: IndexBackendKind;
  isEnabledForRepo(repoId?: string): Promise<boolean>;
  enableRepo(ref: { repoId: string; owner: string; repo: string; branch?: string; provider?: string }, localPath?: string): Promise<IndexRepoStatus>;
  disableRepo(repoId: string): Promise<void>;
  refreshRepo(ref: { repoId: string; owner: string; repo: string; branch?: string }): Promise<IndexRepoStatus>;
  getRepoStatus(repoId: string): Promise<IndexRepoStatus | undefined>;
  listRepoStatuses(config: LightningConfiguration): Promise<IndexRepoStatus[]>;
  search(repoId: string, pattern: string, options?: IndexSearchOptions): Promise<LocalSearchResult>;
  dependents(repoId: string, file: string): Promise<LocalDependentsResult>;
  summarize(config: LightningConfiguration): Promise<{
    enabledRepos: number;
    totalDiskBytes: number;
    readyRepos: number;
    indexingRepos: number;
  }>;
}

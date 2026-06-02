export type LightningRepoState = {
  repoId: string;
  owner: string;
  repo: string;
  enabled: boolean;
  status: "idle" | "cloning" | "indexing" | "ready" | "error" | "disabled";
  localPath?: string;
  lastIndexedAt?: string;
  diskUsageBytes?: number;
  zoektAvailable?: boolean;
  scipAvailable?: boolean;
  error?: string;
};

export type LightningModeState = {
  plan: "free" | "pro" | "enterprise";
  canUseLightning: boolean;
  globalEnabled: boolean;
  maxDiskGb: number;
  totalDiskBytes: number;
  enabledRepos: number;
  readyRepos: number;
  indexingRepos: number;
  repos: LightningRepoState[];
  currentRepoId?: string;
  backend?: "local" | "cloud";
};

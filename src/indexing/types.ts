export type IndexStatus = "idle" | "cloning" | "indexing" | "ready" | "error" | "disabled";

export type IndexManifest = {
  repoId: string;
  owner: string;
  repo: string;
  branch: string;
  localPath: string;
  zoektIndexPath?: string;
  scipIndexPath?: string;
  lastIndexedAt?: string;
  lastCommit?: string;
  indexVersion: number;
  diskUsageBytes: number;
  zoektAvailable: boolean;
  scipAvailable: boolean;
  status: IndexStatus;
  error?: string;
};

export type ZoektSearchHit = {
  fileName: string;
  lineNumber: number;
  content: string;
  score: number;
};

export type ScipSymbol = {
  symbol: string;
  kind: string;
  file: string;
  line: number;
  character: number;
  displayName: string;
};

export type ScipReference = {
  fromSymbol: string;
  toSymbol: string;
  kind: string;
};

export type LocalSearchResult = {
  source: "zoekt" | "scip" | "embedding" | "fallback";
  hits: ZoektSearchHit[];
  symbols: ScipSymbol[];
  stale: boolean;
};

export type GraphDependentsSource = "scip" | "zoekt" | "heuristic" | "remote";

export type LocalDependentsResult = {
  file: string;
  dependents: string[];
  source: GraphDependentsSource;
};

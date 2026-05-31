export type CodeHostProvider = "github" | "gitlab" | "bitbucket";

export type CodeHostErrorCode =
  | "auth"
  | "rate_limit"
  | "not_found"
  | "too_large"
  | "network"
  | "unsupported";

export class CodeHostError extends Error {
  public constructor(
    message: string,
    public readonly code: CodeHostErrorCode,
    public readonly status?: number,
    public readonly provider?: CodeHostProvider
  ) {
    super(message);
    this.name = "CodeHostError";
  }
}

export type RepoCoordinates = {
  provider: CodeHostProvider;
  owner: string;
  repo: string;
  branch?: string;
  baseUrl?: string;
};

export type RemoteRepository = {
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  provider: CodeHostProvider;
  htmlUrl?: string;
};

export type RemoteFile = {
  path: string;
  size: number;
  lastModified?: string;
  sha?: string;
  content?: string;
  encoding?: "base64" | "utf-8";
  truncated?: boolean;
};

export type RemoteTreeEntry = {
  path: string;
  name: string;
  type: "file" | "dir";
  size?: number;
  sha?: string;
  lastModified?: string;
};

export type RemoteTree = {
  path: string;
  branch: string;
  entries: RemoteTreeEntry[];
  metadata?: Record<string, unknown>;
};

export type RemoteFileContent = RemoteFile & {
  lines: Array<{ number: number; text: string }>;
  branch: string;
};

export type CommitInfo = {
  sha: string;
  author: string;
  authorLogin?: string;
  date: string;
  message: string;
  filesChanged?: string[];
  htmlUrl?: string;
};

export type BlameLine = {
  lineNumber: number;
  commitSha: string;
  author: string;
  date: string;
};

export type BlameData = {
  path: string;
  branch: string;
  lines: BlameLine[];
};

export type PullRequestSummary = {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  author?: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl?: string;
  files?: string[];
};

export type PullRequestComment = {
  id: string;
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
  resolved?: boolean;
};

export type PullRequestReview = {
  id: string;
  author: string;
  state: string;
  submittedAt: string;
  body?: string;
};

export type IssueSummary = {
  number: number;
  title: string;
  state: string;
  author?: string;
  assignee?: string;
  closedBy?: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl?: string;
};

export type FileChangelog = {
  path: string;
  lastCommit: CommitInfo;
  summary: string;
  pullRequest?: PullRequestSummary;
};

export type FileImportRef = {
  specifier: string;
  kind: "relative" | "package" | "alias";
  resolvedPath?: string;
  external: boolean;
};

export type FileImportsResult = {
  path: string;
  imports: FileImportRef[];
  circularHints: string[];
};

export type CrossRepoReference = {
  repoId: string;
  path: string;
  specifier: string;
};

export type DependencyGraphNode = {
  id: string;
  path: string;
  kind: "file" | "package" | "service";
};

export type DependencyGraphEdge = {
  from: string;
  to: string;
  kind: "import" | "manifest";
};

export type DependencyGraph = {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
};

export type CodeHostRepositoryConfig = {
  provider?: CodeHostProvider;
  owner: string;
  repo: string;
  branch?: string;
};

export type CodeHostUserConfig = {
  defaultCodeHost: CodeHostProvider;
  repositories: CodeHostRepositoryConfig[];
  gitlabBaseUrl: string;
};

export interface CodeHostClient {
  readonly provider: CodeHostProvider;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  getRepository(coords: RepoCoordinates): Promise<RemoteRepository>;
  getRepositoryTree(coords: RepoCoordinates, path?: string): Promise<RemoteTree>;
  getFileContent(coords: RepoCoordinates, path: string): Promise<RemoteFileContent>;
  getCommitHistory(coords: RepoCoordinates, options?: { path?: string; limit?: number }): Promise<CommitInfo[]>;
  getFileHistory(coords: RepoCoordinates, path: string, limit?: number): Promise<CommitInfo[]>;
  getBlameData(coords: RepoCoordinates, path: string): Promise<BlameData>;
  listPullRequests(coords: RepoCoordinates, options?: { state?: string; limit?: number }): Promise<PullRequestSummary[]>;
  getPullRequestComments(coords: RepoCoordinates, prNumber: number): Promise<PullRequestComment[]>;
  getPullRequestReviews(coords: RepoCoordinates, prNumber: number): Promise<PullRequestReview[]>;
  getPullRequestFiles?(coords: RepoCoordinates, prNumber: number): Promise<string[]>;
  listIssues(coords: RepoCoordinates, options?: { state?: string; limit?: number }): Promise<IssueSummary[]>;
  searchCode?(coords: RepoCoordinates, query: string, limit?: number): Promise<Array<{ path: string }>>;
}

export function repoIdFromCoordinates(coords: RepoCoordinates): string {
  return `${coords.provider}:${coords.owner}/${coords.repo}`;
}

export function coordinatesFromRepoId(
  repoId: string,
  branch?: string
): RepoCoordinates | undefined {
  const match = /^(github|gitlab|bitbucket):([^/]+)\/(.+)$/.exec(repoId.trim());
  if (!match) {
    return undefined;
  }
  return {
    provider: match[1] as CodeHostProvider,
    owner: match[2],
    repo: match[3],
    branch
  };
}

export function humanizeRelativeDate(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "unknown time";
  }
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes || 1} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

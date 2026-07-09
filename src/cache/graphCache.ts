import type {
  ChangedFile,
  CommitSummary,
  IssueMetadata,
  PullRequestMetadata,
  RepositoryRef,
  ReviewMetadata,
  SlackDecisionMetadata
} from "../webhooks/types";

export type DependencyType = "import" | "require" | "reference";

export type FileNode = {
  path: string;
  size: number;
  lastModified: Date;
  lastAuthor: string;
  sha: string;
};

export type DependencyEdge = {
  from: string;
  to: string;
  type: DependencyType;
};

export type OwnershipEntry = {
  file: string;
  primaryOwner: string;
  secondaryOwners: string[];
  ownershipScore: number;
};

export type RepositoryGraph = {
  repoId: string;
  owner: string;
  repo: string;
  lastUpdated: Date;
  fileTree: FileNode[];
  dependencies: DependencyEdge[];
  owners: OwnershipEntry[];
  recentCommits: CommitSummary[];
  pullRequests: PullRequestMetadata[];
  issues: IssueMetadata[];
  reviews: ReviewMetadata[];
  slackDecisions: SlackDecisionMetadata[];
  branches: string[];
  defaultBranch?: string;
  metadata: {
    language: string;
    framework?: string;
    lastIndexedAt: Date;
    indexVersion: number;
  };
};

export type GraphCacheOptions = {
  ttlMs?: number;
  maxRepos?: number;
  maxCommitsPerRepo?: number;
  maxAuditMetadataPerRepo?: number;
};

export type GraphQueryFilters = {
  owner?: string;
  since?: Date;
  limit?: number;
};

export type GraphQueryResult<T> = {
  repoId: string;
  data: T;
  lastUpdated: Date;
  freshness: string;
  stale: boolean;
};

type CacheEntry = {
  graph: RepositoryGraph;
  expiresAt: number;
  lastAccessedAt: number;
  fileIndex: Map<string, FileNode>;
  ownerIndex: Map<string, OwnershipEntry[]>;
  dependentsIndex: Map<string, DependencyEdge[]>;
  dependenciesIndex: Map<string, DependencyEdge[]>;
  transitiveDependentsIndex: Map<string, string[]>;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_REPOS = 100;
const DEFAULT_MAX_COMMITS = 250;
const DEFAULT_MAX_METADATA = 250;

export class GraphCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxRepos: number;
  private readonly maxCommitsPerRepo: number;
  private readonly maxAuditMetadataPerRepo: number;

  public constructor(options: GraphCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxRepos = options.maxRepos ?? DEFAULT_MAX_REPOS;
    this.maxCommitsPerRepo = options.maxCommitsPerRepo ?? DEFAULT_MAX_COMMITS;
    this.maxAuditMetadataPerRepo = options.maxAuditMetadataPerRepo ?? DEFAULT_MAX_METADATA;
  }

  public upsertRepository(ref: RepositoryRef, partial?: Partial<RepositoryGraph>): RepositoryGraph {
    const existing = this.entries.get(ref.repoId)?.graph;
    const now = new Date();
    const graph: RepositoryGraph = {
      repoId: ref.repoId,
      owner: ref.owner,
      repo: ref.repo,
      lastUpdated: now,
      fileTree: existing?.fileTree ?? [],
      dependencies: existing?.dependencies ?? [],
      owners: existing?.owners ?? [],
      recentCommits: existing?.recentCommits ?? [],
      pullRequests: existing?.pullRequests ?? [],
      issues: existing?.issues ?? [],
      reviews: existing?.reviews ?? [],
      slackDecisions: existing?.slackDecisions ?? [],
      branches: existing?.branches ?? compact([ref.defaultBranch]),
      defaultBranch: ref.defaultBranch ?? existing?.defaultBranch,
      metadata: {
        language: existing?.metadata.language ?? "unknown",
        framework: existing?.metadata.framework,
        lastIndexedAt: now,
        indexVersion: (existing?.metadata.indexVersion ?? 0) + 1
      },
      ...existing,
      ...partial
    };

    graph.lastUpdated = now;
    graph.metadata = {
      ...graph.metadata,
      lastIndexedAt: now,
      indexVersion: Math.max(graph.metadata.indexVersion, (existing?.metadata.indexVersion ?? 0) + 1)
    };
    this.setGraph(graph);
    return graph;
  }

  public setGraph(graph: RepositoryGraph): void {
    this.entries.set(graph.repoId, this.buildEntry(this.sanitizeGraph(graph)));
    this.evictExpired();
    this.evictLru();
  }

  public getGraph(repoId: string): RepositoryGraph | undefined {
    const entry = this.getEntry(repoId);
    return entry ? cloneGraph(entry.graph) : undefined;
  }

  public deleteGraph(repoId: string): boolean {
    return this.entries.delete(repoId);
  }

  public listRepoIds(): string[] {
    this.evictExpired();
    return [...this.entries.keys()];
  }

  public updateFiles(repo: RepositoryRef, changes: ChangedFile[]): RepositoryGraph {
    const graph = this.upsertRepository(repo);
    const files = new Map(graph.fileTree.map((file) => [file.path, file]));
    const now = new Date();

    for (const change of changes) {
      if (change.previousPath && change.previousPath !== change.path) {
        files.delete(change.previousPath);
      }
      if (change.status === "removed") {
        files.delete(change.path);
        continue;
      }
      const previous = files.get(change.path);
      files.set(change.path, {
        path: change.path,
        size: change.size ?? previous?.size ?? 0,
        lastModified: change.lastModified ?? previous?.lastModified ?? now,
        lastAuthor: change.lastAuthor ?? previous?.lastAuthor ?? "unknown",
        sha: change.sha ?? previous?.sha ?? ""
      });
    }

    graph.fileTree = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
    graph.dependencies = graph.dependencies.filter(
      (edge) => files.has(edge.from) && files.has(edge.to)
    );
    graph.owners = this.recomputeOwnership(graph.fileTree, graph.recentCommits);
    graph.lastUpdated = now;
    graph.metadata.lastIndexedAt = now;
    graph.metadata.indexVersion += 1;
    this.setGraph(graph);
    return cloneGraph(graph);
  }

  public addCommits(repo: RepositoryRef, commits: CommitSummary[]): RepositoryGraph {
    const graph = this.upsertRepository(repo);
    const bySha = new Map(graph.recentCommits.map((commit) => [commit.sha, commit]));
    for (const commit of commits) {
      bySha.set(commit.sha, sanitizeCommit(commit));
    }
    graph.recentCommits = [...bySha.values()]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, this.maxCommitsPerRepo);
    graph.owners = this.recomputeOwnership(graph.fileTree, graph.recentCommits);
    graph.lastUpdated = new Date();
    graph.metadata.lastIndexedAt = graph.lastUpdated;
    graph.metadata.indexVersion += 1;
    this.setGraph(graph);
    return cloneGraph(graph);
  }

  public setDependencies(repoId: string, dependencies: DependencyEdge[]): RepositoryGraph | undefined {
    const graph = this.getMutableGraph(repoId);
    if (!graph) {
      return undefined;
    }
    graph.dependencies = dedupeDependencies(dependencies);
    graph.lastUpdated = new Date();
    graph.metadata.lastIndexedAt = graph.lastUpdated;
    graph.metadata.indexVersion += 1;
    this.setGraph(graph);
    return cloneGraph(graph);
  }

  public upsertPullRequest(repo: RepositoryRef, pullRequest: PullRequestMetadata): RepositoryGraph {
    const graph = this.upsertRepository(repo);
    graph.pullRequests = upsertById(graph.pullRequests, sanitizePullRequest(pullRequest))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, this.maxAuditMetadataPerRepo);
    graph.lastUpdated = new Date();
    graph.metadata.lastIndexedAt = graph.lastUpdated;
    graph.metadata.indexVersion += 1;
    this.setGraph(graph);
    return cloneGraph(graph);
  }

  public upsertIssue(repo: RepositoryRef, issue: IssueMetadata): RepositoryGraph {
    const graph = this.upsertRepository(repo);
    graph.issues = upsertById(graph.issues, sanitizeIssue(issue))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, this.maxAuditMetadataPerRepo);
    graph.lastUpdated = new Date();
    graph.metadata.lastIndexedAt = graph.lastUpdated;
    graph.metadata.indexVersion += 1;
    this.setGraph(graph);
    return cloneGraph(graph);
  }

  public upsertReview(repo: RepositoryRef, review: ReviewMetadata): RepositoryGraph {
    const graph = this.upsertRepository(repo);
    graph.reviews = upsertById(graph.reviews, review)
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .slice(0, this.maxAuditMetadataPerRepo);
    graph.lastUpdated = new Date();
    graph.metadata.lastIndexedAt = graph.lastUpdated;
    graph.metadata.indexVersion += 1;
    this.setGraph(graph);
    return cloneGraph(graph);
  }

  public addSlackDecision(repoId: string, decision: SlackDecisionMetadata): RepositoryGraph | undefined {
    const graph = this.getMutableGraph(repoId);
    if (!graph) {
      return undefined;
    }
    graph.slackDecisions = upsertById(graph.slackDecisions, decision)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, this.maxAuditMetadataPerRepo);
    graph.lastUpdated = new Date();
    graph.metadata.lastIndexedAt = graph.lastUpdated;
    graph.metadata.indexVersion += 1;
    this.setGraph(graph);
    return cloneGraph(graph);
  }

  public getFileTree(repoId: string): GraphQueryResult<FileNode[]> | undefined {
    const entry = this.getEntry(repoId);
    return entry ? this.result(entry, entry.graph.fileTree.map(cloneFile)) : undefined;
  }

  public getOwnership(repoId: string, file: string): GraphQueryResult<OwnershipEntry | undefined> | undefined {
    const entry = this.getEntry(repoId);
    const owner = entry?.fileOwner(file);
    return entry ? this.result(entry, owner ? cloneOwnership(owner) : undefined) : undefined;
  }

  public getDependents(repoId: string, file: string): GraphQueryResult<DependencyEdge[]> | undefined {
    const entry = this.getEntry(repoId);
    return entry ? this.result(entry, [...(entry.dependentsIndex.get(file) ?? [])]) : undefined;
  }

  public getImports(repoId: string, file: string): GraphQueryResult<DependencyEdge[]> | undefined {
    const entry = this.getEntry(repoId);
    return entry ? this.result(entry, [...(entry.dependenciesIndex.get(file) ?? [])]) : undefined;
  }

  public getTransitiveDependents(repoId: string, file: string): GraphQueryResult<string[]> | undefined {
    const entry = this.getEntry(repoId);
    return entry ? this.result(entry, [...(entry.transitiveDependentsIndex.get(file) ?? [])]) : undefined;
  }

  public getRecentChanges(
    repoId: string,
    days = 7,
    filters: GraphQueryFilters = {}
  ): GraphQueryResult<CommitSummary[]> | undefined {
    const entry = this.getEntry(repoId);
    if (!entry) {
      return undefined;
    }
    const since = filters.since ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const limit = filters.limit ?? 100;
    const commits = entry.graph.recentCommits
      .filter((commit) => commit.date >= since)
      .filter((commit) => !filters.owner || commit.author === filters.owner)
      .slice(0, limit)
      .map(sanitizeCommit);
    return this.result(entry, commits);
  }

  public searchFiles(repoId: string, pattern: string, limit = 50): GraphQueryResult<FileNode[]> | undefined {
    const entry = this.getEntry(repoId);
    if (!entry) {
      return undefined;
    }
    const normalized = pattern.trim().toLowerCase();
    const matches = entry.graph.fileTree
      .map((file) => ({ file, score: scoreFile(file.path, normalized) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
      .slice(0, limit)
      .map((match) => cloneFile(match.file));
    return this.result(entry, matches);
  }

  private getMutableGraph(repoId: string): RepositoryGraph | undefined {
    const entry = this.getEntry(repoId);
    return entry ? cloneGraph(entry.graph) : undefined;
  }

  private getEntry(repoId: string): (CacheEntry & { fileOwner(file: string): OwnershipEntry | undefined }) | undefined {
    const entry = this.entries.get(repoId);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(repoId);
      return undefined;
    }
    entry.lastAccessedAt = Date.now();
    return Object.assign(entry, {
      fileOwner: (file: string) => entry.fileIndex.has(file)
        ? entry.graph.owners.find((owner) => owner.file === file)
        : undefined
    });
  }

  private buildEntry(graph: RepositoryGraph): CacheEntry {
    const fileIndex = new Map(graph.fileTree.map((file) => [file.path, file]));
    const ownerIndex = new Map<string, OwnershipEntry[]>();
    for (const owner of graph.owners) {
      const owners = [owner.primaryOwner, ...owner.secondaryOwners].filter(Boolean);
      for (const name of owners) {
        ownerIndex.set(name, [...(ownerIndex.get(name) ?? []), owner]);
      }
    }
    const dependentsIndex = new Map<string, DependencyEdge[]>();
    const dependenciesIndex = new Map<string, DependencyEdge[]>();
    for (const edge of graph.dependencies) {
      dependenciesIndex.set(edge.from, [...(dependenciesIndex.get(edge.from) ?? []), edge]);
      dependentsIndex.set(edge.to, [...(dependentsIndex.get(edge.to) ?? []), edge]);
    }
    return {
      graph,
      expiresAt: Date.now() + this.ttlMs,
      lastAccessedAt: Date.now(),
      fileIndex,
      ownerIndex,
      dependentsIndex,
      dependenciesIndex,
      transitiveDependentsIndex: buildTransitiveDependents(dependentsIndex)
    };
  }

  private sanitizeGraph(graph: RepositoryGraph): RepositoryGraph {
    return {
      ...cloneGraph(graph),
      fileTree: graph.fileTree.map(cloneFile),
      dependencies: dedupeDependencies(graph.dependencies),
      owners: graph.owners.map(cloneOwnership),
      recentCommits: graph.recentCommits.map(sanitizeCommit).slice(0, this.maxCommitsPerRepo),
      pullRequests: graph.pullRequests.map(sanitizePullRequest).slice(0, this.maxAuditMetadataPerRepo),
      issues: graph.issues.map(sanitizeIssue).slice(0, this.maxAuditMetadataPerRepo),
      reviews: graph.reviews.slice(0, this.maxAuditMetadataPerRepo),
      slackDecisions: graph.slackDecisions.slice(0, this.maxAuditMetadataPerRepo)
    };
  }

  private recomputeOwnership(files: FileNode[], commits: CommitSummary[]): OwnershipEntry[] {
    const scores = new Map<string, Map<string, number>>();
    for (const commit of commits) {
      for (const file of commit.files) {
        const fileScores = scores.get(file) ?? new Map<string, number>();
        fileScores.set(commit.author, (fileScores.get(commit.author) ?? 0) + 1);
        scores.set(file, fileScores);
      }
    }
    return files.map((file) => {
      const ranked = [...(scores.get(file.path) ?? new Map<string, number>()).entries()]
        .sort((a, b) => b[1] - a[1]);
      const total = ranked.reduce((sum, [, count]) => sum + count, 0);
      const primary = ranked[0];
      return {
        file: file.path,
        primaryOwner: primary?.[0] ?? file.lastAuthor ?? "unknown",
        secondaryOwners: ranked.slice(1, 4).map(([owner]) => owner),
        ownershipScore: total > 0 && primary ? Number((primary[1] / total).toFixed(2)) : 1
      };
    });
  }

  private result<T>(entry: CacheEntry, data: T): GraphQueryResult<T> {
    return {
      repoId: entry.graph.repoId,
      data,
      lastUpdated: entry.graph.lastUpdated,
      freshness: formatFreshness(entry.graph.lastUpdated),
      stale: Date.now() > entry.expiresAt
    };
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [repoId, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(repoId);
      }
    }
  }

  private evictLru(): void {
    while (this.entries.size > this.maxRepos) {
      const [oldestRepoId] = [...this.entries.entries()]
        .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0];
      this.entries.delete(oldestRepoId);
    }
  }
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined);
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  byId.set(next.id, next);
  return [...byId.values()];
}

function dedupeDependencies(dependencies: DependencyEdge[]): DependencyEdge[] {
  const seen = new Set<string>();
  return dependencies.filter((edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildTransitiveDependents(index: Map<string, DependencyEdge[]>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of index.keys()) {
    const visited = new Set<string>();
    const queue = [...(index.get(file) ?? []).map((edge) => edge.from)];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      queue.push(...(index.get(current) ?? []).map((edge) => edge.from));
    }
    result.set(file, [...visited]);
  }
  return result;
}

function scoreFile(path: string, pattern: string): number {
  if (!pattern) {
    return 1;
  }
  const target = path.toLowerCase();
  if (target === pattern) {
    return 100;
  }
  if (target.endsWith(pattern)) {
    return 80;
  }
  if (target.includes(pattern)) {
    return 50;
  }
  let score = 0;
  let cursor = 0;
  for (const char of pattern) {
    const found = target.indexOf(char, cursor);
    if (found === -1) {
      return 0;
    }
    score += found === cursor ? 4 : 1;
    cursor = found + 1;
  }
  return score;
}

function formatFreshness(updatedAt: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `Last updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Last updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `Last updated ${days} day${days === 1 ? "" : "s"} ago`;
}

function cloneGraph(graph: RepositoryGraph): RepositoryGraph {
  return {
    ...graph,
    lastUpdated: new Date(graph.lastUpdated),
    fileTree: graph.fileTree.map(cloneFile),
    dependencies: graph.dependencies.map((edge) => ({ ...edge })),
    owners: graph.owners.map(cloneOwnership),
    recentCommits: graph.recentCommits.map(sanitizeCommit),
    pullRequests: graph.pullRequests.map(sanitizePullRequest),
    issues: graph.issues.map(sanitizeIssue),
    reviews: graph.reviews.map((review) => ({
      ...review,
      submittedAt: new Date(review.submittedAt),
      comments: review.comments.map((comment) => ({ ...comment, createdAt: new Date(comment.createdAt) }))
    })),
    slackDecisions: graph.slackDecisions.map((decision) => ({
      ...decision,
      timestamp: new Date(decision.timestamp),
      decisionKeywords: [...decision.decisionKeywords],
      linkedRefs: decision.linkedRefs.map((ref) => ({ ...ref }))
    })),
    branches: [...graph.branches],
    metadata: { ...graph.metadata, lastIndexedAt: new Date(graph.metadata.lastIndexedAt) }
  };
}

function cloneFile(file: FileNode): FileNode {
  return { ...file, lastModified: new Date(file.lastModified) };
}

function cloneOwnership(owner: OwnershipEntry): OwnershipEntry {
  return { ...owner, secondaryOwners: [...owner.secondaryOwners] };
}

function sanitizeCommit(commit: CommitSummary): CommitSummary {
  return {
    ...commit,
    message: commit.message.slice(0, 500),
    date: new Date(commit.date),
    files: [...new Set(commit.files)]
  };
}

function sanitizePullRequest(pr: PullRequestMetadata): PullRequestMetadata {
  return { ...pr, title: pr.title.slice(0, 300), updatedAt: new Date(pr.updatedAt), linkedIssues: [...pr.linkedIssues] };
}

function sanitizeIssue(issue: IssueMetadata): IssueMetadata {
  return { ...issue, title: issue.title.slice(0, 300), updatedAt: new Date(issue.updatedAt), linkedFiles: [...issue.linkedFiles] };
}

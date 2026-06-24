import { toRepositoryRelativePath } from "../../context/repoFilePath";
import { CacheManager } from "../../cache/CacheManager";
import { readCodeHostConfiguration } from "../../config/codeHostConfig";
import { readConfiguration } from "../../chat/SecureApiClient";
import { RateLimitTracker } from "../rateLimitTracker";
import { BitbucketClient } from "./bitbucketClient";
import { CodeHostSecrets } from "./codeHostSecrets";
import { findCrossRepoReferences, buildDependencyGraph, parseFileImports } from "./importAnalysis";
import { GitHubClient } from "./githubClient";
import { GitLabClient } from "./gitlabClient";
import type {
  BlameData,
  CodeHostClient,
  CodeHostProvider,
  CodeHostRepositoryConfig,
  CommitInfo,
  DependencyGraph,
  FileChangelog,
  FileImportsResult,
  CrossRepoReference,
  PullRequestComment,
  PullRequestReview,
  PullRequestSummary,
  IssueSummary,
  RemoteFileContent,
  RemoteRepository,
  RemoteTree,
  RemoteTreeEntry,
  RepoCoordinates
} from "./types";
import { isRemoteFileSearchFallbackCandidate } from "./cloudRepoFileSearchFallback";
import { buildExplorerFileSearchQuery } from "./explorerSearch";
import { CodeHostError, humanizeRelativeDate, repoIdFromCoordinates, coordinatesFromRepoId } from "./types";

export type CloudCodeHostFileFetcher = (options: {
  repoId: string;
  path: string;
  coords: RepoCoordinates;
}) => Promise<RemoteFileContent>;

export type CloudCodeHostTreeFetcher = (options: {
  repoId: string;
  path: string;
  coords: RepoCoordinates;
}) => Promise<RemoteTree>;

export type CloudCodeHostSearchFetcher = (options: {
  repoId: string;
  query: string;
  coords: RepoCoordinates;
  limit?: number;
}) => Promise<Array<{ path: string; name: string }>>;

export type CloudCodeHostRepoListFetcher = () => Promise<CodeHostRepositoryConfig[]>;

export type CloudCodeHostBlameFetcher = (options: {
  repoId: string;
  path: string;
  coords: RepoCoordinates;
}) => Promise<BlameData>;

export type CloudCodeHostHistoryFetcher = (options: {
  repoId: string;
  path: string;
  coords: RepoCoordinates;
  limit?: number;
}) => Promise<CommitInfo[]>;

export type CloudCodeHostCommitFetcher = (options: {
  repoId: string;
  sha: string;
  coords: RepoCoordinates;
}) => Promise<CommitInfo>;

export type CloudCodeHostPullsForFileFetcher = (options: {
  repoId: string;
  path: string;
  coords: RepoCoordinates;
  limit?: number;
}) => Promise<PullRequestSummary[]>;

export type CloudCodeHostPullCommentsFetcher = (options: {
  repoId: string;
  prNumber: number;
  coords: RepoCoordinates;
}) => Promise<PullRequestComment[]>;

export type CloudCodeHostPullDetailFetcher = (options: {
  repoId: string;
  prNumber: number;
  coords: RepoCoordinates;
  commitSha?: string;
}) => Promise<{
  number: number;
  title: string;
  body?: string;
  state: string;
  merged: boolean;
  author?: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl?: string;
  labels: string[];
}>;

export type CloudCodeHostRepoMetadataFetcher = (options: {
  repoId: string;
  coords: RepoCoordinates;
}) => Promise<RemoteRepository>;

export type CloudCodeHostRepoPullsFetcher = (options: {
  repoId: string;
  coords: RepoCoordinates;
  state?: string;
  limit?: number;
}) => Promise<PullRequestSummary[]>;

export type CloudCodeHostRepoIssuesFetcher = (options: {
  repoId: string;
  coords: RepoCoordinates;
  state?: string;
  limit?: number;
}) => Promise<IssueSummary[]>;

export type CloudCodeHostPullReviewsFetcher = (options: {
  repoId: string;
  prNumber: number;
  coords: RepoCoordinates;
}) => Promise<PullRequestReview[]>;

export type CloudCodeHostCommitPullsFetcher = (options: {
  repoId: string;
  sha: string;
  coords: RepoCoordinates;
}) => Promise<
  Array<{
    number: number;
    title: string;
    body?: string;
    state: string;
    merged: boolean;
    author?: string;
    createdAt: string;
    updatedAt: string;
    htmlUrl?: string;
    owner: string;
    repo: string;
    labels: string[];
  }>
>;

export type CodeHostRouterOptions = {
  secrets: CodeHostSecrets;
  cache: CacheManager;
  rateLimitTracker?: RateLimitTracker;
  /** When true, code host file reads use the backend proxy (no local PAT). */
  useCloudCodeHostProxy?: () => boolean;
  cloudCodeHostFileFetcher?: CloudCodeHostFileFetcher;
  cloudCodeHostTreeFetcher?: CloudCodeHostTreeFetcher;
  cloudCodeHostSearchFetcher?: CloudCodeHostSearchFetcher;
  cloudCodeHostRepoListFetcher?: CloudCodeHostRepoListFetcher;
  cloudCodeHostBlameFetcher?: CloudCodeHostBlameFetcher;
  cloudCodeHostHistoryFetcher?: CloudCodeHostHistoryFetcher;
  cloudCodeHostCommitFetcher?: CloudCodeHostCommitFetcher;
  cloudCodeHostPullsForFileFetcher?: CloudCodeHostPullsForFileFetcher;
  cloudCodeHostPullCommentsFetcher?: CloudCodeHostPullCommentsFetcher;
  cloudCodeHostPullDetailFetcher?: CloudCodeHostPullDetailFetcher;
  cloudCodeHostCommitPullsFetcher?: CloudCodeHostCommitPullsFetcher;
  cloudCodeHostRepoMetadataFetcher?: CloudCodeHostRepoMetadataFetcher;
  cloudCodeHostRepoPullsFetcher?: CloudCodeHostRepoPullsFetcher;
  cloudCodeHostRepoIssuesFetcher?: CloudCodeHostRepoIssuesFetcher;
  cloudCodeHostPullReviewsFetcher?: CloudCodeHostPullReviewsFetcher;
  cloudCodeHostHealthCheck?: (provider: CodeHostProvider) => Promise<{ ok: boolean; message: string }>;
};

export class CodeHostRouter {
  private readonly rateLimitTracker: RateLimitTracker;
  private readonly clients = new Map<CodeHostProvider, CodeHostClient>();

  public constructor(private readonly options: CodeHostRouterOptions) {
    this.rateLimitTracker = options.rateLimitTracker ?? new RateLimitTracker();
  }

  public async resolveCoordinates(overrides?: Partial<RepoCoordinates>): Promise<RepoCoordinates> {
    const prefs = readConfiguration();
    const hostConfig = readCodeHostConfiguration();
    const configured = hostConfig.repositories[0];
    const provider =
      overrides?.provider ??
      configured?.provider ??
      hostConfig.defaultCodeHost;
    const owner = overrides?.owner ?? configured?.owner ?? prefs.owner;
    const repo = overrides?.repo ?? configured?.repo ?? prefs.repo;
    if (!owner || !repo) {
      throw new CodeHostError("Repository owner and name are required.", "unsupported");
    }
    return {
      provider,
      owner,
      repo,
      branch: overrides?.branch ?? configured?.branch ?? (prefs.branch || undefined),
      baseUrl: overrides?.baseUrl ?? hostConfig.gitlabBaseUrl
    };
  }

  public async testProvider(provider: CodeHostProvider): Promise<{ ok: boolean; message: string }> {
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostHealthCheck) {
      return this.options.cloudCodeHostHealthCheck(provider);
    }
    const client = await this.getClient(provider);
    return client.testConnection();
  }

  public async getRepository(coords?: Partial<RepoCoordinates>): Promise<RemoteRepository> {
    const resolved = await this.resolveCoordinates(coords);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostRepoMetadataFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("repoMetadata", resolved, "cloud"), "repoMetadata", async () =>
        this.options.cloudCodeHostRepoMetadataFetcher!({ repoId, coords: resolved })
      );
    }
    return this.cached(
      this.key("repoMetadata", resolved),
      "repoMetadata",
      async () => (await this.getClient(resolved.provider)).getRepository(resolved)
    );
  }

  public async getRepositoryTree(path = "", coords?: Partial<RepoCoordinates>): Promise<RemoteTree> {
    const resolved = await this.resolveCoordinates(coords);
    const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostTreeFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("tree", resolved, normalized, "cloud"), "tree", async () =>
        this.options.cloudCodeHostTreeFetcher!({ repoId, path: normalized, coords: resolved })
      );
    }
    return this.cached(this.key("tree", resolved, normalized), "tree", async () =>
      (await this.getClient(resolved.provider)).getRepositoryTree(resolved, normalized)
    );
  }

  public async searchRepositoryFiles(
    query: string,
    coords?: Partial<RepoCoordinates>,
    limit = 30
  ): Promise<Array<{ path: string; name: string }>> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const resolved = await this.resolveCoordinates(coords);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostSearchFetcher) {
      try {
        const repoId = repoIdFromCoordinates(resolved);
        return await this.cached(this.key("search", resolved, trimmed, String(limit)), "search", async () =>
          this.options.cloudCodeHostSearchFetcher!({ repoId, query: trimmed, coords: resolved, limit })
        );
      } catch (error) {
        if (!isRemoteFileSearchFallbackCandidate(error)) {
          throw error;
        }
        if (this.options.useCloudCodeHostProxy?.()) {
          throw error;
        }
      }
    }
    const client = await this.getClient(resolved.provider);
    if (!client.searchCode) {
      throw new CodeHostError(
        "File search isn't supported for this code host yet.",
        "unsupported",
        400,
        resolved.provider
      );
    }
    const searchQuery = buildExplorerFileSearchQuery(trimmed, resolved.provider);
    const hits = await client.searchCode(resolved, searchQuery, limit);
    return hits.map((hit) => ({
      path: hit.path,
      name: hit.path.split("/").pop() ?? hit.path
    }));
  }

  /** Repositories shown in the remote explorer picker (pinned config, settings, and live host list). */
  public async listExplorerRepositories(
    context?: Partial<Pick<RepoCoordinates, "provider" | "owner" | "repo" | "branch">>
  ): Promise<CodeHostRepositoryConfig[]> {
    const hostConfig = readCodeHostConfiguration();
    const prefs = readConfiguration();
    const defaultProvider = hostConfig.defaultCodeHost;
    const seen = new Set<string>();
    const entries: CodeHostRepositoryConfig[] = [];

    const push = (entry: CodeHostRepositoryConfig): void => {
      if (!entry.owner || !entry.repo) {
        return;
      }
      const provider = entry.provider ?? defaultProvider;
      const key = `${provider}:${entry.owner}/${entry.repo}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push({ ...entry, provider });
    };

    for (const repo of hostConfig.repositories) {
      push(repo);
    }
    if (prefs.owner && prefs.repo) {
      push({
        provider: defaultProvider,
        owner: prefs.owner,
        repo: prefs.repo,
        branch: prefs.branch || undefined
      });
    }
    if (context?.owner && context?.repo) {
      push({
        provider: context.provider ?? defaultProvider,
        owner: context.owner,
        repo: context.repo,
        branch: context.branch
      });
    }

    const listProvider = context?.provider ?? defaultProvider;
    if (this.options.useCloudCodeHostProxy?.() && listProvider === "github" && this.options.cloudCodeHostRepoListFetcher) {
      try {
        const remote = await this.options.cloudCodeHostRepoListFetcher();
        for (const repo of remote) {
          push(repo);
        }
      } catch {
        // Fall through to pinned/settings repos.
      }
    }

    const creds = await this.options.secrets.getCredentials();
    if (listProvider === "github" && creds.githubToken) {
      try {
        const client = await this.getClient("github");
        if ("listUserRepositories" in client && typeof client.listUserRepositories === "function") {
          const remote = await client.listUserRepositories(100);
          for (const repo of remote) {
            push({
              provider: "github",
              owner: repo.owner,
              repo: repo.name,
              branch: repo.defaultBranch
            });
          }
        }
      } catch {
        // Pinned/settings repos remain available when live listing fails.
      }
    }

    return entries.sort((a, b) => `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`));
  }

  public async getFileContent(filePath: string, coords?: Partial<RepoCoordinates>): Promise<RemoteFileContent> {
    const resolved = await this.resolveCoordinates(coords);
    const path = filePath.replace(/^\/+/, "");
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostFileFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("fileContent", resolved, path, "cloud"), "fileContent", async () =>
        this.options.cloudCodeHostFileFetcher!({ repoId, path, coords: resolved })
      );
    }
    return this.cached(this.key("fileContent", resolved, path), "fileContent", async () =>
      (await this.getClient(resolved.provider)).getFileContent(resolved, path)
    );
  }

  public async getCommitHistory(
    options?: { path?: string; limit?: number; branch?: string } & Partial<RepoCoordinates>
  ): Promise<CommitInfo[]> {
    const resolved = await this.resolveCoordinates(options);
    const limit = options?.limit ?? 100;
    const path = (options?.path ?? "").replace(/^\/+/, "");
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostHistoryFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("commitHistory", resolved, path, limit, "cloud"), "commitHistory", async () =>
        this.options.cloudCodeHostHistoryFetcher!({ repoId, path, coords: resolved, limit })
      );
    }
    return this.cached(this.key("commitHistory", resolved, path, limit), "commitHistory", async () =>
      (await this.getClient(resolved.provider)).getCommitHistory(resolved, {
        path: path || undefined,
        limit
      })
    );
  }

  public async getFileHistory(filePath: string, limit = 20, coords?: Partial<RepoCoordinates>): Promise<CommitInfo[]> {
    const resolved = await this.resolveCoordinates(coords);
    const path = toRepositoryRelativePath(filePath);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostHistoryFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("fileHistory", resolved, path, limit, "cloud"), "commitHistory", async () =>
        this.options.cloudCodeHostHistoryFetcher!({ repoId, path, coords: resolved, limit })
      );
    }
    return this.cached(this.key("fileHistory", resolved, path, limit), "commitHistory", async () =>
      (await this.getClient(resolved.provider)).getFileHistory(resolved, path, limit)
    );
  }

  public async getCommitBySha(sha: string, coords?: Partial<RepoCoordinates>): Promise<CommitInfo> {
    const resolved = await this.resolveCoordinates(coords);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostCommitFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("commit", resolved, sha, "cloud"), "commitHistory", async () =>
        this.options.cloudCodeHostCommitFetcher!({ repoId, sha, coords: resolved })
      );
    }
    return this.cached(this.key("commit", resolved, sha), "commitHistory", async () =>
      (await this.getClient(resolved.provider)).getCommitBySha(resolved, sha)
    );
  }

  public async getBlameData(filePath: string, coords?: Partial<RepoCoordinates>): Promise<BlameData> {
    const resolved = await this.resolveCoordinates(coords);
    const path = toRepositoryRelativePath(filePath);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostBlameFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("blame", resolved, path, "cloud"), "blame", async () =>
        this.options.cloudCodeHostBlameFetcher!({ repoId, path, coords: resolved })
      );
    }
    return this.cached(this.key("blame", resolved, path), "blame", async () =>
      (await this.getClient(resolved.provider)).getBlameData(resolved, path)
    );
  }

  public async getFileChangelog(filePath: string, coords?: Partial<RepoCoordinates>): Promise<FileChangelog> {
    const history = await this.getFileHistory(filePath, 1, coords);
    const resolved = await this.resolveCoordinates(coords);
    const path = filePath.replace(/^\/+/, "");
    const lastCommit = history[0];
    if (!lastCommit) {
      throw new CodeHostError("No commit history found for file.", "not_found", 404, resolved.provider);
    }
    const prs = await this.getPRsForFile(path, 5, coords);
    const summary = `Last modified: ${humanizeRelativeDate(lastCommit.date)} by ${lastCommit.authorLogin ? `@${lastCommit.authorLogin}` : lastCommit.author}`;
    return {
      path,
      lastCommit,
      summary,
      pullRequest: prs[0]
    };
  }

  public async getFileImports(filePath: string, coords?: Partial<RepoCoordinates>): Promise<FileImportsResult> {
    const content = await this.getFileContent(filePath, coords);
    return parseFileImports(content.path, content.content ?? "");
  }

  public async getCrossRepoReferences(
    filePath: string,
    coords?: Partial<RepoCoordinates>,
    options?: { collectionRepoIds?: string[] }
  ): Promise<CrossRepoReference[]> {
    const resolved = await this.resolveCoordinates(coords);
    const client = await this.getClient(resolved.provider);
    if (!client.searchCode) {
      return [];
    }
    const moduleStem = filePath.replace(/\.[^.]+$/, "").split("/").pop() ?? filePath;
    const searchRepos = buildCrossRepoSearchTargets(resolved, options?.collectionRepoIds);
    const githubClient = client as GitHubClient;
    const hits =
      searchRepos.length > 1 && typeof githubClient.searchCodeAcrossRepos === "function"
        ? await githubClient.searchCodeAcrossRepos(searchRepos, moduleStem, 20).catch(() => [])
        : (
            await client.searchCode(resolved, moduleStem, 20).catch(() => [])
          ).map((hit) => ({
            repoId: repoIdFromCoordinates(resolved),
            path: hit.path,
            snippet: moduleStem
          }));

    return findCrossRepoReferences(resolved, filePath, hits);
  }

  public async getDependencyGraph(
    rootPaths: string[],
    coords?: Partial<RepoCoordinates>
  ): Promise<DependencyGraph> {
    const resolved = await this.resolveCoordinates(coords);
    return buildDependencyGraph(resolved, rootPaths, async (path) => {
      const result = await this.getFileImports(path, resolved);
      return result.imports;
    });
  }

  public async listRepoPullRequests(
    coords?: Partial<RepoCoordinates>,
    options?: { state?: string; limit?: number }
  ): Promise<PullRequestSummary[]> {
    const resolved = await this.resolveCoordinates(coords);
    const limit = options?.limit ?? 20;
    const state = options?.state ?? "all";
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostRepoPullsFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("prIssue", resolved, "repo-prs", state, "cloud"), "prIssue", async () => {
        const pulls = await this.options.cloudCodeHostRepoPullsFetcher!({
          repoId,
          coords: resolved,
          state,
          limit: 50
        });
        return pulls.slice(0, limit);
      });
    }
    const prs = await this.cached(this.key("prIssue", resolved, "repo-prs", state), "prIssue", async () =>
      (await this.getClient(resolved.provider)).listPullRequests(resolved, { state, limit: 50 })
    );
    return prs.slice(0, limit);
  }

  public async listRepoIssues(
    coords?: Partial<RepoCoordinates>,
    options?: { state?: string; limit?: number }
  ): Promise<IssueSummary[]> {
    const resolved = await this.resolveCoordinates(coords);
    const limit = options?.limit ?? 20;
    const state = options?.state ?? "all";
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostRepoIssuesFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("prIssue", resolved, "repo-issues", state, "cloud"), "prIssue", async () => {
        const issues = await this.options.cloudCodeHostRepoIssuesFetcher!({
          repoId,
          coords: resolved,
          state,
          limit: 50
        });
        return issues.slice(0, limit);
      });
    }
    const issues = await this.cached(this.key("prIssue", resolved, "repo-issues", state), "prIssue", async () =>
      (await this.getClient(resolved.provider)).listIssues(resolved, { state, limit: 50 })
    );
    return issues.slice(0, limit);
  }

  public async getPRsForFile(
    filePath: string,
    limit = 20,
    coords?: Partial<RepoCoordinates>
  ): Promise<PullRequestSummary[]> {
    const resolved = await this.resolveCoordinates(coords);
    const path = filePath.replace(/^\/+/, "");
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostPullsForFileFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("prIssue", resolved, "prs", path, "cloud"), "prIssue", async () =>
        this.options.cloudCodeHostPullsForFileFetcher!({ repoId, path, coords: resolved, limit })
      );
    }
    const prs = await this.cached(this.key("prIssue", resolved, "prs", path), "prIssue", async () =>
      (await this.getClient(resolved.provider)).listPullRequests(resolved, { state: "all", limit: 50 })
    );
    const enriched = await this.enrichPullRequestsWithFiles(prs.slice(0, 20), resolved);
    return enriched.filter((pr) => !pr.files || pr.files.includes(path) || pr.files.some((f) => path.startsWith(f))).slice(0, limit);
  }

  public async getPullRequestReviews(
    prNumber: number,
    coords?: Partial<RepoCoordinates>
  ): Promise<PullRequestReview[]> {
    const resolved = await this.resolveCoordinates(coords);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostPullReviewsFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("prIssue", resolved, "reviews", prNumber, "cloud"), "prIssue", async () =>
        this.options.cloudCodeHostPullReviewsFetcher!({ repoId, prNumber, coords: resolved })
      );
    }
    return this.cached(this.key("prIssue", resolved, "reviews", prNumber), "prIssue", async () =>
      (await this.getClient(resolved.provider)).getPullRequestReviews(resolved, prNumber)
    );
  }

  public async getPRComments(
    prNumber: number,
    coords?: Partial<RepoCoordinates>
  ): Promise<PullRequestComment[]> {
    const resolved = await this.resolveCoordinates(coords);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostPullCommentsFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.options.cloudCodeHostPullCommentsFetcher!({ repoId, prNumber, coords: resolved });
    }
    return (await this.getClient(resolved.provider)).getPullRequestComments(resolved, prNumber);
  }

  public async getPullRequestDetail(
    prNumber: number,
    coords?: Partial<RepoCoordinates>,
    options?: { commitSha?: string }
  ): Promise<{
    number: number;
    title: string;
    body?: string;
    state: string;
    merged: boolean;
    author?: string;
    createdAt: string;
    updatedAt: string;
    htmlUrl?: string;
    labels: string[];
  }> {
    const resolved = await this.resolveCoordinates(coords);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostPullDetailFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("prIssue", resolved, "detail", prNumber, "cloud"), "prIssue", async () =>
        this.options.cloudCodeHostPullDetailFetcher!({
          repoId,
          prNumber,
          coords: resolved,
          commitSha: options?.commitSha
        })
      );
    }
    const creds = await this.options.secrets.getCredentials();
    if (resolved.provider === "github" && creds.githubToken) {
      const url = `https://api.github.com/repos/${encodeURIComponent(resolved.owner)}/${encodeURIComponent(resolved.repo)}/pulls/${prNumber}`;
      const { codeHostRequestJson } = await import("./codeHostHttp");
      const pr = await codeHostRequestJson<{
        number: number;
        title: string;
        body?: string;
        state: string;
        merged_at?: string | null;
        user?: { login?: string };
        created_at: string;
        updated_at: string;
        html_url?: string;
        labels?: Array<{ name: string }>;
      }>(url, {
        headers: {
          Authorization: `Bearer ${creds.githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "coop-ai-extension"
        },
        provider: "github"
      });
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        merged: Boolean(pr.merged_at),
        author: pr.user?.login,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        htmlUrl: pr.html_url,
        labels: (pr.labels ?? []).map((label) => label.name),
        owner: resolved.owner,
        repo: resolved.repo
      };
    }
    throw new CodeHostError("Pull request details require GitHub authorization.", "auth", 401, resolved.provider);
  }

  public async getPullRequestsForCommit(
    sha: string,
    coords?: Partial<RepoCoordinates>
  ): Promise<
    Array<{
      number: number;
      title: string;
      body?: string;
      state: string;
      merged: boolean;
      author?: string;
      createdAt: string;
      updatedAt: string;
      htmlUrl?: string;
      owner: string;
      repo: string;
      labels: string[];
    }>
  > {
    const resolved = await this.resolveCoordinates(coords);
    if (this.options.useCloudCodeHostProxy?.() && this.options.cloudCodeHostCommitPullsFetcher) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("commit", resolved, sha, "pulls", "cloud"), "commitHistory", async () =>
        this.options.cloudCodeHostCommitPullsFetcher!({ repoId, sha, coords: resolved })
      );
    }
    const creds = await this.options.secrets.getCredentials();
    if (resolved.provider === "github" && creds.githubToken) {
      const url = `https://api.github.com/repos/${encodeURIComponent(resolved.owner)}/${encodeURIComponent(resolved.repo)}/commits/${encodeURIComponent(sha)}/pulls`;
      const { codeHostRequestJson } = await import("./codeHostHttp");
      const pulls = await codeHostRequestJson<
        Array<{
          number: number;
          title: string;
          body?: string;
          state: string;
          merged_at?: string | null;
          user?: { login?: string };
          created_at: string;
          updated_at: string;
          html_url?: string;
          url?: string;
          labels?: Array<{ name: string }>;
          base?: { repo?: { owner?: { login?: string }; name?: string } };
        }>
      >(url, {
        headers: {
          Authorization: `Bearer ${creds.githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "coop-ai-extension"
        },
        provider: "github"
      }).catch(() => []);
      return pulls.map((pull) => {
        const fromApiUrl = pull.url?.match(/\/repos\/([^/]+)\/([^/]+)\/pulls\//);
        return {
          number: pull.number,
          title: pull.title,
          body: pull.body,
          state: pull.state,
          merged: Boolean(pull.merged_at),
          author: pull.user?.login,
          createdAt: pull.created_at,
          updatedAt: pull.updated_at,
          htmlUrl: pull.html_url,
          owner: pull.base?.repo?.owner?.login ?? fromApiUrl?.[1] ?? resolved.owner,
          repo: pull.base?.repo?.name ?? fromApiUrl?.[2] ?? resolved.repo,
          labels: (pull.labels ?? []).map((label) => label.name)
        };
      });
    }
    return [];
  }

  public async getIssuesForFile(filePath: string, coords?: Partial<RepoCoordinates>): Promise<IssueSummary[]> {
    const resolved = await this.resolveCoordinates(coords);
    const path = filePath.replace(/^\/+/, "");
    const issues = await this.listRepoIssues(resolved, { state: "all", limit: 50 });
    const needle = path.toLowerCase();
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(needle) ||
        issue.htmlUrl?.toLowerCase().includes(needle) ||
        issue.body?.toLowerCase().includes(needle)
    );
  }

  private async enrichPullRequestsWithFiles(
    prs: PullRequestSummary[],
    coords: RepoCoordinates
  ): Promise<PullRequestSummary[]> {
    const client = await this.getClient(coords.provider);
    if (!client.getPullRequestFiles) {
      return prs;
    }
    const results = await Promise.all(
      prs.map(async (pr) => {
        if (pr.files?.length) {
          return pr;
        }
        try {
          const files = await client.getPullRequestFiles!(coords, pr.number);
          return { ...pr, files };
        } catch {
          return pr;
        }
      })
    );
    return results;
  }

  public toRemoteTreeNodes(tree: RemoteTree): RemoteTreeEntry[] {
    return tree.entries;
  }

  /** Drop cached API clients so the next request picks up new tokens from SecretStorage. */
  public clearClientCache(provider?: CodeHostProvider): void {
    if (provider) {
      this.clients.delete(provider);
      return;
    }
    this.clients.clear();
  }

  /** Drop cached GitHub/GitLab file, blame, and history responses. */
  public clearDataCache(): Promise<void> {
    return this.options.cache.clear();
  }

  private async getClient(provider: CodeHostProvider): Promise<CodeHostClient> {
    const existing = this.clients.get(provider);
    if (existing) {
      return existing;
    }
    const creds = await this.options.secrets.getCredentials();
    const hostConfig = readCodeHostConfiguration();
    let client: CodeHostClient;
    switch (provider) {
      case "github": {
        if (this.options.useCloudCodeHostProxy?.()) {
          throw new CodeHostError(
            "GitHub file access is routed through the Coop cloud backend.",
            "auth",
            401,
            provider
          );
        }
        if (!creds.githubToken) {
          throw new CodeHostError("GitHub token is missing. Add it in CoopAI settings.", "auth", 401, provider);
        }
        client = new GitHubClient({ token: creds.githubToken, rateLimitTracker: this.rateLimitTracker });
        break;
      }
      case "gitlab": {
        if (this.options.useCloudCodeHostProxy?.()) {
          throw new CodeHostError(
            "GitLab file access uses the CoopAI cloud backend. Authorize GitLab in settings.",
            "auth",
            401,
            provider
          );
        }
        if (!creds.gitlabToken) {
          throw new CodeHostError("GitLab token is missing. Add it in CoopAI settings.", "auth", 401, provider);
        }
        client = new GitLabClient({
          token: creds.gitlabToken,
          baseUrl: hostConfig.gitlabBaseUrl,
          rateLimitTracker: this.rateLimitTracker
        });
        break;
      }
      case "bitbucket": {
        if (this.options.useCloudCodeHostProxy?.()) {
          throw new CodeHostError(
            "Bitbucket file access uses the CoopAI cloud backend. Authorize Bitbucket in settings.",
            "auth",
            401,
            provider
          );
        }
        if (!creds.bitbucketUsername || !creds.bitbucketAppPassword) {
          throw new CodeHostError("Bitbucket credentials are missing. Add them in CoopAI settings.", "auth", 401, provider);
        }
        client = new BitbucketClient({
          username: creds.bitbucketUsername,
          appPassword: creds.bitbucketAppPassword,
          rateLimitTracker: this.rateLimitTracker
        });
        break;
      }
      default:
        throw new CodeHostError(`Unsupported provider: ${provider}`, "unsupported");
    }
    this.clients.set(provider, client);
    return client;
  }

  private key(category: string, coords: RepoCoordinates, ...parts: Array<string | number>): string {
    return this.options.cache.buildKey([
      category,
      coords.provider,
      coords.owner,
      coords.repo,
      coords.branch ?? "default",
      ...parts
    ]);
  }

  private async cached<T>(
    key: string,
    category: import("../../cache/CacheManager").CacheCategory,
    loader: () => Promise<T>
  ): Promise<T> {
    const hit = await this.options.cache.get<T>(key);
    if (hit && !hit.stale) {
      return hit.data;
    }
    try {
      const data = await loader();
      await this.options.cache.set(key, category, data);
      return data;
    } catch (error) {
      if (hit) {
        return hit.data;
      }
      throw error;
    }
  }
}

function buildCrossRepoSearchTargets(
  source: RepoCoordinates,
  collectionRepoIds?: string[]
): RepoCoordinates[] {
  if (!collectionRepoIds?.length) {
    return [source];
  }
  const targets: RepoCoordinates[] = [];
  const seen = new Set<string>();
  for (const repoId of collectionRepoIds) {
    const coords = coordinatesFromRepoId(repoId, source.branch) ?? {
      ...source,
      owner: repoId.includes("/") ? repoId.split("/")[0] : source.owner,
      repo: repoId.includes("/") ? repoId.split("/").slice(1).join("/") : repoId
    };
    if (coords.provider !== source.provider) {
      continue;
    }
    const key = repoIdFromCoordinates(coords);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(coords);
  }
  return targets.length > 0 ? targets : [source];
}


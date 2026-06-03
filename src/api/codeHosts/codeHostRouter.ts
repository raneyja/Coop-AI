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
import { CodeHostError, humanizeRelativeDate, repoIdFromCoordinates, coordinatesFromRepoId } from "./types";

export type CloudGithubFileFetcher = (options: {
  repoId: string;
  path: string;
  coords: RepoCoordinates;
}) => Promise<RemoteFileContent>;

export type CodeHostRouterOptions = {
  secrets: CodeHostSecrets;
  cache: CacheManager;
  rateLimitTracker?: RateLimitTracker;
  /** When true, GitHub file reads use the backend proxy (no local PAT). */
  useCloudGithubProxy?: () => boolean;
  cloudGithubFileFetcher?: CloudGithubFileFetcher;
  cloudGithubHealthCheck?: () => Promise<{ ok: boolean; message: string }>;
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
    if (
      provider === "github" &&
      this.options.useCloudGithubProxy?.() &&
      this.options.cloudGithubHealthCheck
    ) {
      return this.options.cloudGithubHealthCheck();
    }
    const client = await this.getClient(provider);
    return client.testConnection();
  }

  public async getRepository(coords?: Partial<RepoCoordinates>): Promise<RemoteRepository> {
    const resolved = await this.resolveCoordinates(coords);
    return this.cached(
      this.key("repoMetadata", resolved),
      "repoMetadata",
      async () => (await this.getClient(resolved.provider)).getRepository(resolved)
    );
  }

  public async getRepositoryTree(path = "", coords?: Partial<RepoCoordinates>): Promise<RemoteTree> {
    const resolved = await this.resolveCoordinates(coords);
    const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
    return this.cached(this.key("tree", resolved, normalized), "tree", async () =>
      (await this.getClient(resolved.provider)).getRepositoryTree(resolved, normalized)
    );
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
    if (
      resolved.provider === "github" &&
      this.options.useCloudGithubProxy?.() &&
      this.options.cloudGithubFileFetcher
    ) {
      const repoId = repoIdFromCoordinates(resolved);
      return this.cached(this.key("fileContent", resolved, path, "cloud"), "fileContent", async () =>
        this.options.cloudGithubFileFetcher!({ repoId, path, coords: resolved })
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
    return this.cached(this.key("commitHistory", resolved, options?.path ?? "", limit), "commitHistory", async () =>
      (await this.getClient(resolved.provider)).getCommitHistory(resolved, {
        path: options?.path,
        limit
      })
    );
  }

  public async getFileHistory(filePath: string, limit = 20, coords?: Partial<RepoCoordinates>): Promise<CommitInfo[]> {
    const resolved = await this.resolveCoordinates(coords);
    const path = toRepositoryRelativePath(filePath);
    return this.cached(this.key("fileHistory", resolved, path, limit), "commitHistory", async () =>
      (await this.getClient(resolved.provider)).getFileHistory(resolved, path, limit)
    );
  }

  public async getBlameData(filePath: string, coords?: Partial<RepoCoordinates>): Promise<BlameData> {
    const resolved = await this.resolveCoordinates(coords);
    const path = toRepositoryRelativePath(filePath);
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

  public async getPRsForFile(
    filePath: string,
    limit = 20,
    coords?: Partial<RepoCoordinates>
  ): Promise<PullRequestSummary[]> {
    const resolved = await this.resolveCoordinates(coords);
    const path = filePath.replace(/^\/+/, "");
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
    return this.cached(this.key("prIssue", resolved, "reviews", prNumber), "prIssue", async () =>
      (await this.getClient(resolved.provider)).getPullRequestReviews(resolved, prNumber)
    );
  }

  public async getPRComments(
    prNumber: number,
    coords?: Partial<RepoCoordinates>
  ): Promise<PullRequestComment[]> {
    const resolved = await this.resolveCoordinates(coords);
    return (await this.getClient(resolved.provider)).getPullRequestComments(resolved, prNumber);
  }

  public async getIssuesForFile(filePath: string, coords?: Partial<RepoCoordinates>): Promise<IssueSummary[]> {
    const resolved = await this.resolveCoordinates(coords);
    const path = filePath.replace(/^\/+/, "");
    const issues = await this.cached(this.key("prIssue", resolved, "issues"), "prIssue", async () =>
      (await this.getClient(resolved.provider)).listIssues(resolved, { state: "all", limit: 50 })
    );
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
        if (this.options.useCloudGithubProxy?.()) {
          throw new CodeHostError(
            "GitHub file access uses the CoopAI cloud backend. Install the GitHub App in settings.",
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

import { RateLimitTracker } from "../rateLimitTracker";
import {
  codeHostRequest,
  codeHostRequestJson,
  decodeContent,
  linesFromText,
  paginatedCodeHostFetch,
  parseLinkNext
} from "./codeHostHttp";
import type {
  BlameData,
  CodeHostClient,
  CommitInfo,
  IssueSummary,
  PullRequestComment,
  PullRequestSummary,
  RemoteFileContent,
  RemoteRepository,
  RemoteTree,
  RemoteTreeEntry,
  RepoCoordinates
} from "./types";
import { CodeHostError } from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";

type GitHubClientOptions = {
  token: string;
  rateLimitTracker?: RateLimitTracker;
};

export class GitHubClient implements CodeHostClient {
  public readonly provider = "github" as const;
  private readonly headers: Record<string, string>;

  public constructor(private readonly options: GitHubClientOptions) {
    this.headers = {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "coop-ai-extension"
    };
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await codeHostRequestJson<{ login: string }>(`${GITHUB_API}/user`, {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      });
      return { ok: true, message: "GitHub token is valid." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub connection failed.";
      return { ok: false, message };
    }
  }

  public async listUserRepositories(limit = 100): Promise<RemoteRepository[]> {
    const repos = await paginatedCodeHostFetch<GitHubRepoListItem>({
      firstUrl: `${GITHUB_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker,
      maxPages: Math.max(1, Math.ceil(limit / 100)),
      mapPage: (payload) => (Array.isArray(payload) ? payload : [])
    });
    return repos.slice(0, limit).map((entry) => ({
      owner: entry.owner.login,
      name: entry.name,
      defaultBranch: entry.default_branch,
      isPrivate: entry.private,
      provider: this.provider,
      htmlUrl: entry.html_url
    }));
  }

  public async getRepository(coords: RepoCoordinates): Promise<RemoteRepository> {
    const data = await codeHostRequestJson<GitHubRepo>(this.repoUrl(coords), {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return {
      owner: data.owner.login,
      name: data.name,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      provider: this.provider,
      htmlUrl: data.html_url
    };
  }

  public async getRepositoryTree(coords: RepoCoordinates, dirPath = ""): Promise<RemoteTree> {
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(dirPath);
    const url = path
      ? `${this.repoUrl(coords)}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`
      : `${this.repoUrl(coords)}/contents?ref=${encodeURIComponent(branch)}`;
    const payload = await codeHostRequestJson<GitHubContent | GitHubContent[]>(url, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    const items = Array.isArray(payload) ? payload : [payload];
    const entries: RemoteTreeEntry[] = items
      .filter((item) => item.type === "file" || item.type === "dir")
      .map((item) => ({
        path: item.path,
        name: item.name,
        type: item.type === "dir" ? "dir" : "file",
        size: item.size,
        sha: item.sha,
        lastModified: undefined
      }));
    return { path: path || "/", branch, entries };
  }

  public async getFileContent(coords: RepoCoordinates, filePath: string): Promise<RemoteFileContent> {
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(filePath);
    const data = await codeHostRequestJson<GitHubContent>(`${this.repoUrl(coords)}/contents/${pathSegments(path)}?ref=${encodeURIComponent(branch)}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    if (data.type !== "file" || !data.content) {
      throw new CodeHostError("Path is not a file.", "not_found", 404, this.provider);
    }
    const decoded = decodeContent(data.content.replace(/\n/g, ""), data.encoding);
    if (decoded.truncated) {
      throw new CodeHostError("File too large to display.", "too_large", 413, this.provider);
    }
    return {
      path: data.path,
      size: data.size,
      sha: data.sha,
      content: decoded.text,
      encoding: "utf-8",
      truncated: decoded.truncated,
      branch,
      lines: linesFromText(decoded.text),
      lastModified: undefined
    };
  }

  public async getCommitHistory(
    coords: RepoCoordinates,
    options?: { path?: string; limit?: number }
  ): Promise<CommitInfo[]> {
    const branch = await this.resolveBranch(coords);
    const limit = options?.limit ?? 100;
    const params = new URLSearchParams({ sha: branch, per_page: String(Math.min(limit, 100)) });
    if (options?.path) {
      params.set("path", normalizePath(options.path));
    }
    const commits = await paginatedCodeHostFetch<CommitInfo>({
      firstUrl: `${this.repoUrl(coords)}/commits?${params.toString()}`,
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker,
      maxPages: Math.ceil(limit / 100),
      mapPage: (payload) => (Array.isArray(payload) ? payload : []).map(mapGitHubCommit),
      nextUrl: (_payload, response) => parseLinkNext(response.headers.get("link"))
    });
    return commits.slice(0, limit);
  }

  public async getFileHistory(coords: RepoCoordinates, filePath: string, limit = 20): Promise<CommitInfo[]> {
    return this.getCommitHistory(coords, { path: filePath, limit });
  }

  public async getBlameData(coords: RepoCoordinates, filePath: string): Promise<BlameData> {
    const branch = await this.resolveBranch(coords);
    const owner = coords.owner;
    const repo = coords.repo;
    const query = `
      query($owner: String!, $repo: String!, $path: String!, $ref: String!) {
        repository(owner: $owner, name: $repo) {
          object(expression: $ref) {
            ... on Commit {
              blame(path: $path) {
                ranges {
                  startingLine
                  endingLine
                  commit {
                    oid
                    committedDate
                    author { user { login } name }
                  }
                }
              }
            }
          }
        }
      }`;
    const blameRef = blameExpressionForRef(branch);
    const response = await codeHostRequestJson<{
      data?: {
        repository?: {
          object?: {
            blame?: {
              ranges?: Array<{
                startingLine: number;
                endingLine: number;
                commit: { oid: string; committedDate: string; author: { user?: { login?: string }; name?: string } };
              }>;
            };
          } | null;
        } | null;
      };
      errors?: Array<{ message: string }>;
    }>(GITHUB_GRAPHQL, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { owner, repo, path: normalizePath(filePath), ref: blameRef }
      }),
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    if (response.errors?.length) {
      throw new CodeHostError(response.errors[0].message, "network", undefined, this.provider);
    }
    if (!response.data?.repository?.object) {
      throw new CodeHostError(
        `Could not load blame for ${owner}/${repo}@${branch}. Check owner, repo name (e.g. CoopAI), and branch.`,
        "not_found",
        404,
        this.provider
      );
    }
    const ranges = response.data.repository.object.blame?.ranges ?? [];
    const lines: BlameData["lines"] = [];
    for (const range of ranges) {
      for (let line = range.startingLine; line <= range.endingLine; line += 1) {
        lines.push({
          lineNumber: line,
          commitSha: range.commit.oid,
          author: range.commit.author.user?.login ?? range.commit.author.name ?? "unknown",
          date: range.commit.committedDate
        });
      }
    }
    return { path: normalizePath(filePath), branch, lines };
  }

  public async listPullRequests(
    coords: RepoCoordinates,
    options?: { state?: string; limit?: number }
  ): Promise<PullRequestSummary[]> {
    const limit = options?.limit ?? 30;
    const params = new URLSearchParams({
      state: options?.state ?? "all",
      per_page: String(Math.min(limit, 100)),
      sort: "updated",
      direction: "desc"
    });
    const pulls = await codeHostRequestJson<GitHubPull[]>(`${this.repoUrl(coords)}/pulls?${params.toString()}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return pulls.slice(0, limit).map(mapGitHubPull);
  }

  public async getPullRequestComments(coords: RepoCoordinates, prNumber: number): Promise<PullRequestComment[]> {
    const [reviewComments, issueComments] = await Promise.all([
      codeHostRequestJson<GitHubReviewComment[]>(`${this.repoUrl(coords)}/pulls/${prNumber}/comments`, {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }),
      codeHostRequestJson<GitHubIssueComment[]>(`${this.repoUrl(coords)}/issues/${prNumber}/comments`, {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      })
    ]);
    return [
      ...reviewComments.map((comment) => ({
        id: String(comment.id),
        author: comment.user?.login ?? "unknown",
        body: comment.body,
        path: comment.path,
        line: comment.line,
        createdAt: comment.created_at,
        resolved: false
      })),
      ...issueComments.map((comment) => ({
        id: `issue-${comment.id}`,
        author: comment.user?.login ?? "unknown",
        body: comment.body,
        createdAt: comment.created_at,
        resolved: false
      }))
    ];
  }

  public async listIssues(
    coords: RepoCoordinates,
    options?: { state?: string; limit?: number }
  ): Promise<IssueSummary[]> {
    const limit = options?.limit ?? 30;
    const params = new URLSearchParams({
      state: options?.state ?? "open",
      per_page: String(Math.min(limit, 100))
    });
    const issues = await codeHostRequestJson<GitHubIssue[]>(`${this.repoUrl(coords)}/issues?${params.toString()}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return issues
      .filter((issue) => !issue.pull_request)
      .slice(0, limit)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.user?.login,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        htmlUrl: issue.html_url
      }));
  }

  public async searchCode(coords: RepoCoordinates, query: string, limit = 20): Promise<Array<{ path: string }>> {
    const q = encodeURIComponent(`${query} repo:${coords.owner}/${coords.repo}`);
    const result = await codeHostRequestJson<{ items?: Array<{ path: string }> }>(
      `${GITHUB_API}/search/code?q=${q}&per_page=${limit}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return (result.items ?? []).map((item) => ({ path: item.path }));
  }

  private repoUrl(coords: RepoCoordinates): string {
    return `${GITHUB_API}/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}`;
  }

  private async resolveBranch(coords: RepoCoordinates): Promise<string> {
    if (coords.branch) {
      return coords.branch;
    }
    const repo = await this.getRepository(coords);
    return repo.defaultBranch;
  }
}

type GitHubRepo = {
  name: string;
  private: boolean;
  default_branch: string;
  html_url?: string;
  owner: { login: string };
};

type GitHubRepoListItem = {
  name: string;
  private: boolean;
  default_branch: string;
  html_url?: string;
  owner: { login: string };
};

type GitHubContent = {
  type: string;
  name: string;
  path: string;
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
};

type GitHubCommit = {
  sha: string;
  html_url?: string;
  commit: { message: string; author?: { name?: string; date?: string } };
  author?: { login?: string };
  files?: Array<{ filename: string }>;
};

type GitHubPull = {
  number: number;
  title: string;
  state: string;
  merged_at?: string | null;
  user?: { login?: string };
  created_at: string;
  updated_at: string;
  html_url?: string;
};

type GitHubReviewComment = {
  id: number;
  body: string;
  path?: string;
  line?: number;
  created_at: string;
  user?: { login?: string };
};

type GitHubIssueComment = { id: number; body: string; created_at: string; user?: { login?: string } };

type GitHubIssue = {
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  html_url?: string;
  pull_request?: unknown;
  user?: { login?: string };
};

function mapGitHubCommit(commit: GitHubCommit): CommitInfo {
  return {
    sha: commit.sha,
    author: commit.commit.author?.name ?? commit.author?.login ?? "unknown",
    authorLogin: commit.author?.login,
    date: commit.commit.author?.date ?? new Date(0).toISOString(),
    message: commit.commit.message,
    filesChanged: commit.files?.map((file) => file.filename),
    htmlUrl: commit.html_url
  };
}

function mapGitHubPull(pull: GitHubPull): PullRequestSummary {
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    merged: Boolean(pull.merged_at),
    author: pull.user?.login,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    htmlUrl: pull.html_url
  };
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** GitHub GraphQL object(expression) expects refs/heads/branch or a commit SHA. */
function blameExpressionForRef(branch: string): string {
  const trimmed = branch.trim();
  if (!trimmed) {
    return "HEAD";
  }
  if (trimmed.startsWith("refs/") || /^[0-9a-f]{40}$/i.test(trimmed)) {
    return trimmed;
  }
  return `refs/heads/${trimmed}`;
}

function pathSegments(path: string): string {
  return encodeURIComponent(normalizePath(path)).replace(/%2F/g, "/");
}

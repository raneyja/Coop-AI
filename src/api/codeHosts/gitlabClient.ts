import { RateLimitTracker } from "../rateLimitTracker";
import {
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
  PullRequestReview,
  PullRequestSummary,
  RemoteFileContent,
  RemoteRepository,
  RemoteTree,
  RemoteTreeEntry,
  RepoCoordinates
} from "./types";
import { CodeHostError } from "./types";

const DEFAULT_GITLAB_API = "https://gitlab.com/api/v4";

type GitLabClientOptions = {
  token: string;
  baseUrl?: string;
  rateLimitTracker?: RateLimitTracker;
};

export class GitLabClient implements CodeHostClient {
  public readonly provider = "gitlab" as const;
  private readonly apiBase: string;
  private readonly headers: Record<string, string>;

  public constructor(private readonly options: GitLabClientOptions) {
    this.apiBase = (options.baseUrl ?? DEFAULT_GITLAB_API).replace(/\/$/, "");
    this.headers = {
      "PRIVATE-TOKEN": options.token,
      "User-Agent": "coop-ai-extension"
    };
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await codeHostRequestJson<{ username: string }>(`${this.apiBase}/user`, {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      });
      return { ok: true, message: "GitLab token is valid." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitLab connection failed.";
      return { ok: false, message };
    }
  }

  public async listUserRepositories(limit = 100): Promise<RemoteRepository[]> {
    const projects = await paginatedCodeHostFetch<GitLabProjectListItem>({
      firstUrl: `${this.apiBase}/projects?membership=true&simple=true&order_by=last_activity_at&sort=desc&per_page=100`,
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker,
      maxPages: Math.max(1, Math.ceil(limit / 100)),
      mapPage: (payload) => (Array.isArray(payload) ? payload : []),
      nextUrl: (_payload, response) => parseLinkNext(response.headers.get("link"))
    });
    return projects.slice(0, limit).map((project) => {
      const segments = project.path_with_namespace.split("/");
      const owner = segments[0] ?? project.namespace?.path ?? "unknown";
      const name = segments.length > 1 ? segments.slice(1).join("/") : project.path;
      return {
        owner,
        name,
        defaultBranch: project.default_branch ?? "main",
        isPrivate: project.visibility === "private",
        provider: this.provider,
        htmlUrl: project.web_url
      };
    });
  }

  public async getRepository(coords: RepoCoordinates): Promise<RemoteRepository> {
    const project = await this.getProject(coords);
    return {
      owner: coords.owner,
      name: coords.repo,
      defaultBranch: project.default_branch,
      isPrivate: project.visibility === "private",
      provider: this.provider,
      htmlUrl: project.web_url
    };
  }

  public async getRepositoryTree(coords: RepoCoordinates, dirPath = ""): Promise<RemoteTree> {
    const branch = await this.resolveBranch(coords);
    const projectId = await this.projectId(coords);
    const path = normalizePath(dirPath);
    const params = new URLSearchParams({
      ref: branch,
      per_page: "100",
      path,
      pagination: "keyset"
    });
    const tree = await codeHostRequestJson<GitLabTreeItem[]>(
      `${this.apiBase}/projects/${projectId}/repository/tree?${params.toString()}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    const entries: RemoteTreeEntry[] = tree.map((item) => ({
      path: path ? `${path}/${item.name}` : item.name,
      name: item.name,
      type: item.type === "tree" ? "dir" : "file",
      size: undefined,
      lastModified: undefined
    }));
    return { path: path || "/", branch, entries };
  }

  public async getFileContent(coords: RepoCoordinates, filePath: string): Promise<RemoteFileContent> {
    const branch = await this.resolveBranch(coords);
    const projectId = await this.projectId(coords);
    const path = normalizePath(filePath);
    const file = await codeHostRequestJson<{ file_name: string; file_path: string; size: number; content: string; encoding: string }>(
      `${this.apiBase}/projects/${projectId}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    const decoded = decodeContent(file.content, file.encoding === "base64" ? "base64" : undefined);
    if (decoded.truncated) {
      throw new CodeHostError("File too large to display.", "too_large", 413, this.provider);
    }
    return {
      path: file.file_path,
      size: file.size,
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
    const projectId = await this.projectId(coords);
    const limit = options?.limit ?? 100;
    const params = new URLSearchParams({ ref_name: branch, per_page: String(Math.min(limit, 100)) });
    if (options?.path) {
      params.set("path", normalizePath(options.path));
    }
    const commits = await paginatedCodeHostFetch<CommitInfo>({
      firstUrl: `${this.apiBase}/projects/${projectId}/repository/commits?${params.toString()}`,
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker,
      maxPages: Math.ceil(limit / 100),
      mapPage: (payload) => (Array.isArray(payload) ? payload : []).map(mapGitLabCommit),
      nextUrl: (_payload, response) => parseLinkNext(response.headers.get("link"))
    });
    return commits.slice(0, limit);
  }

  public async getFileHistory(coords: RepoCoordinates, filePath: string, limit = 20): Promise<CommitInfo[]> {
    return this.getCommitHistory(coords, { path: filePath, limit });
  }

  public async getCommitBySha(coords: RepoCoordinates, sha: string): Promise<CommitInfo> {
    const projectId = await this.projectId(coords);
    const commit = await codeHostRequestJson<GitLabCommit>(
      `${this.apiBase}/projects/${projectId}/repository/commits/${encodeURIComponent(sha)}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return mapGitLabCommit(commit);
  }

  public async getBlameData(coords: RepoCoordinates, filePath: string): Promise<BlameData> {
    const branch = await this.resolveBranch(coords);
    const projectId = await this.projectId(coords);
    const path = normalizePath(filePath);
    const blame = await codeHostRequestJson<GitLabBlameLine[]>(
      `${this.apiBase}/projects/${projectId}/repository/files/${encodeURIComponent(path)}/blame?ref=${encodeURIComponent(branch)}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    const lines: BlameData["lines"] = [];
    for (const group of blame) {
      const commit = group.commit;
      for (const line of group.lines) {
        lines.push({
          lineNumber: line,
          commitSha: commit.id,
          author: commit.author_name,
          date: commit.committed_date
        });
      }
    }
    return { path, branch, lines };
  }

  public async listPullRequests(
    coords: RepoCoordinates,
    options?: { state?: string; limit?: number }
  ): Promise<PullRequestSummary[]> {
    const projectId = await this.projectId(coords);
    const limit = options?.limit ?? 30;
    const state = options?.state === "closed" ? "closed" : options?.state === "open" ? "opened" : "all";
    const params = new URLSearchParams({ state, per_page: String(Math.min(limit, 100)) });
    const mrs = await codeHostRequestJson<GitLabMr[]>(`${this.apiBase}/projects/${projectId}/merge_requests?${params.toString()}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return mrs.slice(0, limit).map((mr) => ({
      number: mr.iid,
      title: mr.title,
      state: mr.state,
      merged: mr.state === "merged",
      author: mr.author?.username,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      htmlUrl: mr.web_url
    }));
  }

  public async getPullRequestComments(coords: RepoCoordinates, prNumber: number): Promise<PullRequestComment[]> {
    const projectId = await this.projectId(coords);
    const notes = await codeHostRequestJson<GitLabNote[]>(
      `${this.apiBase}/projects/${projectId}/merge_requests/${prNumber}/notes`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return notes.map((note) => ({
      id: String(note.id),
      author: note.author?.username ?? "unknown",
      body: note.body,
      createdAt: note.created_at,
      resolved: note.resolvable ? note.resolved : undefined
    }));
  }

  public async getPullRequestReviews(_coords: RepoCoordinates, _prNumber: number): Promise<PullRequestReview[]> {
    return [];
  }

  public async listIssues(
    coords: RepoCoordinates,
    options?: { state?: string; limit?: number }
  ): Promise<IssueSummary[]> {
    const projectId = await this.projectId(coords);
    const limit = options?.limit ?? 30;
    const state = options?.state ?? "opened";
    const params = new URLSearchParams({ state, per_page: String(Math.min(limit, 100)) });
    const issues = await codeHostRequestJson<GitLabIssue[]>(`${this.apiBase}/projects/${projectId}/issues?${params.toString()}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return issues.slice(0, limit).map((issue) => ({
      number: issue.iid,
      title: issue.title,
      state: issue.state,
      author: issue.author?.username,
      assignee: issue.assignee?.username,
      body: issue.description,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      htmlUrl: issue.web_url
    }));
  }

  public async searchCode(coords: RepoCoordinates, query: string, limit = 20): Promise<Array<{ path: string }>> {
    const projectId = await this.projectId(coords);
    const params = new URLSearchParams({ scope: "blobs", search: query, per_page: String(limit) });
    const result = await codeHostRequestJson<Array<{ path: string }>>(
      `${this.apiBase}/projects/${projectId}/search?${params.toString()}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return result.map((item) => ({ path: item.path }));
  }

  private async getProject(coords: RepoCoordinates): Promise<GitLabProject> {
    const projectId = await this.projectId(coords);
    return codeHostRequestJson<GitLabProject>(`${this.apiBase}/projects/${projectId}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
  }

  private async projectId(coords: RepoCoordinates): Promise<string> {
    const encoded = encodeURIComponent(`${coords.owner}/${coords.repo}`);
    const project = await codeHostRequestJson<{ id: number }>(`${this.apiBase}/projects/${encoded}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return String(project.id);
  }

  private async resolveBranch(coords: RepoCoordinates): Promise<string> {
    if (coords.branch) {
      return coords.branch;
    }
    const repo = await this.getRepository(coords);
    return repo.defaultBranch;
  }
}

type GitLabProject = { default_branch: string; visibility: string; web_url?: string };
type GitLabProjectListItem = GitLabProject & {
  path: string;
  path_with_namespace: string;
  namespace?: { path?: string };
};
type GitLabTreeItem = { name: string; type: string; path: string };
type GitLabCommit = {
  id: string;
  title: string;
  message: string;
  author_name: string;
  committed_date: string;
  web_url?: string;
};
type GitLabBlameLine = { commit: { id: string; author_name: string; committed_date: string }; lines: number[] };
type GitLabMr = {
  iid: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  web_url?: string;
  author?: { username?: string };
};
type GitLabNote = {
  id: number;
  body: string;
  created_at: string;
  author?: { username?: string };
  resolvable?: boolean;
  resolved?: boolean;
};
type GitLabIssue = {
  iid: number;
  title: string;
  state: string;
  description?: string;
  created_at: string;
  updated_at: string;
  web_url?: string;
  author?: { username?: string };
  assignee?: { username?: string } | null;
};

function mapGitLabCommit(commit: GitLabCommit): CommitInfo {
  return {
    sha: commit.id,
    author: commit.author_name,
    date: commit.committed_date,
    message: commit.message || commit.title,
    htmlUrl: commit.web_url
  };
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

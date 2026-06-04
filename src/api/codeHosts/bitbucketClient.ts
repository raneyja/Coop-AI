import { RateLimitTracker } from "../rateLimitTracker";
import { codeHostRequestJson, decodeContent, linesFromText, paginatedCodeHostFetch } from "./codeHostHttp";
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

const BITBUCKET_API = "https://api.bitbucket.org/2.0";

type BitbucketClientOptions = {
  username?: string;
  appPassword?: string;
  /** OAuth access token (Bearer auth) — used by cloud backend App installations. */
  token?: string;
  rateLimitTracker?: RateLimitTracker;
};

export class BitbucketClient implements CodeHostClient {
  public readonly provider = "bitbucket" as const;
  private readonly headers: Record<string, string>;

  public constructor(private readonly options: BitbucketClientOptions) {
    if (options.token) {
      this.headers = {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/json",
        "User-Agent": "coop-ai-extension"
      };
    } else if (options.username && options.appPassword) {
      const encoded = Buffer.from(`${options.username}:${options.appPassword}`).toString("base64");
      this.headers = {
        Authorization: `Basic ${encoded}`,
        Accept: "application/json",
        "User-Agent": "coop-ai-extension"
      };
    } else {
      throw new Error("BitbucketClient requires token or username+appPassword");
    }
  }

  public async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await codeHostRequestJson<{ username: string }>(`${BITBUCKET_API}/user`, {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      });
      return { ok: true, message: "Bitbucket credentials are valid." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bitbucket connection failed.";
      return { ok: false, message };
    }
  }

  public async getRepository(coords: RepoCoordinates): Promise<RemoteRepository> {
    const repo = await codeHostRequestJson<BitbucketRepo>(this.repoUrl(coords), {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return {
      owner: coords.owner,
      name: coords.repo,
      defaultBranch: repo.mainbranch?.name ?? "main",
      isPrivate: repo.is_private,
      provider: this.provider,
      htmlUrl: repo.links?.html?.href
    };
  }

  public async getRepositoryTree(coords: RepoCoordinates, dirPath = ""): Promise<RemoteTree> {
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(dirPath);
    const url = path
      ? `${this.repoUrl(coords)}/src/${encodeURIComponent(branch)}/${pathSegments(path)}?pagelen=100`
      : `${this.repoUrl(coords)}/src/${encodeURIComponent(branch)}/?pagelen=100`;
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketSrcEntry>>(url, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    const entries: RemoteTreeEntry[] = (payload.values ?? []).map((item) => ({
      path: item.path,
      name: item.path.split("/").pop() ?? item.path,
      type: item.type === "commit_directory" ? "dir" : "file",
      size: item.size,
      lastModified: undefined
    }));
    return { path: path || "/", branch, entries };
  }

  public async getFileContent(coords: RepoCoordinates, filePath: string): Promise<RemoteFileContent> {
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(filePath);
    const response = await fetch(
      `${this.repoUrl(coords)}/src/${encodeURIComponent(branch)}/${pathSegments(path)}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new CodeHostError(`Failed to fetch file (${response.status}).`, response.status === 404 ? "not_found" : "network", response.status, this.provider);
    }
    const text = await response.text();
    const decoded = decodeContent(text, undefined);
    if (decoded.truncated) {
      throw new CodeHostError("File too large to display.", "too_large", 413, this.provider);
    }
    return {
      path,
      size: Buffer.byteLength(decoded.text, "utf-8"),
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
    const limit = options?.limit ?? 100;
    const path = options?.path ? `/${normalizePath(options.path)}` : "";
    const commits = await paginatedCodeHostFetch<CommitInfo>({
      firstUrl: `${this.repoUrl(coords)}/commits${path}?pagelen=${Math.min(limit, 100)}`,
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker,
      maxPages: Math.ceil(limit / 100),
      mapPage: (payload) => {
        const page = payload as BitbucketPaginated<BitbucketCommit>;
        return (page.values ?? []).map(mapBitbucketCommit);
      },
      nextUrl: (payload) => (payload as BitbucketPaginated<unknown>).next
    });
    return commits.slice(0, limit);
  }

  public async getFileHistory(coords: RepoCoordinates, filePath: string, limit = 20): Promise<CommitInfo[]> {
    return this.getCommitHistory(coords, { path: filePath, limit });
  }

  public async getCommitBySha(coords: RepoCoordinates, sha: string): Promise<CommitInfo> {
    const commit = await codeHostRequestJson<BitbucketCommit>(
      `${this.repoUrl(coords)}/commit/${encodeURIComponent(sha)}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return mapBitbucketCommit(commit);
  }

  public async getBlameData(coords: RepoCoordinates, filePath: string): Promise<BlameData> {
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(filePath);
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketAnnotation>>(
      `${this.repoUrl(coords)}/filehistory/${encodeURIComponent(branch)}/${pathSegments(path)}?pagelen=100`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    const lines: BlameData["lines"] = [];
    for (const segment of payload.values ?? []) {
      const commit = segment.commit;
      for (const line of segment.lines ?? []) {
        lines.push({
          lineNumber: line,
          commitSha: commit.hash,
          author: commit.author?.user?.display_name ?? commit.author?.raw ?? "unknown",
          date: commit.date
        });
      }
    }
    return { path, branch, lines };
  }

  public async listPullRequests(
    coords: RepoCoordinates,
    options?: { state?: string; limit?: number }
  ): Promise<PullRequestSummary[]> {
    const limit = options?.limit ?? 30;
    const state = options?.state && options.state !== "all" ? `&state=${options.state}` : "";
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketPull>>(
      `${this.repoUrl(coords)}/pullrequests?pagelen=${Math.min(limit, 50)}${state}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return (payload.values ?? []).slice(0, limit).map((pull) => ({
      number: pull.id,
      title: pull.title,
      state: pull.state,
      merged: pull.state === "MERGED",
      author: pull.author?.display_name,
      createdAt: pull.created_on,
      updatedAt: pull.updated_on,
      htmlUrl: pull.links?.html?.href
    }));
  }

  public async getPullRequestComments(coords: RepoCoordinates, prNumber: number): Promise<PullRequestComment[]> {
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketComment>>(
      `${this.repoUrl(coords)}/pullrequests/${prNumber}/comments?pagelen=100`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return (payload.values ?? []).map((comment) => ({
      id: String(comment.id),
      author: comment.user?.display_name ?? "unknown",
      body: comment.content?.raw ?? "",
      path: comment.inline?.path,
      line: comment.inline?.to,
      createdAt: comment.created_on,
      resolved: false
    }));
  }

  public async getPullRequestReviews(_coords: RepoCoordinates, _prNumber: number): Promise<PullRequestReview[]> {
    return [];
  }

  public async listIssues(
    coords: RepoCoordinates,
    options?: { state?: string; limit?: number }
  ): Promise<IssueSummary[]> {
    const limit = options?.limit ?? 30;
    const query = options?.state ? `&q=state="${options.state.toUpperCase()}"` : "";
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketIssue>>(
      `${this.repoUrl(coords)}/issues?pagelen=${Math.min(limit, 50)}${query}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    return (payload.values ?? []).slice(0, limit).map((issue) => ({
      number: issue.id,
      title: issue.title,
      state: issue.state,
      author: issue.reporter?.display_name,
      createdAt: issue.created_on,
      updatedAt: issue.updated_on,
      htmlUrl: issue.links?.html?.href
    }));
  }

  private repoUrl(coords: RepoCoordinates): string {
    return `${BITBUCKET_API}/repositories/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}`;
  }

  private async resolveBranch(coords: RepoCoordinates): Promise<string> {
    if (coords.branch) {
      return coords.branch;
    }
    const repo = await this.getRepository(coords);
    return repo.defaultBranch;
  }
}

type BitbucketPaginated<T> = { values?: T[]; next?: string };
type BitbucketRepo = { mainbranch?: { name: string }; is_private: boolean; links?: { html?: { href?: string } } };
type BitbucketSrcEntry = { path: string; type: string; size?: number };
type BitbucketCommit = {
  hash: string;
  date: string;
  message: string;
  author?: { user?: { display_name?: string }; raw?: string };
  links?: { html?: { href?: string } };
};
type BitbucketAnnotation = { commit: BitbucketCommit; lines?: number[] };
type BitbucketPull = {
  id: number;
  title: string;
  state: string;
  created_on: string;
  updated_on: string;
  author?: { display_name?: string };
  links?: { html?: { href?: string } };
};
type BitbucketComment = {
  id: number;
  created_on: string;
  content?: { raw?: string };
  user?: { display_name?: string };
  inline?: { path?: string; to?: number };
};
type BitbucketIssue = {
  id: number;
  title: string;
  state: string;
  created_on: string;
  updated_on: string;
  reporter?: { display_name?: string };
  links?: { html?: { href?: string } };
};

function mapBitbucketCommit(commit: BitbucketCommit): CommitInfo {
  return {
    sha: commit.hash,
    author: commit.author?.user?.display_name ?? commit.author?.raw ?? "unknown",
    date: commit.date,
    message: commit.message,
    htmlUrl: commit.links?.html?.href
  };
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function pathSegments(path: string): string {
  return normalizePath(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

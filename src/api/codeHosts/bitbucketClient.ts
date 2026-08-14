import { RateLimitTracker } from "../rateLimitTracker";
import { codeHostRequestJson, decodeContent, linesFromText, paginatedCodeHostFetch } from "./codeHostHttp";
import { throwPullRequestWriteNotYet } from "./pullRequestWrite";
import type {
  BlameData,
  CodeHostClient,
  CommitInfo,
  CreatePullRequestInput,
  CreatePullRequestResult,
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
      const message = error instanceof Error ? error.message : "Bitbucket test failed.";
      return { ok: false, message };
    }
  }

  public async listUserRepositories(limit = 100): Promise<RemoteRepository[]> {
    // CHANGE-2770 / CHANGE-3022: unscoped GET /2.0/repositories and GET /2.0/workspaces
    // return 410. Discover workspaces via /user/workspaces, then list repos per workspace.
    const workspaces = await paginatedCodeHostFetch<BitbucketWorkspaceListItem>({
      firstUrl: `${BITBUCKET_API}/user/workspaces?pagelen=100`,
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker,
      maxPages: 20,
      mapPage: (payload) => {
        const page = payload as BitbucketPaginated<BitbucketWorkspaceListItem>;
        return page.values ?? [];
      },
      nextUrl: (payload) => {
        const page = payload as BitbucketPaginated<BitbucketWorkspaceListItem>;
        return page.next;
      }
    });

    const repos: BitbucketRepo[] = [];
    for (const entry of workspaces) {
      const slug = bitbucketWorkspaceSlug(entry);
      if (!slug) {
        continue;
      }
      if (repos.length >= limit) {
        break;
      }
      const remaining = limit - repos.length;
      const workspaceRepos = await paginatedCodeHostFetch<BitbucketRepo>({
        firstUrl: `${BITBUCKET_API}/repositories/${encodeURIComponent(slug)}?role=member&pagelen=100&sort=-updated_on`,
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker,
        maxPages: Math.max(1, Math.ceil(remaining / 100)),
        mapPage: (payload) => {
          const page = payload as BitbucketPaginated<BitbucketRepo>;
          return page.values ?? [];
        },
        nextUrl: (payload) => {
          const page = payload as BitbucketPaginated<BitbucketRepo>;
          return page.next;
        }
      });
      repos.push(...workspaceRepos);
    }

    return repos.slice(0, limit).map((entry) => {
      const fullName = entry.full_name ?? "";
      const slash = fullName.indexOf("/");
      const owner = slash >= 0 ? fullName.slice(0, slash) : entry.workspace?.slug ?? "unknown";
      const name = slash >= 0 ? fullName.slice(slash + 1) : entry.name;
      return {
        owner,
        name,
        defaultBranch: entry.mainbranch?.name ?? "main",
        isPrivate: entry.is_private,
        provider: this.provider,
        htmlUrl: entry.links?.html?.href
      };
    });
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

  public async countRepositoryFiles(
    coords: RepoCoordinates
  ): Promise<{ fileCount: number; truncated: boolean }> {
    const { countFilesViaDirectoryWalk } = await import("../../context/countFilesViaDirectoryWalk");
    const walked = await countFilesViaDirectoryWalk((dirPath) => this.getRepositoryTree(coords, dirPath));
    return { fileCount: walked.fileCount, truncated: walked.truncated };
  }

  public async getFileContent(coords: RepoCoordinates, filePath: string): Promise<RemoteFileContent> {
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(filePath);
    // Raw file bodies must not send Accept: application/json (directory listings do).
    const response = await fetch(
      `${this.repoUrl(coords)}/src/${encodeURIComponent(branch)}/${pathSegments(path)}`,
      {
        headers: {
          Authorization: this.headers.Authorization,
          Accept: "*/*",
          "User-Agent": this.headers["User-Agent"] ?? "coop-ai-extension"
        },
        redirect: "follow"
      }
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
    // Bitbucket: GET .../commits[/{revision}]?path=file — path is a query param.
    // Putting the file path in the URL path treats the first segment as a revision
    // (e.g. /commits/apps/api/... → revision "apps") and fails file history.
    const branch = await this.resolveBranch(coords);
    const limit = options?.limit ?? 100;
    const params = new URLSearchParams({ pagelen: String(Math.min(limit, 100)) });
    if (options?.path) {
      params.set("path", normalizePath(options.path));
    }
    const commits = await paginatedCodeHostFetch<CommitInfo>({
      firstUrl: `${this.repoUrl(coords)}/commits/${encodeURIComponent(branch)}?${params.toString()}`,
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
    // Prefer filehistory (follows renames). Fall back to commits?path= if needed.
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(filePath);
    try {
      const commits = await paginatedCodeHostFetch<CommitInfo>({
        firstUrl: `${this.repoUrl(coords)}/filehistory/${encodeURIComponent(branch)}/${pathSegments(path)}?pagelen=${Math.min(limit, 100)}`,
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker,
        maxPages: Math.ceil(limit / 100),
        mapPage: (payload) => {
          const page = payload as BitbucketPaginated<BitbucketFileHistoryEntry>;
          return (page.values ?? [])
            .map((entry) => (entry.commit ? mapBitbucketCommit(entry.commit) : undefined))
            .filter((commit): commit is CommitInfo => Boolean(commit?.sha));
        },
        nextUrl: (payload) => (payload as BitbucketPaginated<unknown>).next
      });
      if (commits.length > 0) {
        return commits.slice(0, limit);
      }
    } catch {
      // Fall through to commits?path=
    }
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
    const mapped = mapBitbucketCommit(commit);
    const filesChanged = await this.getCommitDiffstatPaths(coords, sha).catch(() => undefined);
    if (filesChanged?.length) {
      mapped.filesChanged = filesChanged;
    }
    return mapped;
  }

  /**
   * Bitbucket Cloud diffstat for a commit (vs first parent). Used for mega-PR
   * demotion and introducing-diff honesty — Trace Decision Phase B.
   */
  private async getCommitDiffstatPaths(coords: RepoCoordinates, sha: string): Promise<string[]> {
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketDiffstat>>(
      `${this.repoUrl(coords)}/diffstat/${encodeURIComponent(sha)}?pagelen=100`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    const paths = new Set<string>();
    for (const entry of payload.values ?? []) {
      if (entry.new?.path) {
        paths.add(entry.new.path);
      }
      if (entry.old?.path) {
        paths.add(entry.old.path);
      }
    }
    return [...paths];
  }

  public async getBlameData(coords: RepoCoordinates, filePath: string): Promise<BlameData> {
    // Bitbucket Cloud has no per-line blame API. filehistory returns commits that
    // touched the file (not line annotations). Expose those SHAs so Trace can resolve
    // introducing / recent commits instead of treating blame as empty.
    const branch = await this.resolveBranch(coords);
    const path = normalizePath(filePath);
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketFileHistoryEntry>>(
      `${this.repoUrl(coords)}/filehistory/${encodeURIComponent(branch)}/${pathSegments(path)}?pagelen=100`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    const lines: BlameData["lines"] = [];
    let sentinelLine = 0;
    for (const segment of payload.values ?? []) {
      const commit = segment.commit;
      if (!commit?.hash) {
        continue;
      }
      const author = commit.author?.user?.display_name ?? commit.author?.raw ?? "unknown";
      const explicitLines = segment.lines ?? [];
      if (explicitLines.length > 0) {
        for (const line of explicitLines) {
          lines.push({
            lineNumber: line,
            commitSha: commit.hash,
            author,
            date: commit.date
          });
        }
      } else {
        // Synthetic line numbers: unique SHAs for archaeology, not real line blame.
        sentinelLine += 1;
        lines.push({
          lineNumber: sentinelLine,
          commitSha: commit.hash,
          author,
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

  public async getPullRequestReviews(coords: RepoCoordinates, prNumber: number): Promise<PullRequestReview[]> {
    const detail = await codeHostRequestJson<BitbucketPullDetail>(
      `${this.repoUrl(coords)}/pullrequests/${prNumber}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    ).catch(() => undefined);
    const participants = detail?.participants ?? [];
    return participants
      .filter((participant) => participant.role === "REVIEWER" || Boolean(participant.approved))
      .map((participant, index) => ({
        id: `${participant.user?.uuid ?? participant.user?.display_name ?? "reviewer"}-${index}`,
        author: participant.user?.display_name ?? participant.user?.nickname ?? "unknown",
        state: participant.approved ? "APPROVED" : "COMMENTED",
        submittedAt: detail?.updated_on ?? new Date().toISOString(),
        body: undefined
      }));
  }

  public async getPullRequestFiles(coords: RepoCoordinates, prNumber: number): Promise<string[]> {
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketDiffstat>>(
      `${this.repoUrl(coords)}/pullrequests/${prNumber}/diffstat?pagelen=100`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    );
    const paths = new Set<string>();
    for (const entry of payload.values ?? []) {
      if (entry.new?.path) {
        paths.add(entry.new.path);
      }
      if (entry.old?.path) {
        paths.add(entry.old.path);
      }
    }
    return [...paths];
  }

  public async getPullRequestDetail(
    coords: RepoCoordinates,
    prNumber: number
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
    const pull = await codeHostRequestJson<BitbucketPullDetail>(`${this.repoUrl(coords)}/pullrequests/${prNumber}`, {
      headers: this.headers,
      provider: this.provider,
      rateLimitTracker: this.options.rateLimitTracker
    });
    return {
      number: pull.id,
      title: pull.title,
      body: pull.description,
      state: pull.state,
      merged: pull.state === "MERGED",
      author: pull.author?.display_name,
      createdAt: pull.created_on,
      updatedAt: pull.updated_on,
      htmlUrl: pull.links?.html?.href,
      labels: []
    };
  }

  public async getPullRequestsForCommit(
    coords: RepoCoordinates,
    sha: string
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
      labels: string[];
    }>
  > {
    // Bitbucket has no direct commit→PR endpoint; scan recent PRs for the commit hash.
    const pulls = await this.listPullRequests(coords, { state: "all", limit: 50 });
    const matches: Array<{
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
    }> = [];
    for (const pull of pulls) {
      const detail = await codeHostRequestJson<BitbucketPullDetail>(
        `${this.repoUrl(coords)}/pullrequests/${pull.number}`,
        {
          headers: this.headers,
          provider: this.provider,
          rateLimitTracker: this.options.rateLimitTracker
        }
      ).catch(() => undefined);
      const mergeHash = detail?.merge_commit?.hash;
      const sourceHash = detail?.source?.commit?.hash;
      if (mergeHash === sha || sourceHash === sha || (mergeHash && sha.startsWith(mergeHash)) || (sourceHash && sha.startsWith(sourceHash))) {
        matches.push({
          number: pull.number,
          title: pull.title,
          body: detail?.description,
          state: pull.state,
          merged: pull.merged,
          author: pull.author,
          createdAt: pull.createdAt,
          updatedAt: pull.updatedAt,
          htmlUrl: pull.htmlUrl,
          labels: []
        });
      }
    }
    return matches;
  }

  public async searchCode(coords: RepoCoordinates, query: string, limit = 20): Promise<Array<{ path: string }>> {
    const params = new URLSearchParams({
      search_query: `repo:${coords.owner}/${coords.repo} ${query}`,
      fields: "values.file.path,values.content_match_count"
    });
    const payload = await codeHostRequestJson<BitbucketPaginated<BitbucketSearchHit>>(
      `${BITBUCKET_API}/search/code?${params.toString()}`,
      {
        headers: this.headers,
        provider: this.provider,
        rateLimitTracker: this.options.rateLimitTracker
      }
    ).catch(() => ({ values: [] as BitbucketSearchHit[] }));
    const paths: string[] = [];
    for (const hit of payload.values ?? []) {
      const path = hit.file?.path;
      if (path && !paths.includes(path)) {
        paths.push(path);
      }
      if (paths.length >= limit) {
        break;
      }
    }
    return paths.map((path) => ({ path }));
  }

  public async createPullFromFiles(
    _coords: RepoCoordinates,
    _input: CreatePullRequestInput
  ): Promise<CreatePullRequestResult> {
    throwPullRequestWriteNotYet(this.provider);
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
type BitbucketWorkspace = { slug?: string; name?: string; uuid?: string };
/** /user/workspaces may return the workspace object flat or nested under `workspace`. */
type BitbucketWorkspaceListItem = BitbucketWorkspace & { workspace?: BitbucketWorkspace };
type BitbucketRepo = {
  name: string;
  full_name?: string;
  workspace?: { slug?: string };
  mainbranch?: { name: string };
  is_private: boolean;
  links?: { html?: { href?: string } };
};
type BitbucketSrcEntry = { path: string; type: string; size?: number };
type BitbucketCommit = {
  hash: string;
  date: string;
  message?: string;
  author?: { user?: { display_name?: string }; raw?: string };
  links?: { html?: { href?: string } };
};
/** filehistory entry — commit may be sparse; lines are not part of the Cloud API. */
type BitbucketFileHistoryEntry = { commit?: BitbucketCommit; path?: string; lines?: number[] };
type BitbucketPull = {
  id: number;
  title: string;
  state: string;
  created_on: string;
  updated_on: string;
  author?: { display_name?: string };
  links?: { html?: { href?: string } };
};
type BitbucketParticipant = {
  role?: string;
  approved?: boolean;
  user?: { uuid?: string; display_name?: string; nickname?: string };
};
type BitbucketPullDetail = BitbucketPull & {
  description?: string;
  participants?: BitbucketParticipant[];
  merge_commit?: { hash?: string };
  source?: { commit?: { hash?: string } };
};
type BitbucketDiffstat = {
  new?: { path?: string };
  old?: { path?: string };
};
type BitbucketSearchHit = {
  file?: { path?: string };
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

function bitbucketWorkspaceSlug(entry: BitbucketWorkspaceListItem): string | undefined {
  const slug = entry.slug?.trim() || entry.workspace?.slug?.trim();
  return slug || undefined;
}

function mapBitbucketCommit(commit: BitbucketCommit): CommitInfo {
  return {
    sha: commit.hash,
    author: commit.author?.user?.display_name ?? commit.author?.raw ?? "unknown",
    date: commit.date,
    message: commit.message ?? "",
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

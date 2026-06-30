import axios, { AxiosInstance } from "axios";
import { assertCoopEndpoint } from "./resolveBaseUrl";
import { isRetryableError, runResilientRequest } from "./networkResilience";
import { formatCoopApiError, type CoopApiErrorBody } from "./userFacingErrors";
import type { IdentityDirectory } from "../identity/types";
import type {
  ChatHistoryMessage,
  ChatContextPayload,
  StreamChunk,
  UseCase,
  ChatImageAttachment,
  V1ChatRequestBody
} from "./types";
import type { LlmProvider } from "./zeroRetentionConfig";

export type StreamChatBody = {
  message: string;
  history: ChatHistoryMessage[];
  context?: ChatContextPayload;
  attachments?: ChatImageAttachment[];
  mentions?: V1ChatRequestBody["mentions"];
  model: string;
  provider: LlmProvider;
  useCase: UseCase;
  temperature: number;
  maxTokens: number;
};

export type StreamChatResult = {
  content: string;
  usage?: StreamChunk & { type: "done" };
};

export type InlineCompletionBody = {
  message?: string;
  segments?: { prefix: string; suffix: string };
  stream?: boolean;
  repoId?: string;
  useGraphContext?: boolean;
  languageId?: string;
  file?: string;
  provider: LlmProvider;
  model: string;
  maxTokens: number;
  temperature: number;
};

export type InlineCompletionResult = {
  text: string;
  alternatives: string[];
  model: string;
  provider: string;
};

export type HealthResponse = {
  ok: boolean;
  llm?: {
    mockMode: boolean;
    configuredProviders: LlmProvider[];
  };
};

export type PlanQuotaCredits = {
  usedCredits: number;
  limitCredits: number;
  remainingCredits: number;
  windowHours: number;
  resetsAt: string;
  retryAfterMs: number;
};

export type MeResponse = {
  orgId: string;
  orgName: string;
  plan: "free" | "pro" | "enterprise";
  canUseLightning: boolean;
  lightningBackend?: string;
  userId?: string;
  role?: string;
  authMethod?: "api_key" | "sso_session";
  canInstallIntegrations?: boolean;
  indexedRepoCount?: number;
  indexedRepoLimit?: number | null;
  canEnableMoreRepos?: boolean;
  workspaceRepoCount?: number;
  workspaceRepoLimit?: number | null;
  canAddMoreWorkspaceRepos?: boolean;
  primaryWorkspaceRepoId?: string;
  quota?: PlanQuotaCredits;
};

export type CoopBackendClientOptions = {
  getToken: () => Promise<string | undefined>;
};

export class CoopBackendClient {
  private http: AxiosInstance = axios.create({ timeout: 120_000 });

  public constructor(private readonly options: CoopBackendClientOptions) {}

  public setBaseUrl(baseUrl: string): void {
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/$/, ""),
      timeout: 120_000
    });
  }

  public async health(baseUrl: string): Promise<HealthResponse> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<HealthResponse>("/health", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders(),
      validateStatus: () => true
    });
    return response.data ?? { ok: response.status >= 200 && response.status < 300 };
  }

  public async graphSearch(
    baseUrl: string,
    repoId: string,
    pattern: string,
    options?: {
      collectionId?: string;
      mention?: boolean;
      scope?: "indexed" | "org";
    }
  ): Promise<unknown> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const params: Record<string, string> = { pattern };
    const collectionId = options?.collectionId?.trim();
    if (collectionId) {
      params.collectionId = collectionId;
    }
    if (options?.scope) {
      params.scope = options.scope;
    }
    if (options?.mention) {
      params.mention = "true";
    }
    const response = await runResilientRequest({
      timeoutMs: 15_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/graph/${encodedRepo}/search`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params,
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      return { data: [] };
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { data: [] };
  }

  public async listCollections(
    baseUrl: string
  ): Promise<{
    collections: Array<{
      id: string;
      orgId: string;
      name: string;
      description?: string;
      createdAt: string;
      repos?: Array<{ collectionId: string; repoId: string; addedAt: string }>;
    }>;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{
      collections: Array<{
        id: string;
        orgId: string;
        name: string;
        description?: string;
        createdAt: string;
        repos?: Array<{ collectionId: string; repoId: string; addedAt: string }>;
      }>;
    }>("/v1/collections", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders()
    });
    return response.data ?? { collections: [] };
  }

  public async graphDependents(baseUrl: string, repoId: string, file: string): Promise<unknown> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 15_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/graph/${encodedRepo}/dependents`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { file },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchMe(baseUrl: string): Promise<MeResponse> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<MeResponse>("/v1/me", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders()
    });
    return response.data;
  }

  public async storeGithubCredential(baseUrl: string, token: string): Promise<void> {
    assertCoopEndpoint(baseUrl);
    await this.http.post(
      "/v1/orgs/credentials/github",
      { token },
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders()
      }
    );
  }

  public async getGithubAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getCodeHostAppInstallUrl(baseUrl, "github");
  }

  public async getGithubInstallationStatus(
    baseUrl: string
  ): Promise<{
    installed: boolean;
    tokenValid?: boolean;
    needsReconnect?: boolean;
    hasRefreshToken?: boolean;
    installationId?: number;
    tokenExpiresAt?: string;
  }> {
    return this.getCodeHostInstallationStatus(baseUrl, "github");
  }

  public async getGitlabAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getCodeHostAppInstallUrl(baseUrl, "gitlab");
  }

  public async getGitlabInstallationStatus(
    baseUrl: string
  ): Promise<{ installed: boolean; installationId?: number; tokenExpiresAt?: string }> {
    return this.getCodeHostInstallationStatus(baseUrl, "gitlab");
  }

  public async getBitbucketAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getCodeHostAppInstallUrl(baseUrl, "bitbucket");
  }

  public async getBitbucketInstallationStatus(
    baseUrl: string
  ): Promise<{ installed: boolean; installationId?: number; tokenExpiresAt?: string }> {
    return this.getCodeHostInstallationStatus(baseUrl, "bitbucket");
  }

  public async getSlackAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getIntegrationAppInstallUrl(baseUrl, "slack");
  }

  public async getAtlassianAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getIntegrationAppInstallUrl(baseUrl, "atlassian");
  }

  public async getNotionAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getIntegrationAppInstallUrl(baseUrl, "notion");
  }

  public async getGoogleDocsAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getIntegrationAppInstallUrl(baseUrl, "google-docs");
  }

  public async getTeamsAppInstallUrl(baseUrl: string): Promise<string> {
    return this.getIntegrationAppInstallUrl(baseUrl, "teams");
  }

  public async getSlackInstallationStatus(baseUrl: string): Promise<{
    installed: boolean;
    teamName?: string;
    teamId?: string;
    tokenExpiresAt?: string;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{
      installed: boolean;
      teamName?: string;
      teamId?: string;
      tokenExpiresAt?: string;
    } & CoopApiErrorBody>("/v1/orgs/slack/installation", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders(),
      validateStatus: () => true
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return {
      installed: Boolean(response.data?.installed),
      teamName: response.data?.teamName,
      teamId: response.data?.teamId,
      tokenExpiresAt: response.data?.tokenExpiresAt
    };
  }

  public async getAtlassianInstallationStatus(baseUrl: string): Promise<{
    installed: boolean;
    siteName?: string;
    siteUrl?: string;
    cloudId?: string;
    email?: string;
    tokenExpiresAt?: string;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{
      installed: boolean;
      siteName?: string;
      siteUrl?: string;
      cloudId?: string;
      email?: string;
      tokenExpiresAt?: string;
    } & CoopApiErrorBody>("/v1/orgs/atlassian/installation", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders(),
      validateStatus: () => true
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return {
      installed: Boolean(response.data?.installed),
      siteName: response.data?.siteName,
      siteUrl: response.data?.siteUrl,
      cloudId: response.data?.cloudId,
      email: response.data?.email,
      tokenExpiresAt: response.data?.tokenExpiresAt
    };
  }

  public async getNotionInstallationStatus(baseUrl: string): Promise<{
    installed: boolean;
    workspaceName?: string;
    workspaceId?: string;
    tokenExpiresAt?: string;
  }> {
    return this.getOrgIntegrationInstallationStatus(baseUrl, "notion");
  }

  public async getGoogleDocsInstallationStatus(baseUrl: string): Promise<{
    installed: boolean;
    displayName?: string;
    email?: string;
    tokenExpiresAt?: string;
  }> {
    return this.getOrgIntegrationInstallationStatus(baseUrl, "google-docs");
  }

  public async getTeamsInstallationStatus(baseUrl: string): Promise<{
    installed: boolean;
    displayName?: string;
    email?: string;
    tenantId?: string;
    tokenExpiresAt?: string;
  }> {
    return this.getOrgIntegrationInstallationStatus(baseUrl, "teams");
  }

  public async getIntegrationCredentials(
    baseUrl: string,
    provider: "slack" | "atlassian" | "notion" | "google-docs" | "teams"
  ): Promise<{
    provider: "slack" | "atlassian" | "notion" | "google-docs" | "teams";
    accessToken: string;
    metadata: Record<string, string | undefined>;
    tokenExpiresAt?: string;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{
      provider: "slack" | "atlassian" | "notion" | "google-docs" | "teams";
      accessToken: string;
      metadata: Record<string, string | undefined>;
      tokenExpiresAt?: string;
    } & CoopApiErrorBody>("/v1/orgs/integrations/credentials", {
      baseURL: baseUrl.replace(/\/$/, ""),
      params: { provider },
      headers: await this.authHeaders(),
      validateStatus: () => true
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    const accessToken = response.data?.accessToken?.trim();
    if (!accessToken) {
      throw new Error(`${provider} credentials were not returned by the server.`);
    }
    return {
      provider,
      accessToken,
      metadata: response.data?.metadata ?? {},
      tokenExpiresAt: response.data?.tokenExpiresAt
    };
  }

  private async getOrgIntegrationInstallationStatus(
    baseUrl: string,
    provider: "notion" | "google-docs" | "teams"
  ): Promise<{
    installed: boolean;
    workspaceName?: string;
    workspaceId?: string;
    displayName?: string;
    email?: string;
    tenantId?: string;
    tokenExpiresAt?: string;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{
      installed: boolean;
      workspaceName?: string;
      workspaceId?: string;
      displayName?: string;
      email?: string;
      tenantId?: string;
      tokenExpiresAt?: string;
    } & CoopApiErrorBody>(`/v1/orgs/${provider}/installation`, {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders(),
      validateStatus: () => true
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return {
      installed: Boolean(response.data?.installed),
      workspaceName: response.data?.workspaceName,
      workspaceId: response.data?.workspaceId,
      displayName: response.data?.displayName,
      email: response.data?.email,
      tenantId: response.data?.tenantId,
      tokenExpiresAt: response.data?.tokenExpiresAt
    };
  }

  private async getIntegrationAppInstallUrl(
    baseUrl: string,
    provider: "slack" | "atlassian" | "notion" | "google-docs" | "teams"
  ): Promise<string> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{ url: string } & CoopApiErrorBody>(
      `/v1/${provider}/app/install-url`,
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders(),
        validateStatus: () => true
      }
    );
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    const url = response.data?.url?.trim();
    if (!url) {
      throw new Error("Install URL was not returned by the server.");
    }
    return url;
  }

  public async getCodeHostAppInstallUrl(
    baseUrl: string,
    provider: "github" | "gitlab" | "bitbucket"
  ): Promise<string> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{ url: string } & CoopApiErrorBody>(
      `/v1/${provider}/app/install-url`,
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders(),
        validateStatus: () => true
      }
    );
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    const url = response.data?.url?.trim();
    if (!url) {
      throw new Error("Install URL was not returned by the server.");
    }
    return url;
  }

  public async startPublicSamlLogin(
    baseUrl: string,
    options: { orgId?: string; org?: string; redirect?: string }
  ): Promise<string> {
    assertCoopEndpoint(baseUrl);
    const params = new URLSearchParams({ format: "json" });
    if (options.orgId?.trim()) {
      params.set("orgId", options.orgId.trim());
    }
    if (options.org?.trim()) {
      params.set("org", options.org.trim());
    }
    if (options.redirect?.trim()) {
      params.set("redirect", options.redirect.trim());
    }
    const response = await this.http.get<{ redirectUrl?: string } & CoopApiErrorBody>(
      `/v1/auth/saml/start?${params.toString()}`,
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        validateStatus: () => true
      }
    );
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    const redirectUrl = response.data?.redirectUrl?.trim();
    if (!redirectUrl) {
      throw new Error("SSO redirect URL was not returned by the server.");
    }
    return redirectUrl;
  }

  public async startSamlLogin(baseUrl: string, redirect?: string): Promise<string> {
    assertCoopEndpoint(baseUrl);
    const params = new URLSearchParams({ format: "json" });
    if (redirect?.trim()) {
      params.set("redirect", redirect.trim());
    }
    const response = await this.http.get<{ redirectUrl?: string } & CoopApiErrorBody>(
      `/v1/auth/saml/login?${params.toString()}`,
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders(),
        validateStatus: () => true
      }
    );
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    const redirectUrl = response.data?.redirectUrl?.trim();
    if (!redirectUrl) {
      throw new Error("SSO redirect URL was not returned by the server.");
    }
    return redirectUrl;
  }

  public async getCodeHostInstallationStatus(
    baseUrl: string,
    provider: "github" | "gitlab" | "bitbucket"
  ): Promise<{
    installed: boolean;
    tokenValid?: boolean;
    needsReconnect?: boolean;
    hasRefreshToken?: boolean;
    installationId?: number;
    tokenExpiresAt?: string;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{
      installed: boolean;
      tokenValid?: boolean;
      needsReconnect?: boolean;
      hasRefreshToken?: boolean;
      installationId?: number;
      tokenExpiresAt?: string;
    }>(`/v1/orgs/${provider}/installation`, {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders(),
      validateStatus: () => true
    });
    if (response.status === 401 || response.status === 503) {
      return { installed: false };
    }
    return response.data ?? { installed: false };
  }

  /** Fetches file content via server-side code-host token (org OAuth). */
  public async fetchRepoFile(
    baseUrl: string,
    repoId: string,
    path: string,
    branch?: string
  ): Promise<{
    repoId: string;
    path: string;
    content: string;
    encoding?: string;
    branch: string;
    truncated?: boolean;
  }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/files`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { path, branch },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchRepoSearch(
    baseUrl: string,
    repoId: string,
    query: string,
    branch?: string,
    limit = 30
  ): Promise<{
    repoId: string;
    query: string;
    hits: Array<{ path: string; name: string }>;
  }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/search`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { q: query, branch, limit },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchRepoTree(
    baseUrl: string,
    repoId: string,
    path: string,
    branch?: string
  ): Promise<{
    repoId: string;
    path: string;
    branch: string;
    entries: Array<{
      path: string;
      name: string;
      type: "file" | "dir";
      size?: number;
      sha?: string;
      lastModified?: string;
    }>;
  }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/tree`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { path, branch },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchRepoBlame(
    baseUrl: string,
    repoId: string,
    path: string,
    branch?: string
  ): Promise<{ repoId: string; path: string; blame: import("./codeHosts/types").BlameData }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/blame`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { path, branch },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchRepoHistory(
    baseUrl: string,
    repoId: string,
    path: string | undefined,
    options?: { branch?: string; limit?: number }
  ): Promise<{ repoId: string; path?: string; commits: import("./codeHosts/types").CommitInfo[] }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/history`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { path: path || undefined, branch: options?.branch, limit: options?.limit },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchRepoMetadata(
    baseUrl: string,
    repoId: string,
    branch?: string
  ): Promise<{ repoId: string; repository: import("./codeHosts/types").RemoteRepository }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/metadata`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { branch },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchRepoPulls(
    baseUrl: string,
    repoId: string,
    options?: { branch?: string; state?: string; limit?: number }
  ): Promise<{ repoId: string; pulls: import("./codeHosts/types").PullRequestSummary[] }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/pulls`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { branch: options?.branch, state: options?.state, limit: options?.limit },
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      return { repoId, pulls: [] };
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repoId, pulls: [] };
  }

  public async fetchRepoIssues(
    baseUrl: string,
    repoId: string,
    options?: { branch?: string; state?: string; limit?: number }
  ): Promise<{ repoId: string; issues: import("./codeHosts/types").IssueSummary[] }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/issues`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { branch: options?.branch, state: options?.state, limit: options?.limit },
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      return { repoId, issues: [] };
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repoId, issues: [] };
  }

  public async fetchRepoPullReviews(
    baseUrl: string,
    repoId: string,
    prNumber: number,
    options?: { branch?: string }
  ): Promise<{ repoId: string; number: number; reviews: import("./codeHosts/types").PullRequestReview[] }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/pulls/${prNumber}/reviews`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { branch: options?.branch },
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      return { repoId, number: prNumber, reviews: [] };
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repoId, number: prNumber, reviews: [] };
  }

  public async fetchRepoCommit(
    baseUrl: string,
    repoId: string,
    sha: string,
    branch?: string
  ): Promise<{ repoId: string; sha: string; commit: import("./codeHosts/types").CommitInfo }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/commits/${encodeURIComponent(sha)}`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { branch },
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async fetchRepoPullsForFile(
    baseUrl: string,
    repoId: string,
    path: string,
    options?: { branch?: string; limit?: number }
  ): Promise<{ repoId: string; path: string; pulls: import("./codeHosts/types").PullRequestSummary[] }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/pulls-for-file`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { path, branch: options?.branch, limit: options?.limit },
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      return { repoId, path, pulls: [] };
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repoId, path, pulls: [] };
  }

  public async fetchRepoPullComments(
    baseUrl: string,
    repoId: string,
    prNumber: number,
    options?: { branch?: string; pullOwner?: string; pullRepo?: string }
  ): Promise<{ repoId: string; number: number; comments: import("./codeHosts/types").PullRequestComment[] }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/pulls/${prNumber}/comments`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: {
            branch: options?.branch,
            pullOwner: options?.pullOwner,
            pullRepo: options?.pullRepo
          },
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      return { repoId, number: prNumber, comments: [] };
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repoId, number: prNumber, comments: [] };
  }

  public async fetchRepoPullDetail(
    baseUrl: string,
    repoId: string,
    prNumber: number,
    options?: { branch?: string; commitSha?: string }
  ): Promise<{
    repoId: string;
    number: number;
    pull: {
      number: number;
      title: string;
      body?: string;
      state: string;
      merged: boolean;
      author?: string;
      createdAt: string;
      updatedAt: string;
      htmlUrl?: string;
      owner?: string;
      repo?: string;
      labels: string[];
    };
  }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/pulls/${prNumber}`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { branch: options?.branch, commitSha: options?.commitSha },
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      if (options?.commitSha) {
        const linked = await this.fetchRepoCommitPulls(baseUrl, repoId, options.commitSha, options.branch);
        const fromCommit = linked.pulls.find((pull) => pull.number === prNumber);
        if (fromCommit) {
          return { repoId, number: prNumber, pull: fromCommit };
        }
      }
      throw new Error(`Pull request #${prNumber} not found on this repository.`);
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data;
  }

  public async fetchRepoCommitPulls(
    baseUrl: string,
    repoId: string,
    sha: string,
    branch?: string
  ): Promise<{
    repoId: string;
    sha: string;
    pulls: Array<{
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
    }>;
  }> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 15_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encodedRepo}/commits/${encodeURIComponent(sha)}/pulls`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { branch },
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status === 404) {
      return { repoId, sha, pulls: [] };
    }
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repoId, sha, pulls: [] };
  }

  public async listOrgRepos(baseUrl: string): Promise<{ repos: unknown[] }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{ repos: unknown[] }>("/v1/orgs/repos", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders()
    });
    return response.data ?? { repos: [] };
  }

  public async listCatalogOrgRepos(
    baseUrl: string,
    options?: { query?: string }
  ): Promise<{
    repos: Array<{
      repoId: string;
      provider: string;
      owner: string;
      name: string;
      defaultBranch: string;
      lightningEnabled?: boolean;
      indexStatus?: string;
      workspaceSelected?: boolean;
    }>;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<
      {
        repos: Array<{
          repoId: string;
          provider: string;
          owner: string;
          name: string;
          defaultBranch: string;
          lightningEnabled?: boolean;
          indexStatus?: string;
          workspaceSelected?: boolean;
        }>;
      } & CoopApiErrorBody
    >("/v1/orgs/catalog/repos", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders(),
      params: options?.query ? { q: options.query } : undefined,
      validateStatus: () => true
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repos: [] };
  }

  public async listGithubOrgRepos(
    baseUrl: string,
    options?: { query?: string }
  ): Promise<{
    repos: Array<{
      repoId: string;
      owner: string;
      name: string;
      defaultBranch: string;
      isPrivate?: boolean;
      htmlUrl?: string;
      lightningEnabled?: boolean;
      indexStatus?: string;
    }>;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await runResilientRequest({
      timeoutMs: 45_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get<
          {
            repos: Array<{
              repoId: string;
              owner: string;
              name: string;
              defaultBranch: string;
              isPrivate?: boolean;
              htmlUrl?: string;
              lightningEnabled?: boolean;
              indexStatus?: string;
            }>;
          } & CoopApiErrorBody
        >("/v1/orgs/github/repos", {
          baseURL: baseUrl.replace(/\/$/, ""),
          headers: await this.authHeaders(),
          params: options?.query ? { q: options.query } : undefined,
          validateStatus: () => true
        })
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { repos: [] };
  }

  public async getWorkspaceRepos(baseUrl: string): Promise<{
    repos: Array<{
      repoId: string;
      owner: string;
      name: string;
      defaultBranch: string;
      indexStatus?: string;
      lightningEnabled?: boolean;
      isPrimary?: boolean;
    }>;
    selectedCount: number;
    limit: number | null;
    canAddMore: boolean;
    primaryRepoId?: string;
  }> {
    assertCoopEndpoint(baseUrl);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get("/v1/me/workspace-repos", {
          baseURL: baseUrl.replace(/\/$/, ""),
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data as CoopApiErrorBody));
    }
    return response.data;
  }

  public async setWorkspaceRepos(
    baseUrl: string,
    repoIds: string[]
  ): Promise<Awaited<ReturnType<CoopBackendClient["getWorkspaceRepos"]>>> {
    assertCoopEndpoint(baseUrl);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.put("/v1/me/workspace-repos", { repoIds }, {
          baseURL: baseUrl.replace(/\/$/, ""),
          headers: await this.authHeaders(),
          validateStatus: () => true
        })
    });
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data as CoopApiErrorBody));
    }
    return response.data;
  }

  /** Structure manifest only (paths + symbols). Never includes file bodies. */
  public async fetchRepoManifest(
    baseUrl: string,
    repoId: string
  ): Promise<{
    repoId: string;
    files: Array<{ path: string; symbols: Array<{ name: string; kind: string }> }>;
    fileCount: number;
    lastCrawledAt?: string;
  }> {
    assertCoopEndpoint(baseUrl);
    const encoded = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 30_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/v1/orgs/repos/${encoded}/manifest`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          headers: await this.authHeaders()
        })
    });
    return response.data;
  }

  public async enableLightningRepo(
    baseUrl: string,
    repoId: string
  ): Promise<{ jobId?: string; status?: string }> {
    assertCoopEndpoint(baseUrl);
    const encoded = encodeURIComponent(repoId);
    const response = await this.http.post<{ jobId?: string; status?: string } & CoopApiErrorBody>(
      `/v1/orgs/repos/${encoded}/lightning/enable`,
      {},
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders(),
        validateStatus: () => true
      }
    );
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? {};
  }

  public async disableLightningRepo(baseUrl: string, repoId: string): Promise<void> {
    assertCoopEndpoint(baseUrl);
    const encoded = encodeURIComponent(repoId);
    await this.http.post(
      `/v1/orgs/repos/${encoded}/lightning/disable`,
      {},
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders()
      }
    );
  }

  public async getLightningStatus(baseUrl: string, repoId: string): Promise<{ repo?: unknown }> {
    assertCoopEndpoint(baseUrl);
    const encoded = encodeURIComponent(repoId);
    const response = await this.http.get<{ repo?: unknown }>(`/v1/orgs/repos/${encoded}/lightning/status`, {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders()
    });
    return response.data ?? {};
  }

  public async syncEstate(
    baseUrl: string,
    provider: "github" | "gitlab" | "bitbucket" = "github"
  ): Promise<{ provider: string; discovered: number; queued: number; skipped: number }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.post<
      { provider: string; discovered: number; queued: number; skipped: number } & CoopApiErrorBody
    >(
      "/v1/orgs/estate/sync",
      { provider },
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders(),
        validateStatus: () => true
      }
    );
    if (response.status >= 400) {
      throw new Error(formatCoopApiError(response.status, response.data));
    }
    return response.data ?? { provider, discovered: 0, queued: 0, skipped: 0 };
  }

  public async streamChat(
    baseUrl: string,
    body: StreamChatBody,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<StreamChatResult> {
    assertCoopEndpoint(baseUrl);
    const token = await this.options.getToken();
    if (!token) {
      throw new Error("CoopAI API key is missing. Configure it in the sidebar settings.");
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({
        message: body.message,
        history: body.history,
        context: body.context,
        attachments: body.attachments,
        mentions: body.mentions,
        model: body.model,
        provider: body.provider,
        useCase: body.useCase,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        stream: true
      }),
      signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: { error?: string; message?: string; upgradeUrl?: string } | undefined;
      try {
        body = text ? (JSON.parse(text) as { error?: string; message?: string; upgradeUrl?: string }) : undefined;
      } catch {
        body = undefined;
      }
      if (response.status === 429 && body?.message) {
        throw new Error(body.message);
      }
      throw new Error(`Chat API returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }

    if (!response.body) {
      throw new Error("Chat API returned an empty stream.");
    }

    let full = "";
    let usage: StreamChatResult["usage"];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseSseJson(line);
        if (!event) {
          continue;
        }
        if (event.type === "delta" && typeof event.text === "string") {
          full += event.text;
          onChunk(event.text);
        } else if (event.type === "done") {
          usage = event as StreamChatResult["usage"];
        } else if (event.type === "error") {
          throw new Error(typeof event.message === "string" ? event.message : "Chat stream error.");
        }
      }
      if (signal?.aborted) {
        break;
      }
    }

    return { content: full, usage };
  }

  public async streamInlineCompletion(
    baseUrl: string,
    body: InlineCompletionBody,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<InlineCompletionResult> {
    assertCoopEndpoint(baseUrl);
    const token = await this.options.getToken();
    if (!token) {
      throw new Error("CoopAI API key is missing. Configure it in the sidebar settings.");
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/completions/inline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-use-case": "code-completion-only"
      },
      body: JSON.stringify({
        message: body.message,
        segments: body.segments,
        stream: true,
        repoId: body.repoId,
        useGraphContext: body.useGraphContext,
        languageId: body.languageId,
        file: body.file,
        provider: body.provider,
        model: body.model,
        maxTokens: body.maxTokens,
        temperature: body.temperature
      }),
      signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let errorBody: { error?: string; message?: string } | undefined;
      try {
        errorBody = text ? (JSON.parse(text) as { error?: string; message?: string }) : undefined;
      } catch {
        errorBody = undefined;
      }
      if (response.status === 429 && errorBody?.message) {
        throw new Error(errorBody.message);
      }
      throw new Error(
        `Inline completion API returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`
      );
    }

    if (!response.body) {
      throw new Error("Inline completion API returned an empty stream.");
    }

    let full = "";
    let model = body.model;
    let provider = body.provider;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseSseJson(line);
        if (!event) {
          continue;
        }
        if (event.type === "delta" && typeof event.text === "string") {
          full += event.text;
          onChunk(event.text);
        } else if (event.type === "done") {
          if (typeof event.model === "string") {
            model = event.model;
          }
          if (typeof event.provider === "string") {
            provider = event.provider as LlmProvider;
          }
        } else if (event.type === "error") {
          throw new Error(typeof event.message === "string" ? event.message : "Inline stream error.");
        }
      }
      if (signal?.aborted) {
        break;
      }
    }

    return { text: full, alternatives: [], model, provider };
  }

  public async fetchInlineCompletion(
    baseUrl: string,
    body: InlineCompletionBody,
    signal?: AbortSignal
  ): Promise<InlineCompletionResult> {
    assertCoopEndpoint(baseUrl);
    const token = await this.options.getToken();
    if (!token) {
      throw new Error("CoopAI API key is missing. Configure it in the sidebar settings.");
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/completions/inline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-use-case": "code-completion-only"
      },
      body: JSON.stringify({
        message: body.message,
        segments: body.segments,
        stream: body.stream,
        repoId: body.repoId,
        useGraphContext: body.useGraphContext,
        languageId: body.languageId,
        file: body.file,
        provider: body.provider,
        model: body.model,
        maxTokens: body.maxTokens,
        temperature: body.temperature
      }),
      signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: { error?: string; message?: string } | undefined;
      try {
        body = text ? (JSON.parse(text) as { error?: string; message?: string }) : undefined;
      } catch {
        body = undefined;
      }
      if (response.status === 429 && body?.message) {
        throw new Error(body.message);
      }
      throw new Error(
        `Inline completion API returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      text: typeof data.text === "string" ? data.text : "",
      alternatives: Array.isArray(data.alternatives)
        ? data.alternatives.filter((value): value is string => typeof value === "string")
        : [],
      model: typeof data.model === "string" ? data.model : body.model,
      provider: typeof data.provider === "string" ? data.provider : body.provider
    };
  }

  public async recordUsageEvents(
    baseUrl: string,
    events: Array<{ eventType: string; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    assertCoopEndpoint(baseUrl);
    const token = await this.options.getToken();
    if (!token) {
      return;
    }
    await this.http.post(
      "/v1/usage/events",
      { events },
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        }
      }
    );
  }

  public async fetchIdentityDirectory(baseUrl: string): Promise<IdentityDirectory> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{ directory: IdentityDirectory }>("/v1/identity-directory", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders()
    });
    return response.data.directory;
  }

  public async saveIdentityDirectory(baseUrl: string, directory: IdentityDirectory): Promise<IdentityDirectory> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.put<{ directory: IdentityDirectory }>(
      "/v1/identity-directory",
      { directory },
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders()
      }
    );
    return response.data.directory;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.options.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

function parseSseJson(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return undefined;
  }
  const payload = trimmed.slice(5).trim();
  if (!payload) {
    return undefined;
  }
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

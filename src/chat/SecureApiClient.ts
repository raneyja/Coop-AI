import axios, { AxiosInstance } from "axios";
import * as vscode from "vscode";
import {
  DegradationConfig,
  UserNotificationLevel,
  mergeDegradationConfig
} from "../config/degradationConfig";
import { ConflictConfig, mergeConflictConfig, parseConflictSeverity } from "../config/conflictConfig";
import { IntentConfig, mergeIntentConfig } from "../config/intentConfig";
import { DEFAULT_MODEL_BY_PROVIDER } from "../config/llmModels";
import { CoopBackendClient } from "../api/CoopBackendClient";
import { clampSearchScopeModeForPlan } from "../license/licenseChecker";
import { resolveCoopBaseUrl, assertCoopEndpoint } from "../api/resolveBaseUrl";
import { isRetryableError, runResilientRequest, statusFromError } from "../api/networkResilience";
import { formatUserFacingNetworkError } from "../api/userFacingErrors";
import type { UseCase } from "../api/types";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import type {
  ChatMessage,
  RemoteTreeNode,
  RepoContext,
  UserPreferences,
  LlmProviderPreference,
  ChatImageAttachment,
  ChatFileMention,
  OrgCollectionSummary
} from "./types";
import { isCoopDevMode } from "../config/lightningConfig";
import { DEFAULT_TIMEZONE_ID } from "./timezone";
import { readCodeHostProvider } from "../config/codeHostConfig";
import type { CodeHostSecrets } from "../api/codeHosts/codeHostSecrets";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import { DEFAULT_API_BASE, SECRET_KEY_API_TOKEN } from "./types";

export type StreamChatParams = {
  message: string;
  context: RepoContext & { contextBundle?: unknown };
  history: ChatMessage[];
  attachments?: ChatImageAttachment[];
  mentions?: ChatFileMention[];
  model: string;
  provider: LlmProviderPreference;
  useCase: UseCase;
  temperature: number;
  maxTokens: number;
};

export class SecureApiClient {
  private http: AxiosInstance;
  private readonly backend: CoopBackendClient;

  public constructor(private readonly secrets: vscode.SecretStorage) {
    this.http = axios.create({ timeout: 60_000 });
    this.backend = new CoopBackendClient({
      getToken: () => this.getToken()
    });
  }

  public setBaseUrl(baseUrl: string): void {
    this.http = axios.create({ baseURL: baseUrl.replace(/\/$/, ""), timeout: 60_000 });
    this.backend.setBaseUrl(baseUrl);
  }

  public async setToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_API_TOKEN, token.trim());
  }

  public async clearToken(): Promise<void> {
    await this.secrets.delete(SECRET_KEY_API_TOKEN);
  }

  public async getToken(): Promise<string | undefined> {
    const token = await this.secrets.get(SECRET_KEY_API_TOKEN);
    return token?.trim() || undefined;
  }

  public async hasToken(): Promise<boolean> {
    return Boolean(await this.getToken());
  }

  public getBackendClient(): CoopBackendClient {
    return this.backend;
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
    await this.ensureToken();
    return this.backend.graphSearch(baseUrl, repoId, pattern, options);
  }

  public async listOrgRepos(baseUrl: string): Promise<Array<{ repoId: string; lightningEnabled?: boolean }>> {
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    const response = await this.backend.listOrgRepos(baseUrl);
    return (response.repos ?? []) as Array<{ repoId: string; lightningEnabled?: boolean }>;
  }

  public async listCatalogOrgRepos(
    baseUrl: string,
    options?: { query?: string }
  ): Promise<
    Array<{
      repoId: string;
      provider: string;
      owner: string;
      name: string;
      defaultBranch: string;
      lightningEnabled?: boolean;
      indexStatus?: string;
      workspaceSelected?: boolean;
    }>
  > {
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    const response = await this.backend.listCatalogOrgRepos(baseUrl, options);
    return response.repos ?? [];
  }

  public async listGithubOrgRepos(
    baseUrl: string,
    options?: { query?: string }
  ): Promise<
    Array<{
      repoId: string;
      owner: string;
      name: string;
      defaultBranch: string;
      isPrivate?: boolean;
      htmlUrl?: string;
      lightningEnabled?: boolean;
      indexStatus?: string;
      workspaceSelected?: boolean;
    }>
  > {
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    const response = await this.backend.listGithubOrgRepos(baseUrl, options);
    return response.repos ?? [];
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
    await this.ensureToken();
    return this.backend.getWorkspaceRepos(baseUrl);
  }

  public async setWorkspaceRepos(baseUrl: string, repoIds: string[]): Promise<void> {
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    await this.backend.setWorkspaceRepos(baseUrl, repoIds);
  }

  public async listWorkspaceRepoIds(baseUrl: string): Promise<string[]> {
    const state = await this.getWorkspaceRepos(baseUrl);
    return state.repos.map((repo) => repo.repoId);
  }

  public async listCollections(baseUrl: string): Promise<OrgCollectionSummary[]> {
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    const response = await this.backend.listCollections(baseUrl);
    return (response.collections ?? []).map((collection) => ({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      repoCount: collection.repos?.length ?? 0,
      repoIds: (collection.repos ?? []).map((repo) => repo.repoId)
    }));
  }

  public async fetchRepoManifest(baseUrl: string, repoId: string) {
    return this.backend.fetchRepoManifest(baseUrl, repoId);
  }

  public async syncGithubCredentialToCloud(baseUrl: string, token: string): Promise<void> {
    await this.backend.storeGithubCredential(baseUrl, token);
  }

  public async fetchMe(baseUrl: string) {
    return this.backend.fetchMe(baseUrl);
  }

  public async startPublicSamlLogin(
    baseUrl: string,
    options: { orgId?: string; org?: string; redirect?: string }
  ): Promise<string> {
    return this.backend.startPublicSamlLogin(baseUrl, options);
  }

  public async startSamlLogin(baseUrl: string, redirect?: string): Promise<string> {
    return this.backend.startSamlLogin(baseUrl, redirect);
  }

  public async getGithubAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getGithubAppInstallUrl(baseUrl);
  }

  public async getGithubInstallationStatus(
    baseUrl: string
  ): Promise<Awaited<ReturnType<CoopBackendClient["getGithubInstallationStatus"]>>> {
    return this.backend.getGithubInstallationStatus(baseUrl);
  }

  public async getGitlabAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getGitlabAppInstallUrl(baseUrl);
  }

  public async getGitlabInstallationStatus(baseUrl: string): Promise<{ installed: boolean }> {
    return this.backend.getGitlabInstallationStatus(baseUrl);
  }

  public async getBitbucketAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getBitbucketAppInstallUrl(baseUrl);
  }

  public async getBitbucketInstallationStatus(baseUrl: string): Promise<{ installed: boolean }> {
    return this.backend.getBitbucketInstallationStatus(baseUrl);
  }

  public async getSlackAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getSlackAppInstallUrl(baseUrl);
  }

  public async getAtlassianAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getAtlassianAppInstallUrl(baseUrl);
  }

  public async getNotionAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getNotionAppInstallUrl(baseUrl);
  }

  public async getGoogleDocsAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getGoogleDocsAppInstallUrl(baseUrl);
  }

  public async getTeamsAppInstallUrl(baseUrl: string): Promise<string> {
    return this.backend.getTeamsAppInstallUrl(baseUrl);
  }

  public async getSlackInstallationStatus(baseUrl: string): Promise<{ installed: boolean; teamName?: string }> {
    return this.backend.getSlackInstallationStatus(baseUrl);
  }

  public async getAtlassianInstallationStatus(
    baseUrl: string
  ): Promise<{ installed: boolean; siteName?: string; siteUrl?: string }> {
    return this.backend.getAtlassianInstallationStatus(baseUrl);
  }

  public async getNotionInstallationStatus(
    baseUrl: string
  ): Promise<{ installed: boolean; workspaceName?: string }> {
    return this.backend.getNotionInstallationStatus(baseUrl);
  }

  public async getGoogleDocsInstallationStatus(
    baseUrl: string
  ): Promise<{ installed: boolean; displayName?: string; email?: string }> {
    return this.backend.getGoogleDocsInstallationStatus(baseUrl);
  }

  public async getTeamsInstallationStatus(
    baseUrl: string
  ): Promise<{ installed: boolean; displayName?: string; email?: string }> {
    return this.backend.getTeamsInstallationStatus(baseUrl);
  }

  public async getIntegrationCredentials(
    baseUrl: string,
    provider: "slack" | "atlassian" | "notion" | "google-docs" | "teams"
  ): Promise<{
    accessToken: string;
    metadata: Record<string, string | undefined>;
  }> {
    const response = await this.backend.getIntegrationCredentials(baseUrl, provider);
    return { accessToken: response.accessToken, metadata: response.metadata };
  }

  public async getIntegrationScope(
    baseUrl: string,
    provider: "slack" | "atlassian" | "notion" | "google-docs" | "teams"
  ): Promise<import("../integrationScope/types").ResolvedIntegrationScope> {
    return this.backend.getIntegrationScope(baseUrl, provider);
  }

  public async fetchRepoFileViaCloud(
    baseUrl: string,
    repoId: string,
    path: string,
    branch?: string
  ): Promise<{
    path: string;
    content: string;
    encoding?: string;
    branch: string;
    truncated?: boolean;
  }> {
    return this.backend.fetchRepoFile(baseUrl, repoId, path, branch);
  }

  public async fetchRepoSearchViaCloud(
    baseUrl: string,
    repoId: string,
    query: string,
    branch?: string,
    limit = 30
  ): Promise<Array<{ path: string; name: string }>> {
    const result = await this.backend.fetchRepoSearch(baseUrl, repoId, query, branch, limit);
    return result.hits ?? [];
  }

  public async fetchRepoTreeViaCloud(
    baseUrl: string,
    repoId: string,
    path: string,
    branch?: string
  ): Promise<{
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
    const result = await this.backend.fetchRepoTree(baseUrl, repoId, path, branch);
    return {
      path: result.path,
      branch: result.branch,
      entries: result.entries
    };
  }

  public async fetchRepoBlameViaCloud(
    baseUrl: string,
    repoId: string,
    path: string,
    branch?: string
  ): Promise<import("../api/codeHosts/types").BlameData> {
    const result = await this.backend.fetchRepoBlame(baseUrl, repoId, path, branch);
    return result.blame;
  }

  public async fetchRepoHistoryViaCloud(
    baseUrl: string,
    repoId: string,
    path: string | undefined,
    options?: { branch?: string; limit?: number }
  ): Promise<import("../api/codeHosts/types").CommitInfo[]> {
    const result = await this.backend.fetchRepoHistory(baseUrl, repoId, path, options);
    return result.commits;
  }

  public async fetchRepoMetadataViaCloud(
    baseUrl: string,
    repoId: string,
    branch?: string
  ): Promise<import("../api/codeHosts/types").RemoteRepository> {
    const result = await this.backend.fetchRepoMetadata(baseUrl, repoId, branch);
    return result.repository;
  }

  public async fetchRepoPullsViaCloud(
    baseUrl: string,
    repoId: string,
    options?: { branch?: string; state?: string; limit?: number }
  ): Promise<import("../api/codeHosts/types").PullRequestSummary[]> {
    const result = await this.backend.fetchRepoPulls(baseUrl, repoId, options);
    return result.pulls;
  }

  public async fetchRepoIssuesViaCloud(
    baseUrl: string,
    repoId: string,
    options?: { branch?: string; state?: string; limit?: number }
  ): Promise<import("../api/codeHosts/types").IssueSummary[]> {
    const result = await this.backend.fetchRepoIssues(baseUrl, repoId, options);
    return result.issues;
  }

  public async fetchRepoPullReviewsViaCloud(
    baseUrl: string,
    repoId: string,
    prNumber: number,
    options?: { branch?: string }
  ): Promise<import("../api/codeHosts/types").PullRequestReview[]> {
    const result = await this.backend.fetchRepoPullReviews(baseUrl, repoId, prNumber, options);
    return result.reviews;
  }

  public async fetchRepoCommitViaCloud(
    baseUrl: string,
    repoId: string,
    sha: string,
    branch?: string
  ): Promise<import("../api/codeHosts/types").CommitInfo> {
    const result = await this.backend.fetchRepoCommit(baseUrl, repoId, sha, branch);
    return result.commit;
  }

  public async fetchRepoPullsForFileViaCloud(
    baseUrl: string,
    repoId: string,
    path: string,
    options?: { branch?: string; limit?: number }
  ): Promise<import("../api/codeHosts/types").PullRequestSummary[]> {
    const result = await this.backend.fetchRepoPullsForFile(baseUrl, repoId, path, options);
    return result.pulls;
  }

  public async fetchRepoPullCommentsViaCloud(
    baseUrl: string,
    repoId: string,
    prNumber: number,
    options?: { branch?: string; pullOwner?: string; pullRepo?: string }
  ): Promise<import("../api/codeHosts/types").PullRequestComment[]> {
    const result = await this.backend.fetchRepoPullComments(baseUrl, repoId, prNumber, options);
    return result.comments;
  }

  public async fetchRepoPullDetailViaCloud(
    baseUrl: string,
    repoId: string,
    prNumber: number,
    options?: { branch?: string; commitSha?: string }
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
    owner?: string;
    repo?: string;
    labels: string[];
  }> {
    const result = await this.backend.fetchRepoPullDetail(baseUrl, repoId, prNumber, options);
    return result.pull;
  }

  public async fetchRepoCommitPullsViaCloud(
    baseUrl: string,
    repoId: string,
    sha: string,
    branch?: string
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
    const result = await this.backend.fetchRepoCommitPulls(baseUrl, repoId, sha, branch);
    return result.pulls;
  }

  public async testConnection(baseUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      assertCoopEndpoint(baseUrl);
      await this.ensureToken();
      const health = await this.backend.health(baseUrl);
      if (!health.ok) {
        return { ok: false, message: "API health check failed." };
      }
      let orgLabel = "";
      try {
        const me = await this.backend.fetchMe(baseUrl);
        if (me.orgName) {
          orgLabel = ` Org: ${me.orgName}.`;
        }
      } catch {
        // Health succeeded; org lookup is optional for the test message.
      }
      const providers = health.llm?.configuredProviders?.join(", ") || "mock mode";
      const mock = health.llm?.mockMode ? " (mock)" : "";
      return { ok: true, message: `Connected.${orgLabel} LLM providers: ${providers}${mock}.` };
    } catch (error) {
      return { ok: false, message: formatUserFacingNetworkError(error, "Connection failed.") };
    }
  }

  public async streamChat(
    body: StreamChatParams,
    onChunk: (chunk: string) => void,
    baseUrl: string,
    signal?: AbortSignal
  ): Promise<{ message: ChatMessage; usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number; provider: string; model: string } }> {
    if (!readLlmConfiguration().llmEnabled) {
      throw new Error("LLM chat is disabled. Enable coopAI.llm.enabled in settings.");
    }

    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    this.setBaseUrl(baseUrl);

    const history = body.history
      .filter((entry): entry is ChatMessage & { role: "user" | "assistant" } =>
        entry.role === "user" || entry.role === "assistant"
      )
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
        attachments: entry.attachments
      }));

    const result = await this.backend.streamChat(
      baseUrl,
      {
        message: body.message,
        history,
        context: {
          owner: body.context.owner,
          repo: body.context.repo,
          branch: body.context.branch,
          file: body.context.file,
          selectedLines: body.context.selectedLines,
          languageId: body.context.languageId,
          contextBundle: body.context.contextBundle
        },
        attachments: body.attachments,
        mentions: body.mentions?.map((mention) => ({
          repoId: mention.repoId,
          path: mention.path,
          lines: mention.lines
        })),
        model: body.model,
        provider: body.provider as LlmProvider,
        useCase: body.useCase,
        temperature: body.temperature,
        maxTokens: body.maxTokens
      },
      onChunk,
      signal
    );

    const usage =
      result.usage?.type === "done"
        ? {
            inputTokens: result.usage.usage.inputTokens,
            outputTokens: result.usage.usage.outputTokens,
            estimatedCostUsd: result.usage.usage.estimatedCostUsd,
            provider: result.usage.provider,
            model: result.usage.model
          }
        : undefined;

    return {
      message: {
        role: "assistant",
        content: result.content,
        timestamp: Date.now()
      },
      usage
    };
  }

  /** @deprecated Use streamChat */
  public async streamClaudeReply(
    body: { message: string; context: RepoContext; history: ChatMessage[]; model: string },
    onChunk: (chunk: string) => void,
    baseUrl: string
  ): Promise<ChatMessage> {
    const llm = readLlmConfiguration();
    const result = await this.streamChat(
      {
        message: body.message,
        context: body.context,
        history: body.history,
        model: body.model || llm.model,
        provider: llm.llmProvider,
        useCase: "chat",
        temperature: llm.temperature,
        maxTokens: llm.maxTokens
      },
      onChunk,
      baseUrl
    );
    return result.message;
  }

  /** @deprecated Use CodeHostRouter.getRepositoryTree via CoopChatSession */
  public async listRemoteTree(
    path: string | undefined,
    _baseUrl: string,
    router?: CodeHostRouter
  ): Promise<RemoteTreeNode[]> {
    if (!router) {
      throw new Error("Remote tree requires CodeHostRouter. Configure a code host token in settings.");
    }
    const tree = await router.getRepositoryTree(path || "");
    return tree.entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      type: entry.type,
      size: entry.size,
      updatedAt: entry.lastModified
    }));
  }

  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  private async ensureToken(): Promise<void> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("CoopAI API key is missing. Configure it in the sidebar settings.");
    }
  }

  public async fetchInlineCompletion(
    baseUrl: string,
    body: import("../api/CoopBackendClient").InlineCompletionBody,
    signal?: AbortSignal
  ): Promise<import("../api/CoopBackendClient").InlineCompletionResult> {
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    this.setBaseUrl(baseUrl);
    return this.backend.fetchInlineCompletion(baseUrl, body, signal);
  }

  public async streamInlineCompletion(
    baseUrl: string,
    body: import("../api/CoopBackendClient").InlineCompletionBody,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<import("../api/CoopBackendClient").InlineCompletionResult> {
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    this.setBaseUrl(baseUrl);
    return this.backend.streamInlineCompletion(baseUrl, body, onChunk, signal);
  }

  public async recordUsageEvents(
    eventType: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const baseUrl = readConfiguration().apiBaseUrl;
    if (!baseUrl) {
      return;
    }
    assertCoopEndpoint(baseUrl);
    await this.ensureToken();
    this.setBaseUrl(baseUrl);
    await this.backend.recordUsageEvents(baseUrl, [{ eventType, metadata }]);
  }
}

export function readConfiguration(): Omit<
  UserPreferences,
  | "hasApiKey"
  | "hasGitHubToken"
  | "hasGitLabToken"
  | "hasBitbucketCredentials"
  | "hasSlackToken"
  | "hasSlackInstalled"
  | "hasAtlassianInstalled"
  | "hasJiraCredentials"
  | "hasTeamsInstalled"
  | "hasTeamsToken"
  | "hasConfluenceCredentials"
  | "hasNotionInstalled"
  | "hasNotionToken"
  | "hasGoogleDocsInstalled"
  | "hasGoogleDocsToken"
> {
  const config = vscode.workspace.getConfiguration("coopAI");
  const llmProvider = readProviderPreference(config.get<string>("llmProvider", "anthropic"));
  return {
    model: config.get<string>("defaultModel", DEFAULT_MODEL_BY_PROVIDER[llmProvider]),
    llmProvider,
    temperature: config.get<number>("temperature", 0.5),
    maxTokens: config.get<number>("maxTokens", 2000),
    llmEnabled: config.get<boolean>("llm.enabled", true),
    autocompleteEnabled: config.get<boolean>("autocomplete.enabled", false),
    useCachedResponses: config.get<boolean>("useCachedResponses", true),
    includeSelection: config.get<boolean>("includeSelection", true),
    includeActiveFile: config.get<boolean>("includeActiveFile", true),
    apiBaseUrl: resolveCoopBaseUrl(config).baseUrl,
    owner: config.get<string>("defaultOwner", ""),
    repo: config.get<string>("defaultRepo", ""),
    branch: config.get<string>("defaultBranch", ""),
    defaultCodeHost: readCodeHostProvider(config.get<string>("defaultCodeHost", "github")),
    gitlabBaseUrl: config.get<string>("gitlab.baseUrl", "https://gitlab.com/api/v4"),
    jiraBaseUrl: config.get<string>("jira.baseUrl", "https://your-domain.atlassian.net"),
    confluenceBaseUrl: config.get<string>("confluence.baseUrl", "https://your-domain.atlassian.net/wiki"),
    devMode: config.get<boolean>("devMode", false),
    searchScopeMode: config.get<import("./types").SearchScopeMode>("searchScope.mode", "repo"),
    searchCollectionId: config.get<string>("searchScope.collectionId", ""),
    timezone: config.get<string>("timezone", DEFAULT_TIMEZONE_ID),
    hasGitHubAppInstalled: false,
    hasGitLabAppInstalled: false,
    hasBitbucketAppInstalled: false
  };
}

export function readLlmConfiguration(): Pick<
  UserPreferences,
  "model" | "llmProvider" | "temperature" | "maxTokens" | "llmEnabled" | "autocompleteEnabled"
> {
  const config = readConfiguration();
  return {
    model: config.model,
    llmProvider: config.llmProvider,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    llmEnabled: config.llmEnabled,
    autocompleteEnabled: config.autocompleteEnabled
  };
}

function readProviderPreference(value: string): LlmProviderPreference {
  if (value === "openai" || value === "anthropic" || value === "deepseek" || value === "gemini") {
    return value;
  }
  return "anthropic";
}

export function readIntentConfiguration(): IntentConfig {
  const config = vscode.workspace.getConfiguration("coopAI.intent");
  return mergeIntentConfig({
    debounceRules: {
      fileSwitched: config.get<number>("debounce.fileSwitch"),
      selectionChange: config.get<number>("debounce.selectionChange"),
      editorOpened: config.get<number>("debounce.editorOpen")
    },
    batching: {
      enabled: config.get<boolean>("batching.enabled"),
      window: config.get<number>("batching.window"),
      maxRequests: config.get<number>("batching.maxRequests")
    },
    rateLimitAware: {
      expensiveThreshold: config.get<number>("rateLimit.expensiveThreshold"),
      cheapThreshold: config.get<number>("rateLimit.cheapThreshold"),
      fallbackToCache: config.get<boolean>("rateLimit.fallbackToCache")
    },
    prioritization: {
      enabled: config.get<boolean>("prioritization.enabled"),
      useQueueSystem: config.get<boolean>("prioritization.useQueueSystem")
    }
  });
}

export function readDegradationConfiguration(): DegradationConfig {
  const config = vscode.workspace.getConfiguration("coopAI.degradation");
  return mergeDegradationConfig({
    enableGracefulFallback: config.get<boolean>("enableGracefulFallback"),
    cacheRetentionDays: {
      fresh: config.get<number>("cacheRetention.fresh"),
      warm: config.get<number>("cacheRetention.warm"),
      stale: config.get<number>("cacheRetention.stale")
    },
    timeouts: {
      critical: config.get<number>("timeouts.critical"),
      normal: config.get<number>("timeouts.normal"),
      background: config.get<number>("timeouts.background")
    },
    notifyUser: config.get<boolean>("notifyUser"),
    userNotificationLevel: config.get<UserNotificationLevel>("userNotificationLevel")
  });
}

export function readConflictConfiguration(): ConflictConfig {
  const config = vscode.workspace.getConfiguration("coopAI.conflicts");
  return mergeConflictConfig({
    detectAndSurface: config.get<boolean>("detectAndSurface"),
    autoResolve: config.get<boolean>("autoResolve"),
    severityThreshold: parseConflictSeverity(config.get<string>("severityThreshold"), "medium"),
    trustOrder: {
      ownership: config.get<string[]>("trustOrder.ownership"),
      decision: config.get<string[]>("trustOrder.decision"),
      implementation: config.get<string[]>("trustOrder.implementation")
    },
    auditTrail: config.get<boolean>("auditTrail")
  });
}

export async function readPreferences(
  api: SecureApiClient,
  codeHostSecrets?: CodeHostSecrets,
  integrationSecrets?: IntegrationSecrets
): Promise<UserPreferences> {
  const base = readConfiguration();
  const codeHostCreds = codeHostSecrets ? await codeHostSecrets.getCredentials() : {};
  const integrationCreds = integrationSecrets ? await integrationSecrets.getCredentials() : {};
  const devMode = isCoopDevMode();
  let hasGitHubAppInstalled = false;
  let githubNeedsReconnect = false;
  let hasGitLabAppInstalled = false;
  let hasBitbucketAppInstalled = false;
  let hasSlackInstalled = false;
  let hasAtlassianInstalled = false;
  let hasNotionInstalled = false;
  let hasGoogleDocsInstalled = false;
  let hasTeamsInstalled = false;
  let slackTeamName: string | undefined;
  let atlassianSiteName: string | undefined;
  let notionWorkspaceName: string | undefined;
  let googleDocsDisplayName: string | undefined;
  let teamsDisplayName: string | undefined;
  let orgName: string | undefined;
  let plan: UserPreferences["plan"];
  let userRole: string | undefined;
  let authMethod: UserPreferences["authMethod"];
  let canInstallIntegrations = false;
  let onboardingCompleted = false;
  let adminPortalUrl: string | undefined;
  let integrationHealthSummary: UserPreferences["integrationHealthSummary"];
  let indexedRepoCount: number | undefined;
  let workspaceRepoCount: number | undefined;
  let workspaceRepoLimit: number | null | undefined;
  let canAddMoreWorkspaceRepos: boolean | undefined;
  let primaryWorkspaceRepoId: string | undefined;
  let workspaceRepoIds: string[] | undefined;
  let quotaCredits: UserPreferences["quotaCredits"];
  if (await api.hasToken()) {
    try {
      const me = await api.fetchMe(base.apiBaseUrl);
      orgName = me.orgName;
      plan = me.plan;
      userRole = me.role;
      authMethod = me.authMethod;
      canInstallIntegrations = me.canInstallIntegrations ?? false;
      onboardingCompleted = me.onboardingCompleted ?? false;
      adminPortalUrl = me.adminPortalUrl;
      integrationHealthSummary = me.integrationHealthSummary;
      indexedRepoCount = me.indexedRepoCount;
      workspaceRepoCount = me.workspaceRepoCount;
      workspaceRepoLimit = me.workspaceRepoLimit;
      canAddMoreWorkspaceRepos = me.canAddMoreWorkspaceRepos;
      primaryWorkspaceRepoId = me.primaryWorkspaceRepoId;
      quotaCredits = me.quota;
    } catch {
      // Non-fatal — other preference fields still load.
    }
    try {
      const workspace = await api.getWorkspaceRepos(base.apiBaseUrl);
      workspaceRepoIds = workspace.repos.map((repo) => repo.repoId);
      workspaceRepoCount = workspace.selectedCount;
      workspaceRepoLimit = workspace.limit;
      canAddMoreWorkspaceRepos = workspace.canAddMore;
      primaryWorkspaceRepoId = workspace.primaryRepoId;
    } catch {
      // Non-fatal.
    }
    try {
      const status = await api.getGithubInstallationStatus(base.apiBaseUrl);
      hasGitHubAppInstalled = status.installed && status.tokenValid !== false && !status.needsReconnect;
      githubNeedsReconnect = Boolean(status.installed && status.needsReconnect);
    } catch {
      hasGitHubAppInstalled = false;
      githubNeedsReconnect = false;
    }
    try {
      const status = await api.getGitlabInstallationStatus(base.apiBaseUrl);
      hasGitLabAppInstalled = status.installed;
    } catch {
      hasGitLabAppInstalled = false;
    }
    try {
      const status = await api.getBitbucketInstallationStatus(base.apiBaseUrl);
      hasBitbucketAppInstalled = status.installed;
    } catch {
      hasBitbucketAppInstalled = false;
    }
    try {
      const status = await api.getSlackInstallationStatus(base.apiBaseUrl);
      hasSlackInstalled = status.installed;
      slackTeamName = status.teamName;
    } catch {
      hasSlackInstalled = false;
    }
    try {
      const status = await api.getAtlassianInstallationStatus(base.apiBaseUrl);
      hasAtlassianInstalled = status.installed;
      atlassianSiteName = status.siteName;
    } catch {
      hasAtlassianInstalled = false;
    }
    try {
      const status = await api.getNotionInstallationStatus(base.apiBaseUrl);
      hasNotionInstalled = status.installed;
      notionWorkspaceName = status.workspaceName;
    } catch {
      hasNotionInstalled = false;
    }
    try {
      const status = await api.getGoogleDocsInstallationStatus(base.apiBaseUrl);
      hasGoogleDocsInstalled = status.installed;
      googleDocsDisplayName = status.displayName ?? status.email;
    } catch {
      hasGoogleDocsInstalled = false;
    }
    try {
      const status = await api.getTeamsInstallationStatus(base.apiBaseUrl);
      hasTeamsInstalled = status.installed;
      teamsDisplayName = status.displayName ?? status.email;
    } catch {
      hasTeamsInstalled = false;
    }
  }
  const hasSlackToken = devMode
    ? Boolean(integrationCreds.slackToken)
    : hasSlackInstalled || Boolean(integrationCreds.slackToken);
  const hasJiraCredentials = devMode
    ? Boolean(integrationCreds.jiraEmail && integrationCreds.jiraToken)
    : hasAtlassianInstalled || Boolean(integrationCreds.jiraEmail && integrationCreds.jiraToken);
  const hasConfluenceCredentials = devMode
    ? Boolean(integrationCreds.confluenceEmail && integrationCreds.confluenceToken)
    : hasAtlassianInstalled ||
      Boolean(integrationCreds.confluenceEmail && integrationCreds.confluenceToken);
  return {
    ...base,
    searchScopeMode: resolveDefaultSearchScope(
      base.searchScopeMode,
      plan,
      workspaceRepoCount ?? indexedRepoCount
    ),
    hasApiKey: await api.hasToken(),
    hasGitHubToken: Boolean(codeHostCreds.githubToken),
    hasGitHubAppInstalled,
    githubNeedsReconnect,
    devMode,
    orgName,
    plan,
    userRole,
    authMethod,
    canInstallIntegrations,
    onboardingCompleted,
    adminPortalUrl,
    integrationHealthSummary,
    hasGitLabToken: Boolean(codeHostCreds.gitlabToken),
    hasGitLabAppInstalled,
    hasBitbucketCredentials: Boolean(
      codeHostCreds.bitbucketUsername && codeHostCreds.bitbucketAppPassword
    ),
    hasBitbucketAppInstalled,
    hasSlackToken,
    hasSlackInstalled,
    slackTeamName,
    hasAtlassianInstalled,
    atlassianSiteName,
    hasJiraCredentials,
    hasTeamsInstalled,
    teamsDisplayName,
    hasTeamsToken: devMode
      ? Boolean(integrationCreds.teamsToken)
      : hasTeamsInstalled || Boolean(integrationCreds.teamsToken),
    hasConfluenceCredentials,
    hasNotionInstalled,
    notionWorkspaceName,
    hasNotionToken: devMode
      ? Boolean(integrationCreds.notionToken)
      : hasNotionInstalled || Boolean(integrationCreds.notionToken),
    hasGoogleDocsInstalled,
    googleDocsDisplayName,
    hasGoogleDocsToken: devMode
      ? Boolean(integrationCreds.googleDocsToken)
      : hasGoogleDocsInstalled || Boolean(integrationCreds.googleDocsToken),
    jiraBaseUrl: integrationCreds.jiraBaseUrl ?? base.jiraBaseUrl,
    confluenceBaseUrl: integrationCreds.confluenceBaseUrl ?? base.confluenceBaseUrl,
    workspaceRepoIds,
    workspaceRepoCount,
    workspaceRepoLimit,
    canAddMoreWorkspaceRepos,
    primaryWorkspaceRepoId,
    quotaCredits
  };
}

export async function updateConfiguration(updates: Partial<UserPreferences>): Promise<void> {
  const config = vscode.workspace.getConfiguration("coopAI");
  const ops: Array<[string, string | boolean | number]> = [];
  if (updates.model !== undefined) {
    ops.push(["defaultModel", updates.model]);
  }
  if (updates.llmProvider !== undefined) {
    ops.push(["llmProvider", updates.llmProvider]);
  }
  if (updates.temperature !== undefined) {
    ops.push(["temperature", updates.temperature]);
  }
  if (updates.maxTokens !== undefined) {
    ops.push(["maxTokens", updates.maxTokens]);
  }
  if (updates.llmEnabled !== undefined) {
    ops.push(["llm.enabled", updates.llmEnabled]);
  }
  if (updates.autocompleteEnabled !== undefined) {
    ops.push(["autocomplete.enabled", updates.autocompleteEnabled]);
  }
  if (updates.useCachedResponses !== undefined) {
    ops.push(["useCachedResponses", updates.useCachedResponses]);
  }
  if (updates.includeSelection !== undefined) {
    ops.push(["includeSelection", updates.includeSelection]);
  }
  if (updates.includeActiveFile !== undefined) {
    ops.push(["includeActiveFile", updates.includeActiveFile]);
  }
  if (updates.apiBaseUrl !== undefined) {
    ops.push(["apiBaseUrl", updates.apiBaseUrl]);
  }
  if (updates.owner !== undefined) {
    ops.push(["defaultOwner", updates.owner]);
  }
  if (updates.repo !== undefined) {
    ops.push(["defaultRepo", updates.repo]);
  }
  if (updates.branch !== undefined) {
    ops.push(["defaultBranch", updates.branch]);
  }
  if (updates.defaultCodeHost !== undefined) {
    ops.push(["defaultCodeHost", updates.defaultCodeHost]);
  }
  if (updates.gitlabBaseUrl !== undefined) {
    ops.push(["gitlab.baseUrl", updates.gitlabBaseUrl]);
  }
  if (updates.jiraBaseUrl !== undefined) {
    ops.push(["jira.baseUrl", updates.jiraBaseUrl]);
  }
  if (updates.confluenceBaseUrl !== undefined) {
    ops.push(["confluence.baseUrl", updates.confluenceBaseUrl]);
  }
  if (updates.searchScopeMode !== undefined) {
    ops.push(["searchScope.mode", updates.searchScopeMode]);
  }
  if (updates.searchCollectionId !== undefined) {
    ops.push(["searchScope.collectionId", updates.searchCollectionId]);
  }
  if (updates.timezone !== undefined) {
    ops.push(["timezone", updates.timezone]);
  }
  for (const [key, value] of ops) {
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
}

function resolveDefaultSearchScope(
  current: import("./types").SearchScopeMode,
  plan: UserPreferences["plan"] | undefined,
  indexedRepoCount: number | undefined
): import("./types").SearchScopeMode {
  const clamped = clampSearchScopeModeForPlan(current, plan);
  if (clamped !== "repo") {
    return clamped;
  }
  if (plan === "enterprise") {
    return "org";
  }
  if ((plan === "pro" || plan === "free") && (indexedRepoCount ?? 0) > 1) {
    return "indexed";
  }
  return clamped;
}

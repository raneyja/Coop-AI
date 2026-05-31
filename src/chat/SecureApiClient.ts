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
import { resolveCoopBaseUrl, assertCoopEndpoint } from "../api/resolveBaseUrl";
import { isRetryableError, runResilientRequest, statusFromError } from "../api/networkResilience";
import { formatUserFacingNetworkError } from "../api/userFacingErrors";
import type { UseCase } from "../api/types";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import type { ChatMessage, RemoteTreeNode, RepoContext, UserPreferences, LlmProviderPreference, ChatImageAttachment } from "./types";
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

  public async testConnection(baseUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      assertCoopEndpoint(baseUrl);
      await this.ensureToken();
      const health = await this.backend.health(baseUrl);
      if (!health.ok) {
        return { ok: false, message: "API health check failed." };
      }
      const providers = health.llm?.configuredProviders?.join(", ") || "mock mode";
      const mock = health.llm?.mockMode ? " (mock)" : "";
      return { ok: true, message: `Connected. LLM providers: ${providers}${mock}.` };
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
}

export function readConfiguration(): Omit<
  UserPreferences,
  | "hasApiKey"
  | "hasGitHubToken"
  | "hasGitLabToken"
  | "hasBitbucketCredentials"
  | "hasSlackToken"
  | "hasJiraCredentials"
  | "hasTeamsToken"
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
    jiraBaseUrl: config.get<string>("jira.baseUrl", "https://your-domain.atlassian.net")
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
    healthCheckInterval: config.get<number>("healthCheckInterval"),
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
  return {
    ...base,
    hasApiKey: await api.hasToken(),
    hasGitHubToken: Boolean(codeHostCreds.githubToken),
    hasGitLabToken: Boolean(codeHostCreds.gitlabToken),
    hasBitbucketCredentials: Boolean(
      codeHostCreds.bitbucketUsername && codeHostCreds.bitbucketAppPassword
    ),
    hasSlackToken: Boolean(integrationCreds.slackToken),
    hasJiraCredentials: Boolean(integrationCreds.jiraEmail && integrationCreds.jiraToken),
    hasTeamsToken: Boolean(integrationCreds.teamsToken),
    jiraBaseUrl: integrationCreds.jiraBaseUrl ?? base.jiraBaseUrl
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
  for (const [key, value] of ops) {
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
}

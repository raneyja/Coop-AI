import axios, { AxiosInstance } from "axios";
import { assertCoopEndpoint } from "./resolveBaseUrl";
import { isRetryableError, runResilientRequest } from "./networkResilience";
import { formatCoopApiError, type CoopApiErrorBody } from "./userFacingErrors";
import type { ChatHistoryMessage, ChatContextPayload, StreamChunk, UseCase, ChatImageAttachment } from "./types";
import type { LlmProvider } from "./zeroRetentionConfig";

export type StreamChatBody = {
  message: string;
  history: ChatHistoryMessage[];
  context?: ChatContextPayload;
  attachments?: ChatImageAttachment[];
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
  message: string;
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
    pattern: string
  ): Promise<unknown> {
    assertCoopEndpoint(baseUrl);
    const encodedRepo = encodeURIComponent(repoId);
    const response = await runResilientRequest({
      timeoutMs: 15_000,
      shouldRetryError: isRetryableError,
      run: async () =>
        this.http.get(`/graph/${encodedRepo}/search`, {
          baseURL: baseUrl.replace(/\/$/, ""),
          params: { pattern },
          headers: await this.authHeaders()
        })
    });
    return response.data;
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
  ): Promise<{ installed: boolean; installationId?: number; tokenExpiresAt?: string }> {
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
  ): Promise<{ installed: boolean; installationId?: number; tokenExpiresAt?: string }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{
      installed: boolean;
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

  /** Fetches file content via server-side GitHub App token (Zero-Clone cloud path). */
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

  public async listOrgRepos(baseUrl: string): Promise<{ repos: unknown[] }> {
    assertCoopEndpoint(baseUrl);
    const response = await this.http.get<{ repos: unknown[] }>("/v1/orgs/repos", {
      baseURL: baseUrl.replace(/\/$/, ""),
      headers: await this.authHeaders()
    });
    return response.data ?? { repos: [] };
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
    const response = await this.http.post<{ jobId?: string; status?: string }>(
      `/v1/orgs/repos/${encoded}/lightning/enable`,
      {},
      {
        baseURL: baseUrl.replace(/\/$/, ""),
        headers: await this.authHeaders()
      }
    );
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

import { randomUUID } from "crypto";
import type { ChatRequestMessage } from "./requestFormatter";
import { requireEnterpriseApprovedProvider } from "./zeroRetentionConfig";
import type { LlmProvider } from "./zeroRetentionConfig";
import { estimateCostUsd, estimateTokensFromText } from "./costEstimate";
import type { CompletionRequest, CompletionResponse, LlmAuditEvent, StreamChunk } from "./types";
import { configuredProviders, loadLlmServerConfig, resolveProviderApiKey, type LlmServerConfig } from "./llmServerConfig";
import { createProviderClient, createFimClient } from "./providers";
import { selectFimProvider } from "./fimRouter";
import { buildUserMessageWithContext, buildProjectInstructionsSystemBlock, systemPromptForUseCase } from "../prompts/systemPrompts";
import { appendUserPaperclipAttachmentsPrompt } from "../chat/paperclipAttachments";
import { ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT } from "./requestFormatter";

function buildChatSystemContent(request: CompletionRequest, overridePrompt?: string): string {
  if (overridePrompt) {
    return `${ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT}\n\n${overridePrompt}`;
  }
  const basePrompt = systemPromptForUseCase(request.useCase, {
    activeFile: request.context?.file
  });
  const instructionsBlock =
    request.useCase !== "inline_completion"
      ? buildProjectInstructionsSystemBlock((request.context?.projectInstructions?.length ?? 0) > 0)
      : "";
  return `${ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT}\n\n${basePrompt}${instructionsBlock}`;
}

export type ModelRouterOptions = {
  config?: LlmServerConfig;
  onAudit?: (event: LlmAuditEvent) => void;
};

export class ModelRouter {
  private readonly config: LlmServerConfig;

  public constructor(private readonly options: ModelRouterOptions = {}) {
    this.config = options.config ?? loadLlmServerConfig();
  }

  public getConfiguredProviders(): LlmProvider[] {
    return configuredProviders(this.config);
  }

  public isMockMode(): boolean {
    return this.config.mockMode || this.getConfiguredProviders().length === 0;
  }

  public async *stream(request: CompletionRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const started = Date.now();
    const provider = this.resolveProvider(request);
    const userContent = appendUserPaperclipAttachmentsPrompt(
      buildUserMessageWithContext(request.message, request.context),
      request.attachments
    );

    const messages: ChatRequestMessage[] = [
      {
        role: "system",
        content: buildChatSystemContent(request)
      },
      ...request.history.map((entry) => ({
        role: entry.role,
        content: appendUserPaperclipAttachmentsPrompt(entry.content, entry.attachments),
        attachments: entry.attachments
      })),
      { role: "user", content: userContent, attachments: request.attachments }
    ];

    if (this.isMockMode()) {
      yield* this.mockStream(request, userContent, provider, signal);
      this.audit(request, provider, started, "ok", estimateTokensFromText(userContent), estimateTokensFromText(""));
      return;
    }

    if (!request.allowUnapprovedProvider) {
      try {
        requireEnterpriseApprovedProvider(provider);
      } catch (error) {
        yield {
          type: "error",
          message: error instanceof Error ? error.message : "Provider not approved for enterprise use."
        };
        this.audit(request, provider, started, "error", 0, 0, "ProviderNotApproved");
        return;
      }
    }

    const apiKey = resolveProviderApiKey(this.config, provider);
    if (!apiKey) {
      yield { type: "error", message: `No API key configured for provider ${provider}.` };
      this.audit(request, provider, started, "error", 0, 0, "MissingApiKey");
      return;
    }

    const client = createProviderClient(provider, { apiKey });
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const chunk of client.streamCompletion({
        messages,
        model: request.modelConfig.model,
        temperature: request.modelConfig.temperature,
        maxTokens: request.modelConfig.maxTokens,
        signal,
        requestId: request.requestId
      })) {
        if (chunk.type === "done") {
          inputTokens = chunk.usage.inputTokens;
          outputTokens = chunk.usage.outputTokens;
        }
        yield chunk;
        if (chunk.type === "error") {
          this.audit(request, provider, started, "error", inputTokens, outputTokens, "ProviderError");
          return;
        }
      }
      this.audit(request, provider, started, "ok", inputTokens, outputTokens);
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : "Stream failed." };
      this.audit(request, provider, started, "error", inputTokens, outputTokens, "StreamException");
    }
  }

  public async completeInline(
    request: CompletionRequest,
    extraSystemPrompt?: string,
    signal?: AbortSignal
  ): Promise<CompletionResponse> {
    const route = selectFimProvider(this.config, {
      segments: request.segments,
      requestedProvider: request.modelConfig.provider,
      requestedModel: request.modelConfig.model
    });

    if (route.mode === "fim" && request.segments) {
      return this.completeFim(request, route, signal);
    }

    const chatRoute =
      route.mode === "chat-fallback"
        ? route
        : {
            mode: "chat-fallback" as const,
            provider: request.modelConfig.provider,
            model: request.modelConfig.model
          };
    return this.completeInlineChat(request, extraSystemPrompt, signal, chatRoute);
  }

  public async *streamInline(
    request: CompletionRequest,
    extraSystemPrompt?: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const route = selectFimProvider(this.config, {
      segments: request.segments,
      requestedProvider: request.modelConfig.provider,
      requestedModel: request.modelConfig.model
    });

    if (route.mode === "fim" && request.segments) {
      yield* this.streamFim(request, route, signal);
      return;
    }

    const chatRoute =
      route.mode === "chat-fallback"
        ? route
        : {
            mode: "chat-fallback" as const,
            provider: request.modelConfig.provider,
            model: request.modelConfig.model
          };
    yield* this.streamInlineChat(request, extraSystemPrompt, signal, chatRoute);
  }

  private async completeFim(
    request: CompletionRequest,
    route: { mode: "fim"; provider: "mistral" | "deepseek"; model: string },
    signal?: AbortSignal
  ): Promise<CompletionResponse> {
    const started = Date.now();
    const segments = request.segments!;
    const provider = route.provider;

    if (this.isMockMode()) {
      const mockText = suggestMockFimCompletion(segments.prefix, segments.suffix);
      const inputTokens = estimateTokensFromText(segments.prefix + segments.suffix);
      const outputTokens = estimateTokensFromText(mockText);
      this.audit(request, provider, started, "ok", inputTokens, outputTokens);
      return {
        text: mockText,
        usage: {
          inputTokens,
          outputTokens,
          estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
        },
        model: route.model,
        provider,
        finishReason: "stop"
      };
    }

    if (!request.allowUnapprovedProvider && provider === "deepseek") {
      try {
        requireEnterpriseApprovedProvider(provider);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Provider not approved.");
      }
    }

    const apiKey = resolveProviderApiKey(this.config, provider);
    if (!apiKey) {
      throw new Error(`No API key configured for provider ${provider}.`);
    }

    const client = createFimClient(provider, { apiKey });
    let text = "";
    let usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
    let finishReason: CompletionResponse["finishReason"] = "stop";

    for await (const chunk of client.streamFim({
      prefix: segments.prefix,
      suffix: segments.suffix,
      model: route.model,
      temperature: request.modelConfig.temperature,
      maxTokens: request.modelConfig.maxTokens,
      signal,
      requestId: request.requestId
    })) {
      if (chunk.type === "delta") {
        text += chunk.text;
      } else if (chunk.type === "done") {
        usage = chunk.usage;
        finishReason = chunk.finishReason;
      } else if (chunk.type === "error") {
        this.audit(request, provider, started, "error", 0, 0, "ProviderError");
        throw new Error(chunk.message);
      }
      if (signal?.aborted) {
        finishReason = "cancelled";
        break;
      }
    }

    text = stripInlineFences(text);
    this.audit(request, provider, started, "ok", usage.inputTokens, usage.outputTokens);
    return {
      text,
      usage,
      model: route.model,
      provider,
      finishReason
    };
  }

  private async *streamFim(
    request: CompletionRequest,
    route: { mode: "fim"; provider: "mistral" | "deepseek"; model: string },
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const started = Date.now();
    const segments = request.segments!;
    const provider = route.provider;

    if (this.isMockMode()) {
      yield* this.mockFimStream(request, segments, provider, route.model, signal);
      return;
    }

    if (!request.allowUnapprovedProvider && provider === "deepseek") {
      try {
        requireEnterpriseApprovedProvider(provider);
      } catch (error) {
        yield {
          type: "error",
          message: error instanceof Error ? error.message : "Provider not approved for enterprise use."
        };
        this.audit(request, provider, started, "error", 0, 0, "ProviderNotApproved");
        return;
      }
    }

    const apiKey = resolveProviderApiKey(this.config, provider);
    if (!apiKey) {
      yield { type: "error", message: `No API key configured for provider ${provider}.` };
      this.audit(request, provider, started, "error", 0, 0, "MissingApiKey");
      return;
    }

    const client = createFimClient(provider, { apiKey });
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const chunk of client.streamFim({
        prefix: segments.prefix,
        suffix: segments.suffix,
        model: route.model,
        temperature: request.modelConfig.temperature,
        maxTokens: request.modelConfig.maxTokens,
        signal,
        requestId: request.requestId
      })) {
        if (chunk.type === "done") {
          inputTokens = chunk.usage.inputTokens;
          outputTokens = chunk.usage.outputTokens;
        }
        yield chunk;
        if (chunk.type === "error") {
          this.audit(request, provider, started, "error", inputTokens, outputTokens, "ProviderError");
          return;
        }
      }
      this.audit(request, provider, started, "ok", inputTokens, outputTokens);
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : "FIM stream failed." };
      this.audit(request, provider, started, "error", inputTokens, outputTokens, "StreamException");
    }
  }

  private async completeInlineChat(
    request: CompletionRequest,
    extraSystemPrompt: string | undefined,
    signal: AbortSignal | undefined,
    route: { mode: "chat-fallback"; provider: LlmProvider; model: string }
  ): Promise<CompletionResponse> {
    const started = Date.now();
    const provider = route.provider;
    const userContent = buildUserMessageWithContext(request.message, request.context);
    const systemContent = extraSystemPrompt
      ? buildChatSystemContent(request, extraSystemPrompt)
      : buildChatSystemContent(request);

    const messages: ChatRequestMessage[] = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent }
    ];

    if (this.isMockMode()) {
      const mockText = suggestMockCompletion(request.message);
      const inputTokens = estimateTokensFromText(userContent);
      const outputTokens = estimateTokensFromText(mockText);
      this.audit(request, provider, started, "ok", inputTokens, outputTokens);
      return {
        text: mockText,
        usage: {
          inputTokens,
          outputTokens,
          estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
        },
        model: route.model,
        provider,
        finishReason: "stop"
      };
    }

    if (!request.allowUnapprovedProvider) {
      try {
        requireEnterpriseApprovedProvider(provider);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Provider not approved.");
      }
    }

    const apiKey = resolveProviderApiKey(this.config, provider);
    if (!apiKey) {
      throw new Error(`No API key configured for provider ${provider}.`);
    }

    const client = createProviderClient(provider, { apiKey });
    let text = "";
    let usage = {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0
    };
    let finishReason: CompletionResponse["finishReason"] = "stop";

    for await (const chunk of client.streamCompletion({
      messages,
      model: route.model,
      temperature: request.modelConfig.temperature,
      maxTokens: request.modelConfig.maxTokens,
      signal,
      requestId: request.requestId
    })) {
      if (chunk.type === "delta") {
        text += chunk.text;
      } else if (chunk.type === "done") {
        usage = chunk.usage;
        finishReason = chunk.finishReason;
      } else if (chunk.type === "error") {
        this.audit(request, provider, started, "error", 0, 0, "ProviderError");
        throw new Error(chunk.message);
      }
      if (signal?.aborted) {
        finishReason = "cancelled";
        break;
      }
    }

    text = stripInlineFences(text);
    this.audit(request, provider, started, "ok", usage.inputTokens, usage.outputTokens);
    return {
      text,
      usage,
      model: route.model,
      provider,
      finishReason
    };
  }

  private async *streamInlineChat(
    request: CompletionRequest,
    extraSystemPrompt: string | undefined,
    signal: AbortSignal | undefined,
    route: { mode: "chat-fallback"; provider: LlmProvider; model: string }
  ): AsyncGenerator<StreamChunk> {
    const started = Date.now();
    const provider = route.provider;
    const userContent = buildUserMessageWithContext(request.message, request.context);
    const systemContent = extraSystemPrompt
      ? buildChatSystemContent(request, extraSystemPrompt)
      : buildChatSystemContent(request);

    const messages: ChatRequestMessage[] = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent }
    ];

    if (this.isMockMode()) {
      yield* this.mockInlineStream(request, userContent, provider, route.model, signal);
      return;
    }

    if (!request.allowUnapprovedProvider) {
      try {
        requireEnterpriseApprovedProvider(provider);
      } catch (error) {
        yield {
          type: "error",
          message: error instanceof Error ? error.message : "Provider not approved for enterprise use."
        };
        this.audit(request, provider, started, "error", 0, 0, "ProviderNotApproved");
        return;
      }
    }

    const apiKey = resolveProviderApiKey(this.config, provider);
    if (!apiKey) {
      yield { type: "error", message: `No API key configured for provider ${provider}.` };
      this.audit(request, provider, started, "error", 0, 0, "MissingApiKey");
      return;
    }

    const client = createProviderClient(provider, { apiKey });
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const chunk of client.streamCompletion({
        messages,
        model: route.model,
        temperature: request.modelConfig.temperature,
        maxTokens: request.modelConfig.maxTokens,
        signal,
        requestId: request.requestId
      })) {
        if (chunk.type === "done") {
          inputTokens = chunk.usage.inputTokens;
          outputTokens = chunk.usage.outputTokens;
        }
        yield chunk;
        if (chunk.type === "error") {
          this.audit(request, provider, started, "error", inputTokens, outputTokens, "ProviderError");
          return;
        }
      }
      this.audit(request, provider, started, "ok", inputTokens, outputTokens);
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : "Inline stream failed." };
      this.audit(request, provider, started, "error", inputTokens, outputTokens, "StreamException");
    }
  }

  private resolveProvider(request: CompletionRequest): LlmProvider {
    return request.modelConfig.provider ?? this.config.defaultProvider;
  }

  private async *mockInlineStream(
    request: CompletionRequest,
    userContent: string,
    provider: LlmProvider,
    model: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const mockText = suggestMockCompletion(request.message);
    for (const word of mockText.split(/(\s+)/).filter(Boolean)) {
      if (signal?.aborted) {
        yield {
          type: "done",
          usage: {
            inputTokens: estimateTokensFromText(userContent),
            outputTokens: 0,
            estimatedCostUsd: 0
          },
          model,
          provider,
          finishReason: "cancelled"
        };
        return;
      }
      yield { type: "delta", text: word };
      await delay(10);
    }
    const inputTokens = estimateTokensFromText(userContent);
    const outputTokens = estimateTokensFromText(mockText);
    yield {
      type: "done",
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
      },
      model,
      provider,
      finishReason: "stop"
    };
  }

  private async *mockFimStream(
    request: CompletionRequest,
    segments: { prefix: string; suffix: string },
    provider: LlmProvider,
    model: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const mockText = suggestMockFimCompletion(segments.prefix, segments.suffix);
    for (const part of mockText.split(/(?=[();])/).filter(Boolean)) {
      if (signal?.aborted) {
        yield {
          type: "done",
          usage: {
            inputTokens: estimateTokensFromText(segments.prefix + segments.suffix),
            outputTokens: 0,
            estimatedCostUsd: 0
          },
          model,
          provider,
          finishReason: "cancelled"
        };
        return;
      }
      yield { type: "delta", text: part };
      await delay(10);
    }
    const inputTokens = estimateTokensFromText(segments.prefix + segments.suffix);
    const outputTokens = estimateTokensFromText(mockText);
    yield {
      type: "done",
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
      },
      model,
      provider,
      finishReason: "stop"
    };
  }

  private async *mockStream(
    request: CompletionRequest,
    userContent: string,
    provider: LlmProvider,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const intro = `[CoopAI mock ${provider}/${request.modelConfig.model}] `;
    const body = `Received: ${request.message.slice(0, 120)}${request.message.length > 120 ? "…" : ""}`;
    const full = intro + body;
    for (const word of full.split(/\s+/)) {
      if (signal?.aborted) {
        yield {
          type: "done",
          usage: {
            inputTokens: estimateTokensFromText(userContent),
            outputTokens: 0,
            estimatedCostUsd: 0
          },
          model: request.modelConfig.model,
          provider,
          finishReason: "cancelled"
        };
        return;
      }
      yield { type: "delta", text: `${word} ` };
      await delay(25);
    }
    const inputTokens = estimateTokensFromText(userContent);
    const outputTokens = estimateTokensFromText(full);
    yield {
      type: "done",
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
      },
      model: request.modelConfig.model,
      provider,
      finishReason: "stop"
    };
  }

  private audit(
    request: CompletionRequest,
    provider: LlmProvider,
    started: number,
    status: "ok" | "error",
    inputTokens: number,
    outputTokens: number,
    errorClass?: string
  ): void {
    const event: LlmAuditEvent = {
      requestId: request.requestId,
      orgId: request.orgId,
      plan: request.plan,
      provider,
      model: request.modelConfig.model,
      useCase: request.useCase,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      status,
      errorClass
    };
    this.options.onAudit?.(event);
    if (process.env.COOP_LLM_DEBUG === "true") {
      console.info("[coop-llm-audit]", JSON.stringify(event));
    }
  }
}

export function createRequestId(): string {
  return randomUUID();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripInlineFences(text: string): string {
  return text
    .replace(/^```[\w]*\n?/gm, "")
    .replace(/```$/gm, "")
    .trim();
}

function suggestMockFimCompletion(prefix: string, suffix: string): string {
  if (prefix.trim().endsWith(".")) {
    return "then((value) => value)";
  }
  if (prefix.includes("const ")) {
    return " = undefined;";
  }
  if (suffix.trim().startsWith(")")) {
    return "value";
  }
  return "();";
}

function suggestMockCompletion(message: string): string {
  const lineMatch = /CURRENT LINE:\n(.*?)█/s.exec(message);
  const prefix = lineMatch?.[1] ?? "";
  if (prefix.trim().endsWith(".")) {
    return "then((value) => value)";
  }
  if (prefix.includes("const ")) {
    return " = undefined;";
  }
  return "();";
}

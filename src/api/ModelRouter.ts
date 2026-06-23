import { randomUUID } from "crypto";
import type { ChatRequestMessage } from "./requestFormatter";
import { requireEnterpriseApprovedProvider } from "./zeroRetentionConfig";
import type { LlmProvider } from "./zeroRetentionConfig";
import { estimateCostUsd, estimateTokensFromText } from "./costEstimate";
import type { CompletionRequest, CompletionResponse, LlmAuditEvent, StreamChunk } from "./types";
import { configuredProviders, loadLlmServerConfig, resolveProviderApiKey, type LlmServerConfig } from "./llmServerConfig";
import { createProviderClient } from "./providers";
import { buildUserMessageWithContext, systemPromptForUseCase } from "../prompts/systemPrompts";
import { appendUserImageAttachmentsPrompt } from "../prompts/userImageAttachments";
import { ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT } from "./requestFormatter";

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
    const userContent = appendUserImageAttachmentsPrompt(
      buildUserMessageWithContext(request.message, request.context),
      request.attachments
    );

    const messages: ChatRequestMessage[] = [
      {
        role: "system",
        content: `${ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT}\n\n${systemPromptForUseCase(request.useCase)}`
      },
      ...request.history.map((entry) => ({
        role: entry.role,
        content: appendUserImageAttachmentsPrompt(entry.content, entry.attachments),
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
    const started = Date.now();
    const provider = this.resolveProvider(request);
    const userContent = buildUserMessageWithContext(request.message, request.context);
    const systemContent = extraSystemPrompt
      ? `${ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT}\n\n${extraSystemPrompt}`
      : `${ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT}\n\n${systemPromptForUseCase(request.useCase)}`;

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
        model: request.modelConfig.model,
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
      model: request.modelConfig.model,
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
      model: request.modelConfig.model,
      provider,
      finishReason
    };
  }

  private resolveProvider(request: CompletionRequest): LlmProvider {
    return request.modelConfig.provider ?? this.config.defaultProvider;
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

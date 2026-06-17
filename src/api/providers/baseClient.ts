import { estimateCostUsd, estimateTokensFromText } from "../costEstimate";
import { formatZeroRetentionRequest } from "../requestFormatter";
import type { ChatRequestMessage } from "../requestFormatter";
import { NetworkResilienceError, runResilientRequest } from "../networkResilience";
import type { FinishReason, ProviderStreamOptions, StreamChunk, TokenUsage } from "../types";
import type { LlmProvider } from "../zeroRetentionConfig";
import { assertStandardInferenceEndpoint, getZeroRetentionConfig } from "../zeroRetentionConfig";

export type ProviderClientOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export abstract class BaseProviderClient {
  protected readonly fetchImpl: typeof fetch;

  public constructor(
    protected readonly provider: LlmProvider,
    protected readonly options: ProviderClientOptions
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public abstract streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk>;

  protected async *streamFromEndpoint(
    url: string,
    init: RequestInit,
    options: ProviderStreamOptions,
    parseLine: (line: string, state: ParseState) => StreamChunk | undefined
  ): AsyncGenerator<StreamChunk> {
    assertStandardInferenceEndpoint(this.provider, url);
    let response: Response;
    try {
      response = await runResilientRequest({
        timeoutMs: 120_000,
        run: async (signal) =>
          this.fetchImpl(url, {
            ...init,
            signal: options.signal ?? signal
          })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider request failed.";
      yield { type: "error", message, code: error instanceof NetworkResilienceError ? String(error.status) : undefined };
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      yield {
        type: "error",
        message: `Provider returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        code: String(response.status)
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Provider returned an empty stream." };
      return;
    }

    const state: ParseState = { text: "" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const chunk = parseLine(line, state);
          if (chunk?.type === "delta") {
            state.text += chunk.text;
            yield chunk;
          } else if (chunk?.type === "error") {
            yield chunk;
            return;
          }
        }
        if (options.signal?.aborted) {
          yield {
            type: "done",
            usage: resolveUsage(this.provider, options, state),
            model: options.model,
            provider: this.provider,
            finishReason: "cancelled"
          };
          return;
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "done",
      usage: resolveUsage(this.provider, options, state),
      model: options.model,
      provider: this.provider,
      finishReason: state.finishReason ?? "stop"
    };
  }

  protected buildFormattedRequest(options: ProviderStreamOptions, extraSystem?: string): {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    const config = getZeroRetentionConfig(this.provider);
    const messages: ChatRequestMessage[] = extraSystem
      ? [{ role: "system", content: extraSystem }, ...options.messages.filter((m) => m.role !== "system")]
      : options.messages;

    const formatted = formatZeroRetentionRequest({
      provider: this.provider,
      model: options.model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      requestId: options.requestId,
      allowUnapprovedProvider: true
    });

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(formatted.headers)) {
      headers[key] = String(value);
    }
    headers.authorization = `Bearer ${this.options.apiKey}`;

    return {
      url: `${config.endpoint.baseUrl}${config.endpoint.inferencePath}`,
      headers,
      body: { ...formatted.body, stream: true }
    };
  }
}

export type ParseState = {
  text: string;
  finishReason?: FinishReason;
  inputTokens?: number;
  outputTokens?: number;
};

export function resolveUsage(
  provider: LlmProvider,
  options: ProviderStreamOptions,
  state: ParseState
): TokenUsage {
  const inputTokens = state.inputTokens ?? 0;
  const outputTokens = state.outputTokens ?? 0;
  if (inputTokens > 0 || outputTokens > 0) {
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
    };
  }
  return buildUsage(provider, options, state.text);
}

export function buildUsage(provider: LlmProvider, options: ProviderStreamOptions, outputText: string): TokenUsage {
  const inputText = options.messages.map((message) => message.content).join("\n");
  const inputTokens = estimateTokensFromText(inputText);
  const outputTokens = estimateTokensFromText(outputText);
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
  };
}

export function parseSseDataLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return undefined;
  }
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return undefined;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

import { estimateCostUsd, estimateTokensFromText } from "../costEstimate";
import { formatZeroRetentionRequest } from "../requestFormatter";
import type { ChatRequestMessage } from "../requestFormatter";
import { NetworkResilienceError, runResilientRequest } from "../networkResilience";
import { LLM_STREAM_CONNECT_TIMEOUT_MS } from "../../config/responseDeadline";
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
    parseLine: (line: string, state: ParseState) => StreamChunk | undefined,
    hasCompletedMessage?: (state: ParseState) => boolean
  ): AsyncGenerator<StreamChunk> {
    assertStandardInferenceEndpoint(this.provider, url);
    let response: Response;
    try {
      response = await runResilientRequest({
        // TTFB ceiling — not the 15s gather guideline. Combined with user Stop in runResilientRequest.
        timeoutMs: LLM_STREAM_CONNECT_TIMEOUT_MS,
        signal: options.signal,
        policy: { maxRetries: 0 },
        run: async (signal) => {
          signal?.throwIfAborted();
          await options.onProviderDispatch?.();
          return this.fetchImpl(url, {...init, signal});
        }
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
          } else if (chunk?.type === "thinking") {
            yield chunk;
          } else if (chunk?.type === "error") {
            if (hasCompletedMessage) yield {type: "done", usage: resolveUsage(this.provider, options, state),
              model: options.model, provider: this.provider, finishReason: "error"};
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
      buffer += decoder.decode();
      for (const line of buffer.split("\n")) {
        const chunk = parseLine(line, state);
        if (chunk?.type === "delta") {state.text += chunk.text; yield chunk;}
        else if (chunk?.type === "thinking") yield chunk;
        else if (chunk?.type === "error") {
          if (hasCompletedMessage) yield {type: "done", usage: resolveUsage(this.provider, options, state),
            model: options.model, provider: this.provider, finishReason: "error"};
          yield chunk; return;
        }
      }
    } catch (error) {
      if (!hasCompletedMessage) throw error;
      const cancelled = options.signal?.aborted === true;
      yield {type: "done", usage: resolveUsage(this.provider, options, state), model: options.model,
        provider: this.provider, finishReason: cancelled ? "cancelled" : "error"};
      if (!cancelled) yield {type: "error", message: error instanceof Error ? error.message : "Provider stream failed."};
      return;
    } finally {
      reader.releaseLock();
    }

    const incomplete = hasCompletedMessage && !hasCompletedMessage(state);
    yield {
      type: "done",
      usage: resolveUsage(this.provider, options, state),
      model: options.model,
      provider: this.provider,
      finishReason: options.signal?.aborted ? "cancelled" : incomplete ? "error" : state.finishReason ?? "stop"
    };
    if (incomplete && !options.signal?.aborted) yield {type: "error", message: "Provider stream ended without a supported completed message."};
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
  /** OpenAI-compatible [DONE] marker, used by clients requiring strict completion. */
  streamTerminated?: boolean;
  /** Explicit, validated counters and provider-native usage termination. */
  usageComplete?: boolean;
  usageTerminal?: boolean;
};

export function resolveUsage(
  provider: LlmProvider,
  options: ProviderStreamOptions,
  state: ParseState
): TokenUsage {
  const input = readUsageInt(state.inputTokens), output = readUsageInt(state.outputTokens);
  if (input !== undefined || output !== undefined) {
    const inputTokens = input ?? 0, outputTokens = output ?? 0;
    return {inputTokens, outputTokens,
      provenance: state.usageComplete === true && state.usageTerminal === true
        && input !== undefined && output !== undefined ? "provider-final" : "provider-partial",
      estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens, options.model)};
  }
  return buildUsage(provider, options, state.text);
}

/** Presence and integer validity are distinct from explicit numeric zero. */
export function readUsageInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function buildUsage(provider: LlmProvider, options: ProviderStreamOptions, outputText: string): TokenUsage {
  const inputText = options.messages.map((message) => message.content).join("\n");
  const inputTokens = estimateTokensFromText(inputText);
  const outputTokens = estimateTokensFromText(outputText);
  return {
    inputTokens,
    outputTokens,
    provenance: "estimated",
    estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens, options.model)
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
    throw new Error("Provider returned malformed stream data.");
  }
}

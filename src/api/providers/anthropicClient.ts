import { getZeroRetentionConfig } from "../zeroRetentionConfig";
import { BaseProviderClient, parseSseDataLine, resolveUsage, type ParseState } from "./baseClient";
import { formatZeroRetentionRequest } from "../requestFormatter";
import type { ProviderStreamOptions, ProviderThinkingOptions, StreamChunk } from "../types";
import { runResilientRequest } from "../networkResilience";
import { LLM_STREAM_CONNECT_TIMEOUT_MS } from "../../config/responseDeadline";
import { anthropicUsesAdaptiveThinking } from "../../config/chatThinkingBudget";

export function applyAnthropicThinking(
  body: Record<string, unknown>,
  options: {
    model: string;
    maxTokens: number;
    thinking?: ProviderThinkingOptions;
  }
): { body: Record<string, unknown>; maxTokens: number; forceTemperature?: number } {
  const thinking = options.thinking;
  if (!thinking || (thinking.mode !== "adaptive" && thinking.mode !== "extended" && thinking.mode != null)) {
    return { body, maxTokens: options.maxTokens };
  }
  const useAdaptive =
    thinking.mode === "adaptive" ||
    (thinking.mode == null && anthropicUsesAdaptiveThinking(options.model));
  if (useAdaptive) {
    return {
      body: {
        ...body,
        thinking: { type: "adaptive" },
        output_config: { effort: thinking.effort ?? "high" }
      },
      maxTokens: options.maxTokens,
      // Anthropic rejects any temperature other than 1 when thinking is on
      // (extended `enabled` or adaptive). Default chat temp is 0.5.
      forceTemperature: 1
    };
  }
  const budget = thinking.budgetTokens;
  if (typeof budget !== "number" || budget <= 0) {
    return { body, maxTokens: options.maxTokens };
  }
  return {
    body: {
      ...body,
      thinking: { type: "enabled", budget_tokens: budget }
    },
    maxTokens: Math.max(options.maxTokens, budget + 512),
    forceTemperature: 1
  };
}

/** Final Anthropic Messages body — thinking + temperature clamp live here, not at call sites. */
export function buildAnthropicInferenceBody(options: {
  formattedBody: Record<string, unknown>;
  model: string;
  maxTokens: number;
  thinking?: ProviderThinkingOptions;
}): Record<string, unknown> {
  const applied = applyAnthropicThinking(
    {
      ...options.formattedBody,
      model: options.model,
      stream: true
    },
    {
      model: options.model,
      maxTokens: options.maxTokens,
      thinking: options.thinking
    }
  );
  const body: Record<string, unknown> = {
    ...applied.body,
    max_tokens: applied.maxTokens
  };
  if (applied.forceTemperature === 1) {
    body.temperature = 1;
  }
  return body;
}

export class AnthropicProviderClient extends BaseProviderClient {
  public async *streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    const config = getZeroRetentionConfig("anthropic");
    const formatted = formatZeroRetentionRequest({
      provider: "anthropic",
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      requestId: options.requestId,
      allowUnapprovedProvider: true
    });

    const url = `${config.endpoint.baseUrl}${config.endpoint.inferencePath}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": this.options.apiKey,
      "anthropic-version": "2023-06-01"
    };
    for (const [key, value] of Object.entries(formatted.headers)) {
      headers[key.toLowerCase()] = String(value);
    }

    const body = buildAnthropicInferenceBody({
      formattedBody: formatted.body,
      model: options.model,
      maxTokens: options.maxTokens,
      thinking: options.thinking
    });

    const state: ParseState = { text: "" };
    let response: Response;
    try {
      response = await runResilientRequest({
        timeoutMs: LLM_STREAM_CONNECT_TIMEOUT_MS,
        signal: options.signal,
        policy: { maxRetries: 0 },
        run: async (signal) =>
          this.fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal
          })
      });
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "Anthropic request failed."
      };
      return;
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      yield { type: "error", message: `Anthropic returned ${response.status}: ${text.slice(0, 200)}` };
      return;
    }

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
          const chunk = parseAnthropicLine(line, state);
          if (chunk?.type === "delta") {
            state.text += chunk.text;
            yield chunk;
          } else if (chunk?.type === "thinking") {
            yield chunk;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "done",
      usage: resolveUsage("anthropic", options, state),
      model: options.model,
      provider: "anthropic",
      finishReason: state.finishReason ?? "stop"
    };
  }
}

/** Exported for unit tests — parses one Anthropic SSE data line. */
export function parseAnthropicLine(line: string, state: ParseState): StreamChunk | undefined {
  const data = parseSseDataLine(line) as Record<string, unknown> | undefined;
  if (!data || typeof data.type !== "string") {
    return undefined;
  }
  if (data.type === "message_start") {
    const message = data.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    const inputTokens = readUsageInt(usage?.input_tokens);
    if (inputTokens !== undefined) {
      state.inputTokens = inputTokens;
    }
  }
  if (data.type === "content_block_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    if (!delta || typeof delta.type !== "string") {
      return undefined;
    }
    if (delta.type === "thinking_delta") {
      const thinking = typeof delta.thinking === "string" ? delta.thinking : "";
      return thinking ? { type: "thinking", text: thinking } : undefined;
    }
    if (delta.type === "text_delta" || typeof delta.text === "string") {
      const text = typeof delta.text === "string" ? delta.text : "";
      return text ? { type: "delta", text } : undefined;
    }
    return undefined;
  }
  if (data.type === "message_stop") {
    const usage = data.usage as Record<string, unknown> | undefined;
    const outputTokens = readUsageInt(usage?.output_tokens);
    if (outputTokens !== undefined) {
      state.outputTokens = outputTokens;
    }
  }
  if (data.type === "message_delta") {
    const usage = data.usage as Record<string, unknown> | undefined;
    const outputTokens = readUsageInt(usage?.output_tokens);
    if (outputTokens !== undefined) {
      state.outputTokens = outputTokens;
    }
    const delta = data.delta as Record<string, unknown> | undefined;
    const reason = delta?.stop_reason;
    if (typeof reason === "string") {
      state.finishReason = reason === "max_tokens" ? "length" : "stop";
    }
  }
  return undefined;
}

function readUsageInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

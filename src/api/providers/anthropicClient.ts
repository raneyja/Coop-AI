import { getZeroRetentionConfig } from "../zeroRetentionConfig";
import { BaseProviderClient, buildUsage, parseSseDataLine, type ParseState } from "./baseClient";
import { formatZeroRetentionRequest } from "../requestFormatter";
import type { ProviderStreamOptions, StreamChunk } from "../types";
import { runResilientRequest } from "../networkResilience";

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

    const body = {
      ...formatted.body,
      model: options.model,
      max_tokens: options.maxTokens,
      stream: true
    };

    const state: ParseState = { text: "" };
    let response: Response;
    try {
      response = await runResilientRequest({
        timeoutMs: 120_000,
        run: async (signal) =>
          this.fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: options.signal ?? signal
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
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "done",
      usage: buildUsage("anthropic", options, state.text),
      model: options.model,
      provider: "anthropic",
      finishReason: state.finishReason ?? "stop"
    };
  }
}

function parseAnthropicLine(line: string, state: ParseState): StreamChunk | undefined {
  const data = parseSseDataLine(line) as Record<string, unknown> | undefined;
  if (!data || typeof data.type !== "string") {
    return undefined;
  }
  if (data.type === "content_block_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    const text = typeof delta?.text === "string" ? delta.text : "";
    return text ? { type: "delta", text } : undefined;
  }
  if (data.type === "message_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    const reason = delta?.stop_reason;
    if (typeof reason === "string") {
      state.finishReason = reason === "max_tokens" ? "length" : "stop";
    }
  }
  return undefined;
}

import { formatZeroRetentionRequest } from "../requestFormatter";
import { getZeroRetentionConfig } from "../zeroRetentionConfig";
import { BaseProviderClient, resolveUsage, type ParseState } from "./baseClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";
import { runResilientRequest } from "../networkResilience";
import { LLM_STREAM_CONNECT_TIMEOUT_MS } from "../../config/responseDeadline";

export class GeminiProviderClient extends BaseProviderClient {
  public async *streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    const config = getZeroRetentionConfig("gemini");
    const formatted = formatZeroRetentionRequest({
      provider: "gemini",
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      requestId: options.requestId,
      allowUnapprovedProvider: true
    });

    const modelPath = config.endpoint.inferencePath.replace("{model}", encodeURIComponent(options.model));
    const url = `${config.endpoint.baseUrl}${modelPath.replace("generateContent", "streamGenerateContent")}?alt=sse&key=${encodeURIComponent(this.options.apiKey)}`;

    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const [key, value] of Object.entries(formatted.headers)) {
      headers[key.toLowerCase()] = String(value);
    }

    const applied = applyGeminiThinking(formatted.body, options.thinking);
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
            body: JSON.stringify(applied),
            signal
          })
      });
    } catch (error) {
      yield { type: "error", message: error instanceof Error ? error.message : "Gemini request failed." };
      return;
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      yield { type: "error", message: `Gemini returned ${response.status}: ${text.slice(0, 200)}` };
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
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const payload = trimmed.slice(5).trim();
          if (!payload) {
            continue;
          }
          try {
            const data = JSON.parse(payload) as Record<string, unknown>;
            const usageMetadata = data.usageMetadata as Record<string, unknown> | undefined;
            if (usageMetadata) {
              const inputTokens = readUsageInt(usageMetadata.promptTokenCount);
              const outputTokens = readUsageInt(usageMetadata.candidatesTokenCount);
              const totalTokens = readUsageInt(usageMetadata.totalTokenCount);
              if (inputTokens !== undefined) {
                state.inputTokens = inputTokens;
              }
              if (outputTokens !== undefined) {
                state.outputTokens = outputTokens;
              } else if (totalTokens !== undefined && inputTokens !== undefined) {
                state.outputTokens = Math.max(0, totalTokens - inputTokens);
              }
            }
            const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
            const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
            const partsOut = content?.parts as Array<Record<string, unknown>> | undefined;
            for (const chunk of parseGeminiParts(partsOut)) {
              if (chunk.type === "delta") {
                state.text += chunk.text;
              }
              yield chunk;
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "done",
      usage: resolveUsage("gemini", options, state),
      model: options.model,
      provider: "gemini",
      finishReason: "stop"
    };
  }
}

export function applyGeminiThinking(
  body: Record<string, unknown>,
  thinking?: { mode?: string }
): Record<string, unknown> {
  if (thinking?.mode !== "gemini-thoughts") {
    return body;
  }
  const generationConfig = {
    ...((body.generationConfig as Record<string, unknown> | undefined) ?? {}),
    thinkingConfig: { includeThoughts: true }
  };
  return { ...body, generationConfig };
}

export function parseGeminiParts(
  parts: Array<Record<string, unknown>> | undefined
): Array<{ type: "thinking" | "delta"; text: string }> {
  if (!parts?.length) {
    return [];
  }
  const chunks: Array<{ type: "thinking" | "delta"; text: string }> = [];
  for (const part of parts) {
    const text = typeof part.text === "string" ? part.text : "";
    if (!text) {
      continue;
    }
    chunks.push(part.thought === true ? { type: "thinking", text } : { type: "delta", text });
  }
  return chunks;
}

function readUsageInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

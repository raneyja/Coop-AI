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
    const strict = options.requireCompletedMessage === true;
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
      if (strict && options.signal?.aborted) {
        yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
          provider: "gemini", finishReason: "cancelled"};
        return;
      }
      yield { type: "error", message: strict ? "Gemini request failed." : error instanceof Error ? error.message : "Gemini request failed." };
      return;
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      yield { type: "error", message: strict ? `Gemini returned ${response.status}.` : `Gemini returned ${response.status}: ${text.slice(0, 200)}` };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", {fatal: strict});
    let buffer = "";

    try {
      while (true) {
        if (strict && options.signal?.aborted) {
          yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
            provider: "gemini", finishReason: "cancelled"};
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          for (const chunk of parseGeminiSseLine(line, state, strict)) {
            if (strict && options.signal?.aborted) {
              yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
                provider: "gemini", finishReason: "cancelled"};
              return;
            }
            if (chunk.type === "delta") state.text += chunk.text;
            if (chunk.type === "error") {
              yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
                provider: "gemini", finishReason: options.signal?.aborted ? "cancelled" : "error"};
              if (!options.signal?.aborted) yield chunk;
              return;
            }
            yield chunk;
          }
        }
      }
      if (strict && options.signal?.aborted) {
        yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
          provider: "gemini", finishReason: "cancelled"};
        return;
      }
      buffer += decoder.decode();
      for (const line of buffer.split("\n")) {
        for (const chunk of parseGeminiSseLine(line, state, strict)) {
          if (strict && options.signal?.aborted) {
            yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
              provider: "gemini", finishReason: "cancelled"};
            return;
          }
          if (chunk.type === "delta") state.text += chunk.text;
          if (chunk.type === "error") {
            yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
              provider: "gemini", finishReason: options.signal?.aborted ? "cancelled" : "error"};
            if (!options.signal?.aborted) yield chunk;
            return;
          }
          yield chunk;
        }
      }
    } catch (error) {
      if (!strict) throw error;
      yield {type: "done", usage: resolveUsage("gemini", options, state), model: options.model,
        provider: "gemini", finishReason: options.signal?.aborted ? "cancelled" : "error"};
      if (!options.signal?.aborted) yield {type: "error", message: "Gemini stream failed before completion."};
      return;
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "done",
      usage: resolveUsage("gemini", options, state),
      model: options.model,
      provider: "gemini",
      finishReason: options.signal?.aborted && strict ? "cancelled" : strict ? state.finishReason ?? "error" : "stop"
    };
    if (strict && !options.signal?.aborted && state.finishReason !== "stop" && state.finishReason !== "length") {
      yield {type: "error", message: "Gemini stream ended without a supported completion reason."};
    }
  }
}

/** Native Gemini SSE has no [DONE] sentinel: the candidate's finishReason is
 * its terminal signal. https://ai.google.dev/api/generate-content#FinishReason */
export function parseGeminiSseLine(line: string, state: ParseState, strict = false): StreamChunk[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return [];
  const payload = trimmed.slice(5).trim();
  if (!payload) return [];
  try {
    const data = JSON.parse(payload) as Record<string, unknown>;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid event");
    const usageMetadata = data.usageMetadata as Record<string, unknown> | undefined;
    if (usageMetadata) {
      const inputTokens = readUsageInt(usageMetadata.promptTokenCount);
      const outputTokens = geminiBilledOutputTokens(usageMetadata);
      if (inputTokens !== undefined) state.inputTokens = inputTokens;
      if (outputTokens !== undefined) state.outputTokens = outputTokens;
    }
    if (data.error) return strict ? [{type: "error", message: "Gemini returned a streaming error."}] : [];
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    if (strict && candidates !== undefined && !Array.isArray(candidates)) throw new Error("Invalid candidates");
    const candidate = candidates?.[0];
    if (strict && candidates?.length && (!candidate || typeof candidate !== "object" || Array.isArray(candidate))) throw new Error("Invalid candidate");
    const content = candidate?.content as Record<string, unknown> | undefined;
    if (strict && content != null && (typeof content !== "object" || Array.isArray(content)
      || (content.parts !== undefined && !Array.isArray(content.parts)))) throw new Error("Invalid content");
    const chunks: StreamChunk[] = parseGeminiParts(content?.parts as Array<Record<string, unknown>> | undefined);
    const reason = candidate?.finishReason;
    if (strict && reason != null && typeof reason !== "string") throw new Error("Invalid reason");
    if (typeof reason === "string" && reason && reason !== "FINISH_REASON_UNSPECIFIED") {
      const mapped = reason === "STOP" ? "stop" : reason === "MAX_TOKENS" ? "length" : "error";
      if (strict && state.finishReason && state.finishReason !== mapped) return [{type: "error", message: "Gemini returned conflicting completion reasons."}];
      state.finishReason = mapped;
      if (strict && mapped === "error") chunks.push({type: "error", message: "Gemini stopped without a supported completion reason."});
    }
    return chunks;
  } catch {
    return strict ? [{type: "error", message: "Gemini returned malformed stream data."}] : [];
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

/** Visible answer tokens plus thinking tokens. Google bills both as output. */
export function geminiBilledOutputTokens(usageMetadata: Record<string, unknown>): number | undefined {
  const candidates = readUsageInt(usageMetadata.candidatesTokenCount);
  const thoughts = readUsageInt(usageMetadata.thoughtsTokenCount) ?? 0;
  if (candidates !== undefined) {
    return candidates + thoughts;
  }
  const total = readUsageInt(usageMetadata.totalTokenCount);
  const input = readUsageInt(usageMetadata.promptTokenCount);
  if (total !== undefined && input !== undefined) {
    return Math.max(0, total - input);
  }
  return thoughts > 0 ? thoughts : undefined;
}

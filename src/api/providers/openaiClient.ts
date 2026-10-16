import { BaseProviderClient, parseSseDataLine, type ParseState } from "./baseClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

export class OpenAiProviderClient extends BaseProviderClient {
  public async *streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    const { url, headers, body } = this.buildFormattedRequest(options);
    const inferenceBody = applyOpenAiThinking(body, options.thinking);
    if (options.responseSchema) inferenceBody.response_format = {
      type: "json_schema", json_schema: {name: "coop_source_claim_review", strict: true, schema: options.responseSchema}
    };
    yield* this.streamFromEndpoint(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          ...inferenceBody,
          stream: true,
          stream_options: { include_usage: true }
        })
      },
      options,
      (line, state) => parseOpenAiSseLine(line, state),
      options.responseSchema || options.requireCompletedMessage ? state => state.streamTerminated === true
        && (state.finishReason === "stop" || state.finishReason === "length") : undefined
    );
  }
}

export function applyOpenAiThinking(
  body: Record<string, unknown>,
  thinking?: ProviderStreamOptions["thinking"]
): Record<string, unknown> {
  if (thinking?.mode !== "openai-reasoning") {
    return body;
  }
  const next: Record<string, unknown> = {
    ...body,
    reasoning_effort: thinking.effort ?? "medium"
  };
  // GPT-5 / o-series reject a custom temperature even when reasoning_effort is set.
  delete next.temperature;
  return next;
}

export function parseOpenAiSseLine(line: string, state: ParseState): StreamChunk | undefined {
  if (line.trim() === "data: [DONE]") {state.streamTerminated = true; return undefined;}
  const data = parseSseDataLine(line) as Record<string, unknown> | undefined;
  if (!data) {
    return undefined;
  }
  const providerError = data.error as Record<string, unknown> | undefined;
  if (providerError && typeof providerError === "object") return {type: "error",
    message: typeof providerError.message === "string" ? providerError.message.slice(0, 500) : "OpenAI stream failed.",
    code: typeof providerError.code === "string" ? providerError.code : undefined};
  const usage = data.usage as Record<string, unknown> | undefined;
  if (usage) {
    const promptTokens = readUsageInt(usage.prompt_tokens);
    const completionTokens = readUsageInt(usage.completion_tokens);
    if (promptTokens !== undefined) {
      state.inputTokens = promptTokens;
    }
    if (completionTokens !== undefined) {
      state.outputTokens = completionTokens;
    }
  }
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const choice = choices[0] as Record<string, unknown>;
  const delta = choice.delta as Record<string, unknown> | undefined;
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason === "length" ? "length" : choice.finish_reason === "stop" ? "stop" : "error";
  }
  const reasoning =
    typeof delta?.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta?.reasoning === "string"
        ? delta.reasoning
        : "";
  if (reasoning) {
    return { type: "thinking", text: reasoning };
  }
  const text = typeof delta?.content === "string" ? delta.content : "";
  if (!text) {
    return undefined;
  }
  return { type: "delta", text };
}

function readUsageInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

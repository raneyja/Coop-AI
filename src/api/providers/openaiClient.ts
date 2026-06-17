import { BaseProviderClient, parseSseDataLine, type ParseState } from "./baseClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

export class OpenAiProviderClient extends BaseProviderClient {
  public async *streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    const { url, headers, body } = this.buildFormattedRequest(options);
    yield* this.streamFromEndpoint(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          stream: true,
          stream_options: { include_usage: true }
        })
      },
      options,
      (line, state) => parseOpenAiSseLine(line, state)
    );
  }
}

export function parseOpenAiSseLine(line: string, state: ParseState): StreamChunk | undefined {
  const data = parseSseDataLine(line) as Record<string, unknown> | undefined;
  if (!data) {
    return undefined;
  }
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
  const text = typeof delta?.content === "string" ? delta.content : "";
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason === "length" ? "length" : "stop";
  }
  if (!text) {
    return undefined;
  }
  return { type: "delta", text };
}

function readUsageInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

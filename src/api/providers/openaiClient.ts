import { BaseProviderClient, parseSseDataLine, type ParseState } from "./baseClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

export class OpenAiProviderClient extends BaseProviderClient {
  public async *streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    const { url, headers, body } = this.buildFormattedRequest(options);
    yield* this.streamFromEndpoint(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body)
    }, options, (line, state) => parseOpenAiSseLine(line, state));
  }
}

export function parseOpenAiSseLine(line: string, state: ParseState): StreamChunk | undefined {
  const data = parseSseDataLine(line) as Record<string, unknown> | undefined;
  if (!data) {
    return undefined;
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

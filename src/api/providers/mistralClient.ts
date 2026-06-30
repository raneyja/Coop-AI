import { buildProviderHeaders } from "../zeroRetentionConfig";
import { BaseProviderClient, type ParseState } from "./baseClient";
import { parseCompletionSseLine } from "./fimSse";
import type { FimStreamOptions, ProviderStreamOptions, StreamChunk } from "../types";

const FIM_PATH = "/v1/fim/completions";

export class MistralProviderClient extends BaseProviderClient {
  public async *streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    yield {
      type: "error",
      message: "Mistral provider is configured for FIM inline completion only."
    };
  }

  public async *streamFim(options: FimStreamOptions): AsyncGenerator<StreamChunk> {
    const url = `https://api.mistral.ai${FIM_PATH}`;
    yield* this.streamFromEndpoint(
      url,
      {
        method: "POST",
        headers: {
          ...buildProviderHeaders("mistral", { requestId: options.requestId }),
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: options.model,
          prompt: options.prefix,
          suffix: options.suffix,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          stream: true
        })
      },
      {
        messages: [],
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        signal: options.signal,
        requestId: options.requestId
      },
      (line, state) => parseCompletionSseLine(line, state)
    );
  }
}

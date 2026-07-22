import { buildProviderHeaders, getZeroRetentionConfig } from "../zeroRetentionConfig";
import { BaseProviderClient } from "./baseClient";
import { parseOpenAiSseLine } from "./openaiClient";
import { parseCompletionSseLine } from "./fimSse";
import type { FimStreamOptions, ProviderStreamOptions, StreamChunk } from "../types";

/** DeepSeek uses an OpenAI-compatible chat completions API. */
export class DeepSeekProviderClient extends BaseProviderClient {
  public async *streamCompletion(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    const config = getZeroRetentionConfig("deepseek");
    const { headers, body } = this.buildFormattedRequest(options);
    const url = `${config.endpoint.baseUrl}${config.endpoint.inferencePath}`;
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
      parseOpenAiSseLine
    );
  }

  public async *streamFim(options: FimStreamOptions): AsyncGenerator<StreamChunk> {
    const url = "https://api.deepseek.com/beta/completions";
    yield* this.streamFromEndpoint(
      url,
      {
        method: "POST",
        headers: {
          ...buildProviderHeaders("deepseek", { requestId: options.requestId }),
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: options.model,
          prompt: options.prefix,
          suffix: options.suffix,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          stream: true,
          stream_options: { include_usage: true }
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
      parseCompletionSseLine
    );
  }
}

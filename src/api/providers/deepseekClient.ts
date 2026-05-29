import { getZeroRetentionConfig } from "../zeroRetentionConfig";
import { BaseProviderClient } from "./baseClient";
import { parseOpenAiSseLine } from "./openaiClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

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
        body: JSON.stringify(body)
      },
      options,
      parseOpenAiSseLine
    );
  }
}

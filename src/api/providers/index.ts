import type { LlmProvider } from "../zeroRetentionConfig";
import type { ProviderClientOptions } from "./baseClient";
import { AnthropicProviderClient } from "./anthropicClient";
import { DeepSeekProviderClient } from "./deepseekClient";
import { GeminiProviderClient } from "./geminiClient";
import { MistralProviderClient } from "./mistralClient";
import { OpenAiProviderClient } from "./openaiClient";
import type { BaseProviderClient } from "./baseClient";

export function createProviderClient(
  provider: LlmProvider,
  options: ProviderClientOptions
): BaseProviderClient {
  switch (provider) {
    case "openai":
      return new OpenAiProviderClient("openai", options);
    case "anthropic":
      return new AnthropicProviderClient("anthropic", options);
    case "deepseek":
      return new DeepSeekProviderClient("deepseek", options);
    case "gemini":
      return new GeminiProviderClient("gemini", options);
    case "mistral":
      return new MistralProviderClient("mistral", options);
  }
}

export function createFimClient(
  provider: "mistral" | "deepseek",
  options: ProviderClientOptions
): MistralProviderClient | DeepSeekProviderClient {
  if (provider === "mistral") {
    return new MistralProviderClient("mistral", options);
  }
  return new DeepSeekProviderClient("deepseek", options);
}

import type { LlmServerConfig } from "./llmServerConfig";
import { resolveProviderApiKey } from "./llmServerConfig";
import type { LlmProvider } from "./zeroRetentionConfig";
import {
  FIM_DEEPSEEK_MODEL,
  FIM_MISTRAL_MODEL,
  defaultInlineModelForProvider
} from "../config/inlineModelPresets";

export type FimRoute =
  | { mode: "fim"; provider: "mistral" | "deepseek"; model: string }
  | { mode: "chat-fallback"; provider: LlmProvider; model: string };

export type SelectFimProviderInput = {
  segments?: { prefix: string; suffix: string };
  requestedProvider?: LlmProvider;
  requestedModel?: string;
};

export function selectFimProvider(
  config: LlmServerConfig,
  input: SelectFimProviderInput
): FimRoute {
  const prefix = input.segments?.prefix?.trim() ?? "";
  if (!prefix) {
    return chatFallback(config, input);
  }

  if (hasApiKey(config, "mistral")) {
    return {
      mode: "fim",
      provider: "mistral",
      model: input.requestedProvider === "mistral" && input.requestedModel
        ? input.requestedModel
        : FIM_MISTRAL_MODEL
    };
  }

  if (hasApiKey(config, "deepseek")) {
    return {
      mode: "fim",
      provider: "deepseek",
      model: input.requestedProvider === "deepseek" && input.requestedModel
        ? input.requestedModel
        : FIM_DEEPSEEK_MODEL
    };
  }

  return chatFallback(config, input);
}

function chatFallback(config: LlmServerConfig, input: SelectFimProviderInput): FimRoute {
  const provider = input.requestedProvider ?? config.defaultProvider;
  const model =
    input.requestedModel && input.requestedModel.trim()
      ? input.requestedModel.trim()
      : defaultInlineModelForProvider(provider);
  return { mode: "chat-fallback", provider, model };
}

function hasApiKey(config: LlmServerConfig, provider: LlmProvider): boolean {
  if (config.mockMode) {
    return true;
  }
  return Boolean(resolveProviderApiKey(config, provider));
}

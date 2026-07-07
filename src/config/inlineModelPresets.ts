import type { LlmProvider } from "../api/zeroRetentionConfig";

export type InlineModelPresetId = "chat" | "haiku" | "gpt35" | "custom";

export type InlineModelPresetConfig = {
  provider: LlmProvider;
  model: string;
  fallback?: { provider: LlmProvider; model: string };
};

export const INLINE_MODEL_PRESETS: Record<"haiku" | "gpt35", InlineModelPresetConfig> = {
  haiku: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    fallback: { provider: "openai", model: "gpt-4o-mini" }
  },
  gpt35: {
    provider: "openai",
    model: "gpt-4o-mini",
    fallback: { provider: "anthropic", model: "claude-haiku-4-5-20251001" }
  }
};

/** Default Codestral model for server-side FIM routing. */
export const FIM_MISTRAL_MODEL = "codestral-latest";

/** Default DeepSeek model for FIM beta completions. */
export const FIM_DEEPSEEK_MODEL = "deepseek-chat";

export const INLINE_CUSTOM_FALLBACK = INLINE_MODEL_PRESETS.haiku.fallback;

/** Default fast model per provider when the client omits `model`. */
export const INLINE_DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  anthropic: INLINE_MODEL_PRESETS.haiku.model,
  openai: INLINE_MODEL_PRESETS.gpt35.model,
  gemini: "gemini-2.0-flash",
  deepseek: FIM_DEEPSEEK_MODEL,
  mistral: FIM_MISTRAL_MODEL
};

export function resolveChatModelPreset(
  provider: LlmProvider,
  chatModel: string
): InlineModelPresetConfig {
  const model = chatModel.trim() || defaultInlineModelForProvider(provider);
  return {
    provider,
    model,
    fallback: INLINE_CUSTOM_FALLBACK
  };
}

export function resolveInlineModelPreset(
  preset: InlineModelPresetId,
  customModel: string,
  defaultProvider: LlmProvider,
  chatModel = ""
): InlineModelPresetConfig {
  if (preset === "chat") {
    return resolveChatModelPreset(defaultProvider, chatModel);
  }
  if (preset === "custom" && customModel.trim()) {
    return {
      provider: defaultProvider,
      model: customModel.trim(),
      fallback: INLINE_CUSTOM_FALLBACK
    };
  }
  if (preset === "custom") {
    return INLINE_MODEL_PRESETS.haiku;
  }
  return INLINE_MODEL_PRESETS[preset];
}

export function defaultInlineModelForProvider(provider: LlmProvider): string {
  return INLINE_DEFAULT_MODEL_BY_PROVIDER[provider];
}

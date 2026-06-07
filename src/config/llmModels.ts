import type { LlmProvider } from "../api/zeroRetentionConfig";

// Curated, current-gen models verified available against each provider's API.
// Ordered balanced/default first, then most capable, then fast/low-cost.
export const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5.1", "gpt-5.5", "gpt-5-mini", "gpt-4o-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"]
};

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.1",
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-chat"
};

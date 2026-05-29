import type { LlmProvider } from "../api/zeroRetentionConfig";

export const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"]
};

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  anthropic: "claude-3-5-sonnet-20241022",
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
  deepseek: "deepseek-chat"
};

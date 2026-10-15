import type { LlmProvider } from "../api/zeroRetentionConfig";

const STRUCTURED_REVIEW_MODELS = new Set([
  "claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"
]);

/** Catalog capability, not a repository or question rule. Unknown/new models
 * keep their existing contract until the provider capability is qualified. */
export function supportsStructuredSourceReview(provider: LlmProvider, model: string): boolean {
  return provider === "anthropic" ? STRUCTURED_REVIEW_MODELS.has(model)
    : provider === "openai" && model === "gpt-5.5";
}

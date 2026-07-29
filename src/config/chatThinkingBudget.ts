/** Minimum Anthropic thinking budget (API floor). */
export const ANTHROPIC_THINKING_BUDGET_TOKENS = 1024;

/**
 * Resolve a safe thinking budget for Anthropic, or undefined if maxTokens is too small.
 * budget_tokens must be strictly less than max_tokens.
 */
export function resolveAnthropicThinkingBudget(maxTokens: number): number | undefined {
  if (!Number.isFinite(maxTokens) || maxTokens <= ANTHROPIC_THINKING_BUDGET_TOKENS) {
    return undefined;
  }
  return ANTHROPIC_THINKING_BUDGET_TOKENS;
}

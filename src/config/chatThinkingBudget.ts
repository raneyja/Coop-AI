/** Minimum Anthropic extended-thinking budget (API floor). */
export const ANTHROPIC_THINKING_BUDGET_TOKENS = 1024;

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type ResolvedAnthropicThinking =
  | { mode: "adaptive"; effort: AnthropicEffort }
  | { mode: "extended"; budgetTokens: number };

/**
 * Opus 4.6+ and Sonnet 4.6+ / Sonnet 5 reject `thinking.type.enabled`.
 * Haiku 4.5 / Sonnet 4.5 / Opus 4.5 still use extended thinking + budget_tokens.
 */
export function anthropicUsesAdaptiveThinking(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (/claude-haiku/.test(id)) {
    return false;
  }
  if (/claude-opus-4-5(?:\D|$)/.test(id) || /claude-sonnet-4-5(?:\D|$)/.test(id)) {
    return false;
  }
  if (/claude-opus-4-[6-9]/.test(id) || /claude-opus-[5-9]/.test(id)) {
    return true;
  }
  if (/claude-sonnet-4-[6-9]/.test(id) || /claude-sonnet-[5-9]/.test(id)) {
    return true;
  }
  return false;
}

/**
 * Resolve a safe thinking budget for extended-thinking models, or undefined if maxTokens is too small.
 * budget_tokens must be strictly less than max_tokens.
 */
export function resolveAnthropicThinkingBudget(maxTokens: number): number | undefined {
  if (!Number.isFinite(maxTokens) || maxTokens <= ANTHROPIC_THINKING_BUDGET_TOKENS) {
    return undefined;
  }
  return ANTHROPIC_THINKING_BUDGET_TOKENS;
}

export function resolveAnthropicThinking(
  model: string,
  maxTokens: number
): ResolvedAnthropicThinking | undefined {
  if (anthropicUsesAdaptiveThinking(model)) {
    return { mode: "adaptive", effort: "high" };
  }
  const budgetTokens = resolveAnthropicThinkingBudget(maxTokens);
  if (!budgetTokens) {
    return undefined;
  }
  if (!model.toLowerCase().includes("claude")) {
    return undefined;
  }
  return { mode: "extended", budgetTokens };
}

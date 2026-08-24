/**
 * Chat answer length. The old 2000 default (and GPT-5 reasoning counting
 * against max_completion_tokens) cut long walkthroughs off mid-sentence.
 */

/** Visible answer budget for chat / quick actions. */
export const CHAT_OUTPUT_MAX_TOKENS_DEFAULT = 8192;

/** Hard cap sent to providers. */
export const CHAT_OUTPUT_MAX_TOKENS_CAP = 32_768;

export const CHAT_OUTPUT_MAX_TOKENS_FLOOR = 256;

/** Historical extension + API default — too small for cited walkthroughs. */
export const LEGACY_CHAT_OUTPUT_MAX_TOKENS = 2000;

/**
 * Extra max_completion_tokens for GPT-5 / o-series so hidden reasoning does
 * not consume the visible answer budget.
 */
export const GPT5_REASONING_COMPLETION_RESERVE = 4096;

export function resolveChatOutputMaxTokens(requested?: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return CHAT_OUTPUT_MAX_TOKENS_DEFAULT;
  }
  const rounded = Math.floor(requested);
  if (rounded === LEGACY_CHAT_OUTPUT_MAX_TOKENS) {
    return CHAT_OUTPUT_MAX_TOKENS_DEFAULT;
  }
  return Math.min(Math.max(rounded, CHAT_OUTPUT_MAX_TOKENS_FLOOR), CHAT_OUTPUT_MAX_TOKENS_CAP);
}

export function isGpt5StyleReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model.trim());
}

/** Tokens to send as max_completion_tokens for OpenAI chat. */
export function openaiCompletionTokenBudget(visibleMaxTokens: number, model: string): number {
  const visible = Math.max(0, Math.floor(visibleMaxTokens));
  if (!isGpt5StyleReasoningModel(model) || visible < LEGACY_CHAT_OUTPUT_MAX_TOKENS) {
    return visible;
  }
  return Math.min(visible + GPT5_REASONING_COMPLETION_RESERVE, CHAT_OUTPUT_MAX_TOKENS_CAP);
}

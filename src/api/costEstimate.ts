import type { LlmProvider } from "./zeroRetentionConfig";

/** Rough USD per 1M tokens (input, output) for UI estimates only. */
const PRICING_PER_MILLION: Record<LlmProvider, { input: number; output: number }> = {
  openai: { input: 2.5, output: 10 },
  anthropic: { input: 3, output: 15 },
  deepseek: { input: 0.14, output: 0.28 },
  gemini: { input: 1.25, output: 5 },
  mistral: { input: 0.3, output: 0.9 }
};

export function estimateCostUsd(provider: LlmProvider, inputTokens: number, outputTokens: number): number {
  const rates = PRICING_PER_MILLION[provider];
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

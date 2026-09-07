import type { LlmProvider } from "../api/zeroRetentionConfig";
import type { ProviderThinkingOptions } from "../api/types";
import { getCatalogModelById, listCatalogModels } from "./llmModels";
import {
  ANTHROPIC_THINKING_BUDGET_TOKENS,
  anthropicUsesAdaptiveThinking,
  resolveAnthropicThinkingBudget
} from "./chatThinkingBudget";

/**
 * How this catalog model should think on chat.
 * Every `listCatalogModels()` id must have a row — tests fail closed if a model is added without one.
 */
export type CatalogThinkingKind =
  | "none"
  | "anthropic-adaptive"
  | "anthropic-extended"
  | "openai-reasoning"
  | "gemini-thoughts"
  | "parse-only";

/** Explicit contract for every catalog id — picker, Auto assignments, and FIM. */
export const CATALOG_THINKING_KIND: Record<string, CatalogThinkingKind> = {
  "gpt-5.1": "openai-reasoning",
  "gpt-5.5": "openai-reasoning",
  "gpt-5-mini": "openai-reasoning",
  "gpt-4o-mini": "none",
  "claude-sonnet-4-6": "anthropic-adaptive",
  "claude-opus-4-8": "anthropic-adaptive",
  "claude-haiku-4-5-20251001": "anthropic-extended",
  "gemini-2.5-flash": "gemini-thoughts",
  "gemini-2.5-pro": "gemini-thoughts",
  "gemini-2.0-flash": "none",
  "deepseek-chat": "none",
  "deepseek-reasoner": "parse-only",
  "codestral-latest": "none"
};

/** Chat Completions reasoning_effort for GPT-5 / o-series when thinking is on. */
export const OPENAI_CHAT_REASONING_EFFORT = "medium";

/** Anthropic adaptive effort for picker / Auto Claude models that reject `enabled`. */
export const ANTHROPIC_ADAPTIVE_EFFORT = "high";

export function catalogThinkingKind(model: string): CatalogThinkingKind | undefined {
  const entry = getCatalogModelById(model);
  if (entry) {
    return CATALOG_THINKING_KIND[entry.id];
  }
  return undefined;
}

/** Family fallback when the id is not in the catalog (snapshots, aliases). */
export function inferThinkingKind(provider: LlmProvider, model: string): CatalogThinkingKind {
  const fromCatalog = catalogThinkingKind(model);
  if (fromCatalog) {
    return fromCatalog;
  }
  const id = model.trim().toLowerCase();
  if (provider === "anthropic" || id.includes("claude")) {
    if (anthropicFamilyUsesAdaptiveThinking(id)) {
      return "anthropic-adaptive";
    }
    if (anthropicFamilyUsesExtendedThinking(id)) {
      return "anthropic-extended";
    }
    return "none";
  }
  if (provider === "openai" || id.startsWith("gpt-") || /^o\d/.test(id)) {
    return /^(gpt-5|o\d)/.test(id) ? "openai-reasoning" : "none";
  }
  if (provider === "gemini" || id.startsWith("gemini-")) {
    return /gemini-2\.5|gemini-3/.test(id) ? "gemini-thoughts" : "none";
  }
  if (provider === "deepseek" || id.includes("deepseek")) {
    return id.includes("reasoner") ? "parse-only" : "none";
  }
  return "none";
}

export function anthropicFamilyUsesAdaptiveThinking(model: string): boolean {
  return anthropicUsesAdaptiveThinking(model);
}

export function anthropicFamilyUsesExtendedThinking(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (!id.includes("claude")) {
    return false;
  }
  return !anthropicFamilyUsesAdaptiveThinking(id);
}

export function resolveProviderThinking(
  provider: LlmProvider,
  model: string,
  maxTokens: number
): ProviderThinkingOptions | undefined {
  const kind = inferThinkingKind(provider, model);
  switch (kind) {
    case "anthropic-adaptive":
      return { mode: "adaptive", effort: ANTHROPIC_ADAPTIVE_EFFORT };
    case "anthropic-extended": {
      const budgetTokens = resolveAnthropicThinkingBudget(maxTokens);
      if (!budgetTokens) {
        return undefined;
      }
      return { mode: "extended", budgetTokens };
    }
    case "openai-reasoning":
      return { mode: "openai-reasoning", effort: OPENAI_CHAT_REASONING_EFFORT };
    case "gemini-thoughts":
      return { mode: "gemini-thoughts" };
    case "parse-only":
    case "none":
      return undefined;
  }
}

export function missingCatalogThinkingIds(): string[] {
  return listCatalogModels()
    .map((entry) => entry.id)
    .filter((id) => CATALOG_THINKING_KIND[id] == null);
}

export { ANTHROPIC_THINKING_BUDGET_TOKENS };

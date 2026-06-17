import type { LlmProvider } from "../api/zeroRetentionConfig";

export type ModelTier = "budget" | "balanced" | "capable" | "flagship";

export type ModelDefinition = {
  id: string;
  provider: LlmProvider;
  /** Free-tier credit multiplier (1 = budget model). */
  creditWeight: number;
  tier: ModelTier;
  /** Short label for settings UI. */
  label: string;
};

const CATALOG: ModelDefinition[] = [
  // OpenAI — ordered default → capable → budget
  { id: "gpt-5.1", provider: "openai", creditWeight: 4, tier: "balanced", label: "GPT-5.1" },
  { id: "gpt-5.5", provider: "openai", creditWeight: 8, tier: "flagship", label: "GPT-5.5" },
  { id: "gpt-5-mini", provider: "openai", creditWeight: 1.5, tier: "budget", label: "GPT-5 mini" },
  { id: "gpt-4o-mini", provider: "openai", creditWeight: 1, tier: "budget", label: "GPT-4o mini" },
  // Anthropic
  { id: "claude-sonnet-4-6", provider: "anthropic", creditWeight: 4, tier: "balanced", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", provider: "anthropic", creditWeight: 10, tier: "flagship", label: "Claude Opus 4.8" },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    creditWeight: 1,
    tier: "budget",
    label: "Claude Haiku 4.5"
  },
  // Gemini
  { id: "gemini-2.5-flash", provider: "gemini", creditWeight: 1.5, tier: "balanced", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", provider: "gemini", creditWeight: 5, tier: "capable", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.0-flash", provider: "gemini", creditWeight: 1, tier: "budget", label: "Gemini 2.0 Flash" },
  // DeepSeek
  { id: "deepseek-chat", provider: "deepseek", creditWeight: 0.5, tier: "budget", label: "DeepSeek Chat" },
  { id: "deepseek-reasoner", provider: "deepseek", creditWeight: 2, tier: "capable", label: "DeepSeek Reasoner" }
];

const PROVIDER_DEFAULT_CREDIT_WEIGHT: Record<LlmProvider, number> = {
  openai: 4,
  anthropic: 4,
  gemini: 1.5,
  deepseek: 0.5
};

const catalogById = new Map(CATALOG.map((entry) => [entry.id.toLowerCase(), entry]));

/** Curated models per provider — same order as settings UI. */
export const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  anthropic: [],
  openai: [],
  gemini: [],
  deepseek: []
};

for (const entry of CATALOG) {
  MODELS_BY_PROVIDER[entry.provider].push(entry.id);
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.1",
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-chat"
};

/** Fast/cheap models for inline autocomplete. */
export const INLINE_DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.0-flash",
  deepseek: "deepseek-chat"
};

export function modelsForProvider(provider: LlmProvider): ModelDefinition[] {
  return CATALOG.filter((entry) => entry.provider === provider);
}

export function getModelDefinition(provider: LlmProvider, model: string): ModelDefinition | undefined {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return undefined;
  }
  const exact = catalogById.get(normalized);
  if (exact && exact.provider === provider) {
    return exact;
  }
  for (const entry of CATALOG) {
    if (entry.provider !== provider) {
      continue;
    }
    const id = entry.id.toLowerCase();
    if (normalized.startsWith(id) || id.startsWith(normalized)) {
      return entry;
    }
  }
  return undefined;
}

export function getModelCreditWeight(provider: LlmProvider, model: string): number {
  return getModelDefinition(provider, model)?.creditWeight ?? PROVIDER_DEFAULT_CREDIT_WEIGHT[provider] ?? 2;
}

export function formatModelCreditWeight(weight: number): string {
  if (weight === 1) {
    return "1× credits";
  }
  if (Number.isInteger(weight)) {
    return `${weight}× credits`;
  }
  return `${weight}× credits`;
}

export function formatModelOptionLabel(def: ModelDefinition): string {
  return `${def.label} · ${formatModelCreditWeight(def.creditWeight)}`;
}

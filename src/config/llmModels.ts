import type { LlmProvider } from "../api/zeroRetentionConfig";

export type ModelTier = "budget" | "balanced" | "capable" | "flagship";
export type ModelPool = "auto" | "frontier";

export type ModelDefinition = {
  id: string;
  provider: LlmProvider;
  /** Free-tier credit multiplier (1 = budget model). */
  creditWeight: number;
  tier: ModelTier;
  /** Short label for settings UI. */
  label: string;
  /** Maker docs page for this model (settings links). */
  docsUrl: string;
  /** One-sentence, customer-facing note for the picker hover card. */
  summary: string;
  /** Published context window in tokens. */
  contextWindowTokens: number;
  /** Which paid usage bar this model drains when the user picks it explicitly. */
  pool: ModelPool;
  /**
   * Approximate public list prices (USD per 1M tokens). Estimates for paid
   * Auto/Frontier cents only — not invoices. Free-tier quota still uses creditWeight.
   */
  usdPerMillionIn: number;
  usdPerMillionOut: number;
};

/** Fail-closed rates when the model is not in the catalog (Opus-class). */
export const UNKNOWN_MODEL_USD_PER_MILLION_IN = 15;
export const UNKNOWN_MODEL_USD_PER_MILLION_OUT = 75;

const CATALOG: ModelDefinition[] = [
  // OpenAI — ordered default → capable → budget
  {
    id: "gpt-5.1",
    provider: "openai",
    creditWeight: 4,
    tier: "balanced",
    label: "GPT-5.1",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.1",
    summary: "Strong coding and agentic model for everyday hard work.",
    contextWindowTokens: 400_000,
    pool: "frontier",
    usdPerMillionIn: 2,
    usdPerMillionOut: 8
  },
  {
    id: "gpt-5.5",
    provider: "openai",
    creditWeight: 8,
    tier: "flagship",
    label: "GPT-5.5",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-5.5",
    summary: "OpenAI’s flagship — best for the hardest reasoning and large edits.",
    contextWindowTokens: 400_000,
    pool: "frontier",
    usdPerMillionIn: 5,
    usdPerMillionOut: 15
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    creditWeight: 1.5,
    tier: "budget",
    label: "GPT-5 mini",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-5-mini",
    summary: "Fast, inexpensive GPT-5 for everyday chat and coding.",
    contextWindowTokens: 400_000,
    pool: "auto",
    usdPerMillionIn: 0.25,
    usdPerMillionOut: 2
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    creditWeight: 1,
    tier: "budget",
    label: "GPT-4o mini",
    docsUrl: "https://developers.openai.com/api/docs/models/gpt-4o-mini",
    summary: "Lightweight OpenAI model for quick, cheap answers.",
    contextWindowTokens: 128_000,
    pool: "auto",
    usdPerMillionIn: 0.15,
    usdPerMillionOut: 0.6
  },
  // Anthropic
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    creditWeight: 4,
    tier: "balanced",
    label: "Claude Sonnet 4.6",
    docsUrl: "https://www.anthropic.com/claude/sonnet",
    summary: "Anthropic’s workhorse — great for repo reasoning and careful edits.",
    contextWindowTokens: 1_000_000,
    pool: "frontier",
    usdPerMillionIn: 3,
    usdPerMillionOut: 15
  },
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    creditWeight: 10,
    tier: "flagship",
    label: "Claude Opus 4.8",
    docsUrl: "https://www.anthropic.com/claude/opus",
    summary: "Anthropic’s largest model, great for difficult tasks.",
    contextWindowTokens: 200_000,
    pool: "frontier",
    usdPerMillionIn: 15,
    usdPerMillionOut: 75
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    creditWeight: 1,
    tier: "budget",
    label: "Claude Haiku 4.5",
    docsUrl: "https://www.anthropic.com/claude/haiku",
    summary: "Fast, inexpensive Claude for short questions.",
    contextWindowTokens: 200_000,
    pool: "auto",
    usdPerMillionIn: 1,
    usdPerMillionOut: 5
  },
  // Gemini
  {
    id: "gemini-2.5-flash",
    provider: "gemini",
    creditWeight: 1.5,
    tier: "balanced",
    label: "Gemini 2.5 Flash",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash",
    summary: "Fast Gemini with a long context window.",
    contextWindowTokens: 1_000_000,
    pool: "auto",
    usdPerMillionIn: 0.15,
    usdPerMillionOut: 0.6
  },
  {
    id: "gemini-2.5-pro",
    provider: "gemini",
    creditWeight: 5,
    tier: "capable",
    label: "Gemini 2.5 Pro",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro",
    summary: "Google’s capable Gemini for deep reasoning over long context.",
    contextWindowTokens: 1_000_000,
    pool: "frontier",
    usdPerMillionIn: 1.25,
    usdPerMillionOut: 10
  },
  {
    id: "gemini-2.0-flash",
    provider: "gemini",
    creditWeight: 1,
    tier: "budget",
    label: "Gemini 2.0 Flash",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.0-flash",
    summary: "Fast, inexpensive Gemini for straightforward work.",
    contextWindowTokens: 1_000_000,
    pool: "auto",
    usdPerMillionIn: 0.1,
    usdPerMillionOut: 0.4
  },
  // DeepSeek
  {
    id: "deepseek-chat",
    provider: "deepseek",
    creditWeight: 0.5,
    tier: "budget",
    label: "DeepSeek Chat",
    docsUrl: "https://api-docs.deepseek.com/",
    summary: "Inexpensive general chat model.",
    contextWindowTokens: 128_000,
    pool: "auto",
    usdPerMillionIn: 0.28,
    usdPerMillionOut: 0.42
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    creditWeight: 2,
    tier: "capable",
    label: "DeepSeek Reasoner",
    docsUrl: "https://api-docs.deepseek.com/",
    summary: "DeepSeek’s reasoning model for harder problems.",
    contextWindowTokens: 128_000,
    pool: "frontier",
    usdPerMillionIn: 0.55,
    usdPerMillionOut: 2.19
  },
  // Mistral (FIM inline)
  {
    id: "codestral-latest",
    provider: "mistral",
    creditWeight: 0.5,
    tier: "budget",
    label: "Codestral",
    docsUrl: "https://docs.mistral.ai/capabilities/fim/",
    summary: "Mistral’s fill-in-the-middle model for inline autocomplete.",
    contextWindowTokens: 256_000,
    pool: "auto",
    usdPerMillionIn: 0.3,
    usdPerMillionOut: 0.9
  }
];

const PROVIDER_DEFAULT_CREDIT_WEIGHT: Record<LlmProvider, number> = {
  openai: 4,
  anthropic: 4,
  gemini: 1.5,
  deepseek: 0.5,
  mistral: 0.5
};

const catalogById = new Map(CATALOG.map((entry) => [entry.id.toLowerCase(), entry]));

/** Curated models per provider — same order as settings UI. */
export const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  anthropic: [],
  openai: [],
  gemini: [],
  deepseek: [],
  mistral: []
};

for (const entry of CATALOG) {
  MODELS_BY_PROVIDER[entry.provider].push(entry.id);
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.1",
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-chat",
  mistral: "codestral-latest"
};

/** Fast/cheap models for inline autocomplete — see `inlineModelPresets.ts`. */
export { INLINE_DEFAULT_MODEL_BY_PROVIDER } from "./inlineModelPresets";

export function listCatalogModels(): ModelDefinition[] {
  return CATALOG.slice();
}

/** Providers shown in the global chat picker. Mistral (Codestral) and DeepSeek stay assigned-only. */
export const PICKER_PROVIDER_GROUPS: Array<{
  provider: Extract<LlmProvider, "openai" | "anthropic" | "gemini">;
  label: string;
  docsUrl: string;
}> = [
  { provider: "openai", label: "OpenAI Models", docsUrl: "https://developers.openai.com/api/docs/models" },
  { provider: "anthropic", label: "Anthropic Models", docsUrl: "https://docs.claude.com/en/docs/about-claude/models" },
  { provider: "gemini", label: "Gemini Models", docsUrl: "https://ai.google.dev/gemini-api/docs/models" }
];

export function isPickerCatalogModel(entry: Pick<ModelDefinition, "provider">): boolean {
  return entry.provider === "openai" || entry.provider === "anthropic" || entry.provider === "gemini";
}

export function listPickerCatalogModels(): ModelDefinition[] {
  return CATALOG.filter(isPickerCatalogModel);
}

export function modelsForProvider(provider: LlmProvider): ModelDefinition[] {
  return CATALOG.filter((entry) => entry.provider === provider);
}

/** Budget model shown in settings — lowest credit weight per provider. */
export function lowestCreditModelForProvider(provider: LlmProvider): ModelDefinition {
  const models = modelsForProvider(provider);
  return models.reduce((min, entry) => (entry.creditWeight < min.creditWeight ? entry : min), models[0]);
}

export function getCatalogModelById(model: string): ModelDefinition | undefined {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return undefined;
  }
  const exact = catalogById.get(normalized);
  if (exact) {
    return exact;
  }
  for (const entry of CATALOG) {
    const id = entry.id.toLowerCase();
    if (normalized.startsWith(id) || id.startsWith(normalized)) {
      return entry;
    }
  }
  return undefined;
}

export function getModelDocsUrl(model: string): string | undefined {
  return getCatalogModelById(model)?.docsUrl;
}

export const AUTO_MODEL_INSIGHT = {
  label: "Auto",
  summary: "Coop picks a model per job — faster for everyday chat, stronger for /edit."
} as const;

export function formatContextWindowLabel(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}M context window`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k context window`;
  }
  return `${tokens} context window`;
}

export function getModelDefinition(provider: LlmProvider, model: string): ModelDefinition | undefined {
  const exact = getCatalogModelById(model);
  if (exact && exact.provider === provider) {
    return exact;
  }
  const normalized = model?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return undefined;
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

export function getModelPool(provider: LlmProvider, model: string): ModelPool {
  return getModelDefinition(provider, model)?.pool ?? getCatalogModelById(model)?.pool ?? "frontier";
}

export function isAutoModelSelection(model?: string | null): boolean {
  const normalized = model?.trim().toLowerCase() ?? "";
  return normalized === "" || normalized === "auto";
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
  return def.label;
}

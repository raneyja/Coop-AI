import type { LlmProvider } from "../api/zeroRetentionConfig";
import {
  getCatalogModelById,
  getModelCreditWeight,
  getModelDefinition,
  isAutoModelSelection,
  type ModelPool,
  UNKNOWN_MODEL_USD_PER_MILLION_IN,
  UNKNOWN_MODEL_USD_PER_MILLION_OUT
} from "./llmModels";

export {
  getModelCreditWeight,
  formatModelCreditWeight,
  formatModelOptionLabel,
  isAutoModelSelection,
  getModelPool,
  getCatalogModelById
} from "./llmModels";

export type UsageBucket = ModelPool;

export type BillTokensInput = {
  inputTokens: number;
  outputTokens: number;
  provider: LlmProvider;
  model: string;
  visionWeighted?: boolean;
  visionMultiplier?: number;
};

export type BillTokensResult = {
  rawTokens: number;
  billedTokens: number;
  modelWeight: number;
  visionMultiplier: number;
};

export function billTokensForQuota(input: BillTokensInput): BillTokensResult {
  const rawTokens = Math.max(0, input.inputTokens) + Math.max(0, input.outputTokens);
  const modelWeight = getModelCreditWeight(input.provider, input.model);
  const visionMultiplier = input.visionWeighted ? Math.max(1, input.visionMultiplier ?? 2) : 1;
  const billedTokens = Math.ceil(rawTokens * modelWeight * visionMultiplier);
  return { rawTokens, billedTokens, modelWeight, visionMultiplier };
}

export type BillUsdCentsInput = {
  inputTokens: number;
  outputTokens: number;
  provider: LlmProvider;
  model: string;
  visionWeighted?: boolean;
  visionMultiplier?: number;
};

export type BillUsdCentsResult = {
  usdCents: number;
  usdPerMillionIn: number;
  usdPerMillionOut: number;
  visionMultiplier: number;
};

export function billUsdCents(input: BillUsdCentsInput): BillUsdCentsResult {
  const definition =
    getModelDefinition(input.provider, input.model) ?? getCatalogModelById(input.model);
  const usdPerMillionIn = definition?.usdPerMillionIn ?? UNKNOWN_MODEL_USD_PER_MILLION_IN;
  const usdPerMillionOut = definition?.usdPerMillionOut ?? UNKNOWN_MODEL_USD_PER_MILLION_OUT;
  const visionMultiplier = input.visionWeighted ? Math.max(1, input.visionMultiplier ?? 2) : 1;
  const inputTokens = Math.max(0, input.inputTokens) * visionMultiplier;
  const outputTokens = Math.max(0, input.outputTokens) * visionMultiplier;
  const usd = (inputTokens / 1_000_000) * usdPerMillionIn + (outputTokens / 1_000_000) * usdPerMillionOut;
  const usdCents = usd <= 0 ? 0 : Math.max(1, Math.ceil(usd * 100));
  return { usdCents, usdPerMillionIn, usdPerMillionOut, visionMultiplier };
}

export type ClassifyRequestBucketInput = {
  /** User picker value (`auto`, empty, or a catalog id). */
  selection?: string | null;
  provider: LlmProvider;
  resolvedModel: string;
  /** Autocomplete / intent / evidence / PR notes always bill Auto. */
  forceAutoBucket?: boolean;
};

/**
 * Auto selection (or operator side-paths) always bills the Auto bar — even when
 * the assignment is Sonnet or GPT-5.1. Explicit catalog picks follow `pool`.
 * Unknown models are Frontier (fail closed).
 */
export function classifyRequestBucket(input: ClassifyRequestBucketInput): UsageBucket {
  if (input.forceAutoBucket || isAutoModelSelection(input.selection)) {
    return "auto";
  }
  const definition =
    getModelDefinition(input.provider, input.resolvedModel) ?? getCatalogModelById(input.resolvedModel);
  return definition?.pool ?? "frontier";
}

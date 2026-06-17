import type { LlmProvider } from "../api/zeroRetentionConfig";
import { getModelCreditWeight } from "./llmModels";

export { getModelCreditWeight, formatModelCreditWeight, formatModelOptionLabel } from "./llmModels";

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

import assert from "node:assert/strict";
import { billTokensForQuota } from "./modelCreditWeights";
import { formatModelOptionLabel, getModelCreditWeight, modelsForProvider } from "./llmModels";

void (async () => {
  for (const provider of ["openai", "anthropic", "gemini", "deepseek"] as const) {
    const models = modelsForProvider(provider);
    assert.ok(models.length >= 2, `${provider} should list multiple models`);
    for (const def of models) {
      assert.equal(getModelCreditWeight(provider, def.id), def.creditWeight);
      assert.match(formatModelOptionLabel(def), /× credits/);
    }
  }

  assert.equal(getModelCreditWeight("openai", "gpt-5-mini"), 1.5);
  assert.equal(getModelCreditWeight("anthropic", "claude-sonnet-4-6"), 4);
  assert.equal(getModelCreditWeight("gemini", "gemini-2.5-pro"), 5);
  assert.equal(getModelCreditWeight("deepseek", "deepseek-chat"), 0.5);
  assert.equal(getModelCreditWeight("anthropic", "unknown-model"), 4);

  const mini = billTokensForQuota({
    inputTokens: 1000,
    outputTokens: 500,
    provider: "openai",
    model: "gpt-5-mini"
  });
  assert.equal(mini.billedTokens, 2250);

  const sonnet = billTokensForQuota({
    inputTokens: 1000,
    outputTokens: 500,
    provider: "anthropic",
    model: "claude-sonnet-4-6"
  });
  assert.equal(sonnet.billedTokens, 6000);
  assert.ok(sonnet.billedTokens > mini.billedTokens);

  console.log("modelCreditWeights: 1/1 tests passed");
})();

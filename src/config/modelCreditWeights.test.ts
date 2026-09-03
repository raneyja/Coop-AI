import assert from "node:assert/strict";
import { billTokensForQuota, billUsdCents, classifyRequestBucket } from "./modelCreditWeights";
import {
  formatModelOptionLabel,
  getModelCreditWeight,
  getModelPool,
  listCatalogModels,
  listPickerCatalogModels,
  lowestCreditModelForProvider,
  modelsForProvider,
  formatContextWindowLabel
} from "./llmModels";

void (async () => {
  for (const provider of ["openai", "anthropic", "gemini", "deepseek"] as const) {
    const models = modelsForProvider(provider);
    assert.ok(models.length >= 2, `${provider} should list multiple models`);
    for (const def of models) {
      assert.equal(getModelCreditWeight(provider, def.id), def.creditWeight);
      assert.equal(formatModelOptionLabel(def), def.label);
    }
  }

  assert.equal(lowestCreditModelForProvider("openai").id, "gpt-4o-mini");
  assert.equal(lowestCreditModelForProvider("gemini").id, "gemini-2.0-flash");
  assert.equal(lowestCreditModelForProvider("deepseek").id, "deepseek-chat");

  assert.equal(getModelCreditWeight("openai", "gpt-5-mini"), 1.5);
  assert.equal(getModelCreditWeight("anthropic", "claude-sonnet-4-6"), 4);
  assert.equal(getModelCreditWeight("gemini", "gemini-2.5-pro"), 5);
  assert.equal(getModelCreditWeight("deepseek", "deepseek-chat"), 0.5);
  assert.equal(getModelCreditWeight("anthropic", "unknown-model"), 4);

  const autoIds = [
    "gpt-4o-mini",
    "gpt-5-mini",
    "claude-haiku-4-5-20251001",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "deepseek-chat",
    "codestral-latest"
  ];
  const frontierIds = [
    "gpt-5.1",
    "gpt-5.5",
    "claude-sonnet-4-6",
    "claude-opus-4-8",
    "gemini-2.5-pro",
    "deepseek-reasoner"
  ];
  for (const id of autoIds) {
    const entry = listCatalogModels().find((model) => model.id === id);
    assert.ok(entry, `missing catalog row ${id}`);
    assert.equal(entry.pool, "auto", `${id} should be auto pool`);
    assert.equal(getModelPool(entry.provider, id), "auto");
  }
  for (const id of frontierIds) {
    const entry = listCatalogModels().find((model) => model.id === id);
    assert.ok(entry, `missing catalog row ${id}`);
    assert.equal(entry.pool, "frontier", `${id} should be frontier pool`);
    assert.equal(getModelPool(entry.provider, id), "frontier");
  }
  assert.equal(listCatalogModels().length, autoIds.length + frontierIds.length);
  const picker = listPickerCatalogModels();
  assert.ok(picker.every((entry) => ["openai", "anthropic", "gemini"].includes(entry.provider)));
  assert.equal(
    picker.some((entry) => entry.id === "codestral-latest" || entry.provider === "deepseek"),
    false
  );
  for (const entry of listCatalogModels()) {
    assert.ok(entry.docsUrl.startsWith("https://"), `${entry.id} needs a maker docs URL`);
    assert.ok(entry.summary.trim().length > 12, `${entry.id} needs a short picker summary`);
    assert.ok(entry.contextWindowTokens >= 32_000, `${entry.id} needs a context window`);
  }
  assert.equal(formatContextWindowLabel(128_000), "128k context window");
  assert.equal(formatContextWindowLabel(1_000_000), "1M context window");

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

  const miniCents = billUsdCents({
    inputTokens: 1_000_000,
    outputTokens: 0,
    provider: "openai",
    model: "gpt-5-mini"
  });
  assert.equal(miniCents.usdCents, 25);

  const opusCents = billUsdCents({
    inputTokens: 1_000_000,
    outputTokens: 0,
    provider: "anthropic",
    model: "claude-opus-4-8"
  });
  assert.equal(opusCents.usdCents, 1500);
  assert.ok(opusCents.usdCents > miniCents.usdCents);

  const unknownCents = billUsdCents({
    inputTokens: 1_000_000,
    outputTokens: 0,
    provider: "anthropic",
    model: "unknown-opus-clone"
  });
  assert.equal(unknownCents.usdCents, 1500);

  const tiny = billUsdCents({
    inputTokens: 10,
    outputTokens: 0,
    provider: "openai",
    model: "gpt-4o-mini"
  });
  assert.equal(tiny.usdCents, 1);

  assert.equal(
    classifyRequestBucket({
      selection: "auto",
      provider: "anthropic",
      resolvedModel: "claude-sonnet-4-6"
    }),
    "auto"
  );
  assert.equal(
    classifyRequestBucket({
      selection: "",
      provider: "openai",
      resolvedModel: "gpt-5.1"
    }),
    "auto"
  );
  assert.equal(
    classifyRequestBucket({
      selection: "claude-opus-4-8",
      provider: "anthropic",
      resolvedModel: "claude-opus-4-8"
    }),
    "frontier"
  );
  assert.equal(
    classifyRequestBucket({
      selection: "gpt-5-mini",
      provider: "openai",
      resolvedModel: "gpt-5-mini"
    }),
    "auto"
  );
  assert.equal(
    classifyRequestBucket({
      selection: "claude-opus-4-8",
      provider: "anthropic",
      resolvedModel: "claude-opus-4-8",
      forceAutoBucket: true
    }),
    "auto"
  );
  assert.equal(
    classifyRequestBucket({
      selection: "mystery-model",
      provider: "openai",
      resolvedModel: "mystery-model"
    }),
    "frontier"
  );

  console.log("modelCreditWeights: 1/1 tests passed");
})();

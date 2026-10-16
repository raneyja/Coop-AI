import assert from "node:assert/strict";
import test from "node:test";
import { estimateCostUsd } from "./costEstimate";
import { billUsdCents } from "../config/modelCreditWeights";
import { resolveUsage, type ParseState } from "./providers/baseClient";
import { parseOpenAiSseLine } from "./providers/openaiClient";

test("GPT-5.5 provider usage and quota share the standard output rate", () => {
  const state = { text: "visible" } as ParseState;
  parseOpenAiSseLine('data: {"usage":{"prompt_tokens":1000,"completion_tokens":2000,"completion_tokens_details":{"reasoning_tokens":1999}},"choices":[]}', state);
  const usage = resolveUsage("openai", { model: "gpt-5.5", messages: [], temperature: 0.5, maxTokens: 32768, requestId: "pricing-control" }, state);
  assert.equal(usage.estimatedCostUsd, 0.065);
  const quota = billUsdCents({ provider: "openai", model: "gpt-5.5", inputTokens: 1000, outputTokens: 2000 });
  assert.equal(quota.estimatedUsd, usage.estimatedCostUsd);
  assert.equal(quota.usdPerMillionOut, 30);
});

test("long-context rates start above 272k actual input tokens and cover all output", () => {
  const cost = (inputTokens: number) => billUsdCents({ provider: "openai", model: "gpt-5.5", inputTokens, outputTokens: 1000 });
  assert.equal(cost(272000).usdPerMillionIn, 5);
  assert.equal(cost(272000).usdPerMillionOut, 30);
  assert.equal(cost(272001).usdPerMillionIn, 10);
  assert.equal(cost(272001).usdPerMillionOut, 45);
  assert.equal(cost(272001).estimatedUsd, estimateCostUsd("openai", 272001, 1000, "gpt-5.5"));
  assert.equal(billUsdCents({ provider: "openai", model: "gpt-5.5", inputTokens: 200000, outputTokens: 1000,
    visionWeighted: true, visionMultiplier: 2 }).usdPerMillionIn, 5);
});

test("precise usage estimates retain sub-cent costs and unknown price bases stay explicit", () => {
  assert.equal(estimateCostUsd("openai", 1, 1, "gpt-5.5"), 0.000035);
  assert.equal(billUsdCents({ provider: "openai", model: "gpt-5.5", inputTokens: 1, outputTokens: 1 }).usdCents, 1);
  assert.equal(estimateCostUsd("openai", 1000, 1000, "unknown-model"), 0.09);
  assert.equal(billUsdCents({ provider: "openai", model: "unknown-model", inputTokens: 1, outputTokens: 1 }).pricingKnown, false);
  assert.equal(estimateCostUsd("openai", 0, 0, "gpt-5.5"), 0);
});

test("pricing rejects prefix aliases and foreign provider identities", () => {
  for (const model of ["gpt-5.5-pro", "gpt-5.5-arbitrary", "gpt-5.5-2027-01-01"]) {
    assert.equal(billUsdCents({ provider: "openai", model, inputTokens: 1, outputTokens: 1 }).pricingKnown, false);
  }
  assert.equal(billUsdCents({ provider: "anthropic", model: "gpt-5.5", inputTokens: 1, outputTokens: 1 }).pricingKnown, false);
  const snapshot = billUsdCents({ provider: "openai", model: "gpt-5.5-2026-04-23", inputTokens: 272001, outputTokens: 1 });
  assert.equal(snapshot.pricingKnown, true);
  assert.equal(snapshot.usdPerMillionIn, 10);
  assert.equal(snapshot.usdPerMillionOut, 45);
});

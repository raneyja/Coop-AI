import assert from "node:assert/strict";
import test from "node:test";
import { formatZeroRetentionRequest } from "../requestFormatter";
import { resolveProviderThinking } from "../../config/modelThinking";
import { listCatalogModels, listPickerCatalogModels } from "../../config/llmModels";
import { buildAnthropicInferenceBody } from "./anthropicClient";
import { applyOpenAiThinking } from "./openaiClient";
import { applyGeminiThinking } from "./geminiClient";
import type { LlmProvider } from "../zeroRetentionConfig";

/**
 * User-facing answers all go through `/v1/chat` with `enableThinking: true`:
 * plain chat, /edit, agent answers, quick actions, slash aliases, integration slash.
 * Classifiers stay thinking-off: intent chips, sources preview, PR notes, agent tool plan.
 * This file locks the *request body* those paths would send — not live provider calls.
 */
const THINKING_ON_TEMPERATURES = [0, 0.2, 0.5, 1];
const THINKING_OFF_TEMPERATURES = [0, 0.2, 0.5, 1];
const MAX_TOKENS = 16_000;
const MESSAGES = [
  { role: "system" as const, content: "You are helpful." },
  { role: "user" as const, content: "Hello" }
];

function formattedChatBody(
  provider: LlmProvider,
  model: string,
  temperature: number
): Record<string, unknown> {
  return formatZeroRetentionRequest({
    provider,
    model,
    messages: MESSAGES,
    temperature,
    maxTokens: MAX_TOKENS,
    allowUnapprovedProvider: true
  }).body;
}

function inferenceBody(options: {
  provider: LlmProvider;
  model: string;
  temperature: number;
  enableThinking: boolean;
}): Record<string, unknown> {
  const formatted = formattedChatBody(options.provider, options.model, options.temperature);
  const thinking = options.enableThinking
    ? resolveProviderThinking(options.provider, options.model, MAX_TOKENS)
    : undefined;
  if (options.provider === "anthropic") {
    return buildAnthropicInferenceBody({
      formattedBody: formatted,
      model: options.model,
      maxTokens: MAX_TOKENS,
      thinking
    });
  }
  if (options.provider === "openai") {
    return applyOpenAiThinking(formatted, thinking);
  }
  if (options.provider === "gemini") {
    return applyGeminiThinking(formatted, thinking);
  }
  return formatted;
}

test("every picker model × thinking-on (chat /edit QA slash) sends legal temperature", () => {
  for (const entry of listPickerCatalogModels()) {
    for (const temperature of THINKING_ON_TEMPERATURES) {
      const body = inferenceBody({
        provider: entry.provider,
        model: entry.id,
        temperature,
        enableThinking: true
      });
      assertProviderConstraints(entry.provider, entry.id, body, { enableThinking: true, requestedTemperature: temperature });
    }
  }
});

test("every picker model × thinking-off (intent / PR notes / planner) keeps a legal body", () => {
  for (const entry of listPickerCatalogModels()) {
    for (const temperature of THINKING_OFF_TEMPERATURES) {
      const body = inferenceBody({
        provider: entry.provider,
        model: entry.id,
        temperature,
        enableThinking: false
      });
      assertProviderConstraints(entry.provider, entry.id, body, {
        enableThinking: false,
        requestedTemperature: temperature
      });
    }
  }
});

test("assigned-only DeepSeek chat models omit temperature on Reasoner only", () => {
  const chat = inferenceBody({
    provider: "deepseek",
    model: "deepseek-chat",
    temperature: 0.5,
    enableThinking: true
  });
  assert.equal(chat.temperature, 0.5);
  assert.equal("thinking" in chat, false);

  const reasoner = inferenceBody({
    provider: "deepseek",
    model: "deepseek-reasoner",
    temperature: 0.5,
    enableThinking: true
  });
  assert.equal("temperature" in reasoner, false);
});

test("catalog chat models are covered by thinking contracts (Codestral stays FIM-only)", () => {
  const chatModels = listCatalogModels().filter((entry) => entry.provider !== "mistral");
  assert.ok(chatModels.length >= 10);
  for (const entry of chatModels) {
    const thinkingOn = inferenceBody({
      provider: entry.provider,
      model: entry.id,
      temperature: 0.5,
      enableThinking: true
    });
    assertProviderConstraints(entry.provider, entry.id, thinkingOn, {
      enableThinking: true,
      requestedTemperature: 0.5
    });
  }
});

function assertProviderConstraints(
  provider: LlmProvider,
  model: string,
  body: Record<string, unknown>,
  options: { enableThinking: boolean; requestedTemperature: number }
): void {
  const label = `${provider}:${model} thinking=${options.enableThinking} temp=${options.requestedTemperature}`;
  if (provider === "anthropic") {
    const thinking = body.thinking as { type?: string } | undefined;
    if (options.enableThinking) {
      assert.ok(thinking?.type === "adaptive" || thinking?.type === "enabled", `${label} missing thinking`);
      assert.equal(body.temperature, 1, `${label} must send temperature 1`);
    } else {
      assert.equal(thinking, undefined, `${label} must not send thinking`);
      assert.equal(body.temperature, options.requestedTemperature, `${label} must keep requested temperature`);
    }
    return;
  }
  if (provider === "openai") {
    if (/^(gpt-5|o\d)/.test(model)) {
      assert.equal("temperature" in body, false, `${label} GPT-5 must omit temperature`);
      if (options.enableThinking) {
        assert.equal(body.reasoning_effort, "medium", `${label} missing reasoning_effort`);
      } else {
        assert.equal("reasoning_effort" in body, false, `${label} must not send reasoning_effort`);
      }
    } else {
      assert.equal(body.temperature, options.requestedTemperature, `${label} must keep temperature`);
      assert.equal("reasoning_effort" in body, false, `${label} must not send reasoning_effort`);
    }
    return;
  }
  if (provider === "gemini") {
    const generationConfig = body.generationConfig as
      | { temperature?: number; thinkingConfig?: { includeThoughts?: boolean } }
      | undefined;
    assert.equal(generationConfig?.temperature, options.requestedTemperature, `${label} Gemini temperature`);
    if (options.enableThinking && /gemini-2\.5|gemini-3/.test(model)) {
      assert.equal(generationConfig?.thinkingConfig?.includeThoughts, true, `${label} missing thoughts`);
    } else {
      assert.equal(generationConfig?.thinkingConfig, undefined, `${label} must not send thinkingConfig`);
    }
    return;
  }
  if (provider === "deepseek") {
    if (model.toLowerCase().includes("reasoner")) {
      assert.equal("temperature" in body, false, `${label} Reasoner must omit temperature`);
    } else {
      assert.equal(body.temperature, options.requestedTemperature, `${label} must keep temperature`);
    }
    return;
  }
  throw new Error(`unexpected chat provider ${provider}`);
}

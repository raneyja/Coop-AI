import assert from "node:assert/strict";
import {
  ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT,
  formatZeroRetentionRequest,
  injectZeroRetentionSystemPrompt,
  type ChatRequestMessage
} from "./requestFormatter";

const baseMessages = [
  { role: "system" as const, content: "You are helpful." },
  { role: "user" as const, content: "Hello" }
];

function countPreamble(text: string): number {
  return text.split(ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT).length - 1;
}

function systemTextFor(provider: "openai" | "anthropic" | "gemini", messages: ChatRequestMessage[]): string {
  const body = formatZeroRetentionRequest({
    provider,
    model: provider === "anthropic" ? "claude-sonnet-4-6" : provider === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini",
    messages,
    allowUnapprovedProvider: true
  }).body;
  if (provider === "anthropic") {
    return String(body.system ?? "");
  }
  if (provider === "gemini") {
    const parts = (body.systemInstruction as { parts?: Array<{ text?: string }> }).parts ?? [];
    return parts.map((part) => part.text ?? "").join("\n");
  }
  const messagesOut = body.messages as Array<{ role: string; content: unknown }>;
  const system = messagesOut.find((message) => message.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}

// B1: injectZeroRetentionSystemPrompt is the sole owner of the preamble — exactly one copy per provider body.
for (const provider of ["openai", "anthropic", "gemini"] as const) {
  assert.equal(countPreamble(systemTextFor(provider, baseMessages)), 1, `${provider} should carry exactly one preamble`);
}

// B1: idempotency — a system message that already starts with the preamble is not prefixed again.
const preInjected: ChatRequestMessage[] = [
  { role: "system", content: `${ENTERPRISE_CONFIDENTIAL_SYSTEM_PROMPT}\n\nYou are helpful.` },
  { role: "user", content: "Hello" }
];
const injectedOnce = injectZeroRetentionSystemPrompt(preInjected);
assert.equal(countPreamble(injectedOnce[0].content), 1);
for (const provider of ["openai", "anthropic", "gemini"] as const) {
  assert.equal(countPreamble(systemTextFor(provider, preInjected)), 1, `${provider} idempotent preamble`);
}

// B1: inline chat-fallback builds system content without the preamble (ModelRouter.buildChatSystemContent),
// so formatting still yields exactly one copy.
const inlineFallback: ChatRequestMessage[] = [
  { role: "system", content: "You are a code completion engine." },
  { role: "user", content: "complete this" }
];
assert.equal(countPreamble(systemTextFor("openai", inlineFallback)), 1);

function anthropicBody(userId?: string): Record<string, unknown> {
  return formatZeroRetentionRequest({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    messages: baseMessages,
    userId,
    allowUnapprovedProvider: true
  }).body;
}

assert.equal("retention_policy" in anthropicBody(), false);
assert.equal("usage_type" in anthropicBody(), false);

// B4: the standard zero-retention headers describe all code-intelligence inference, not just completion.
const anthropicHeaders = formatZeroRetentionRequest({
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  messages: baseMessages,
  allowUnapprovedProvider: true
}).headers;
assert.equal(anthropicHeaders["x-use-case"], "code-intelligence-inference");

const metadata = anthropicBody().metadata as Record<string, unknown> | undefined;
assert.equal(metadata, undefined);

const withUser = anthropicBody("user-abc-123").metadata as Record<string, unknown>;
assert.deepEqual(withUser, { user_id: "user-abc-123" });
assert.equal("usage_type" in withUser, false);
assert.equal("data_classification" in withUser, false);

const gpt5Body = formatZeroRetentionRequest({
  provider: "openai",
  model: "gpt-5-mini",
  messages: baseMessages,
  maxTokens: 8192,
  allowUnapprovedProvider: true
}).body;
assert.equal("max_tokens" in gpt5Body, false);
assert.equal("temperature" in gpt5Body, false);
assert.equal(gpt5Body.max_completion_tokens, 8192 + 4096);

const gpt4oBody = formatZeroRetentionRequest({
  provider: "openai",
  model: "gpt-4o-mini",
  messages: baseMessages,
  temperature: 0.5,
  allowUnapprovedProvider: true
}).body;
assert.equal(gpt4oBody.temperature, 0.5);

const deepseekChatBody = formatZeroRetentionRequest({
  provider: "deepseek",
  model: "deepseek-chat",
  messages: baseMessages,
  temperature: 0.5,
  allowUnapprovedProvider: true
}).body;
assert.equal(deepseekChatBody.temperature, 0.5);

const deepseekReasonerBody = formatZeroRetentionRequest({
  provider: "deepseek",
  model: "deepseek-reasoner",
  messages: baseMessages,
  temperature: 0.5,
  allowUnapprovedProvider: true
}).body;
assert.equal("temperature" in deepseekReasonerBody, false);

const plannerBody = formatZeroRetentionRequest({
  provider: "openai",
  model: "gpt-5-mini",
  messages: baseMessages,
  maxTokens: 600,
  allowUnapprovedProvider: true
}).body;
assert.equal(plannerBody.max_completion_tokens, 600);

{
  const body = [
    "# Copyright (c) 2023-present Plane Software, Inc. and contributors",
    "",
    "class APIKeyAuthentication:",
    "    def authenticate(self, request):",
    "        return True"
  ].join("\n");
  const numbered = body.split("\n").map((row, i) => `${i + 1}|${row}`).join("\n");
  const toolJson = JSON.stringify({
    path: "apps/api/plane/api/middleware/api_authentication.py",
    startLine: 1,
    files: [
      {
        path: "apps/api/plane/api/middleware/api_authentication.py",
        content: numbered
      }
    ]
  });
  const formatted = formatZeroRetentionRequest({
    provider: "openai",
    model: "gpt-5-mini",
    messages: [
      { role: "user", content: "Where is APIKeyAuthentication defined?" },
      { role: "assistant", content: JSON.stringify({ tool: "read_file" }) },
      { role: "user", content: toolJson }
    ],
    allowUnapprovedProvider: true
  });
  const messagesOut = formatted.body.messages as Array<{ role: string; content: unknown }>;
  const toolResult = messagesOut.find(
    (message) => message.role === "user" && String(message.content).includes("api_authentication.py")
  );
  const text = String(toolResult?.content ?? "");
  assert.ok(text.includes("class APIKeyAuthentication:"), "LLM request must keep the class after sanitization");
  assert.equal(text.includes("REDACTED_SENSITIVE_COMMENT"), false);
}

console.log("requestFormatter.test.ts: ok");

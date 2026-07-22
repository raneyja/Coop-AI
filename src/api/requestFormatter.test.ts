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

const metadata = anthropicBody().metadata as Record<string, unknown> | undefined;
assert.equal(metadata, undefined);

const withUser = anthropicBody("user-abc-123").metadata as Record<string, unknown>;
assert.deepEqual(withUser, { user_id: "user-abc-123" });
assert.equal("usage_type" in withUser, false);
assert.equal("data_classification" in withUser, false);

console.log("requestFormatter.test.ts: ok");

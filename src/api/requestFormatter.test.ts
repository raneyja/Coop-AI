import assert from "node:assert/strict";
import { formatZeroRetentionRequest } from "./requestFormatter";

const baseMessages = [
  { role: "system" as const, content: "You are helpful." },
  { role: "user" as const, content: "Hello" }
];

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

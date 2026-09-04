import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { BitbucketWebhookHandler, verifyBitbucketSignature } from "./bitbucketWebhookHandler";
import { WebhookMonitor } from "../webhookMonitor";

test("verifyBitbucketSignature rejects missing secret", () => {
  const result = verifyBitbucketSignature(undefined, Buffer.from("{}"), undefined);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing Bitbucket webhook secret");
});

test("verifyBitbucketSignature rejects bad signature when secret set", () => {
  const body = Buffer.from('{"repository":{"full_name":"acme/app"}}');
  assert.equal(verifyBitbucketSignature("sha256=deadbeef", body, "secret").ok, false);
});

test("BitbucketWebhookHandler accepts repo:push", async () => {
  const monitor = new WebhookMonitor();
  const events: unknown[] = [];
  const handler = new BitbucketWebhookHandler({
    secret: "test-secret",
    monitor,
    queue: {
      enqueue: async (event) => {
        events.push(event);
      }
    }
  });
  const bodyObj = {
    repository: { full_name: "acme/app", mainbranch: { name: "main" } },
    push: {
      changes: [
        {
          new: { name: "main" },
          commits: [{ hash: "abc123", message: "hi", date: "2026-01-01T00:00:00Z", author: { raw: "Ada" } }]
        }
      ]
    }
  };
  const rawBody = Buffer.from(JSON.stringify(bodyObj));
  const signature = createHmac("sha256", "test-secret").update(rawBody).digest("hex");
  const result = await handler.handle({
    headers: {
      "x-event-key": "repo:push",
      "x-request-uuid": "delivery-1",
      "x-hub-signature": `sha256=${signature}`
    },
    rawBody,
    body: bodyObj
  });
  assert.equal(result.accepted, true);
  assert.equal(result.statusCode, 202);
  assert.equal(events.length, 1);
});

test("BitbucketWebhookHandler rejects when secret is unset", async () => {
  const handler = new BitbucketWebhookHandler({
    monitor: new WebhookMonitor(),
    queue: { enqueue: async () => undefined }
  });
  const result = await handler.handle({
    headers: { "x-event-key": "repo:push", "x-request-uuid": "delivery-unsigned" },
    rawBody: Buffer.from("{}"),
    body: {}
  });
  assert.equal(result.accepted, false);
  assert.equal(result.statusCode, 401);
  assert.match(result.message, /missing Bitbucket webhook secret/);
});

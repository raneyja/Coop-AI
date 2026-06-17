import assert from "node:assert/strict";
import { shouldBypassIndexRateLimit, shouldRateLimitIndexRepository } from "./orgApi";

void (async () => {
  assert.equal(shouldRateLimitIndexRepository(undefined), false);
  assert.equal(shouldRateLimitIndexRepository({ indexStatus: "idle" }), false);
  assert.equal(shouldRateLimitIndexRepository({ indexStatus: "queued" }), false);
  assert.equal(shouldRateLimitIndexRepository({ indexStatus: "indexing" }), false);
  assert.equal(shouldRateLimitIndexRepository({ indexStatus: "error" }), false);
  assert.equal(shouldRateLimitIndexRepository({ indexStatus: "disabled" }), false);
  assert.equal(shouldRateLimitIndexRepository({ indexStatus: "ready" }), true);

  assert.equal(shouldBypassIndexRateLimit({ indexStatus: "ready", embeddingStatus: "failed" }), true);
  assert.equal(shouldBypassIndexRateLimit({ indexStatus: "ready", embeddingStatus: "complete" }, { orgAdmin: true }), true);
  assert.equal(shouldBypassIndexRateLimit({ indexStatus: "ready", embeddingStatus: "complete" }), false);

  console.log("orgApiIndexRateLimit: 1/1 tests passed");
})();

import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_RATE_LIMIT_MAX,
  authClientKey,
  consumeAuthRateLimit,
  resetAuthRateLimitForTests
} from "./authRateLimit";

test("consumeAuthRateLimit allows until the window is exhausted", () => {
  resetAuthRateLimitForTests();
  const key = "test-ip|user@example.com";
  for (let i = 0; i < AUTH_RATE_LIMIT_MAX; i++) {
    assert.equal(consumeAuthRateLimit(key), true);
  }
  assert.equal(consumeAuthRateLimit(key), false);
});

test("authClientKey combines forwarded IP and email", () => {
  assert.equal(
    authClientKey({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }, "User@Example.com"),
    "1.2.3.4|user@example.com"
  );
});

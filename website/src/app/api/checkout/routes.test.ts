import assert from "node:assert/strict";
import test from "node:test";

import { POST as checkout } from "./route";
import { GET as checkoutStatus } from "../checkout-status/route";

const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalApiBase = process.env.COOP_API_BASE;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalApiBase === undefined) delete process.env.COOP_API_BASE;
  else process.env.COOP_API_BASE = originalApiBase;
});

test("checkout uses the production API default and converts network failures to 502", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.VERCEL_ENV;
  delete process.env.COOP_API_BASE;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    throw new Error("DNS failure");
  };

  const response = await checkout(
    new Request("https://coop-ai.dev/api/checkout", {
      method: "POST",
      body: JSON.stringify({ email: "buyer@example.com" })
    })
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "Checkout unavailable" });
  assert.equal(requestedUrl, "https://api.coop-ai.dev/v1/billing/checkout-session");
});

test("checkout status converts network failures to a bounded JSON error", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.VERCEL_ENV;
  delete process.env.COOP_API_BASE;
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };

  const response = await checkoutStatus(
    new Request("https://coop-ai.dev/api/checkout-status?session_id=cs_test")
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    status: "unavailable",
    message: "Checkout status unavailable"
  });
});

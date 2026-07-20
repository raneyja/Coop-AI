import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_PORTAL_URL,
  assertSafePublicEmailUrl,
  isLocalhostUrl,
  isProductionApiHost,
  resolveAdminPortalUrl,
  resolveMarketingBaseUrl,
  resolvePublicUrl
} from "./publicUrls";
import { MARKETING_SITE_URL } from "./siteConfig";

test("isLocalhostUrl detects localhost and 127.0.0.1", () => {
  assert.equal(isLocalhostUrl("http://localhost:3001"), true);
  assert.equal(isLocalhostUrl("http://127.0.0.1:8787"), true);
  assert.equal(isLocalhostUrl("https://coop-ai.dev"), false);
});

test("isProductionApiHost detects deployed API hosts", () => {
  assert.equal(isProductionApiHost("https://api.coop-ai.dev"), true);
  assert.equal(isProductionApiHost("http://localhost:8787"), false);
});

test("resolveMarketingBaseUrl ignores localhost env on production API", () => {
  const url = resolveMarketingBaseUrl(
    { COOP_MARKETING_BASE_URL: "http://localhost:3001" },
    "https://api.coop-ai.dev"
  );
  assert.equal(url, MARKETING_SITE_URL);
});

test("resolveAdminPortalUrl ignores localhost env on production API", () => {
  const url = resolveAdminPortalUrl(
    { COOP_ADMIN_PORTAL_URL: "http://localhost:3001" },
    "https://api.coop-ai.dev"
  );
  assert.equal(url, ADMIN_PORTAL_URL);
});

test("resolveMarketingBaseUrl keeps localhost env for local API", () => {
  const url = resolveMarketingBaseUrl(
    { COOP_MARKETING_BASE_URL: "http://localhost:3001" },
    "http://localhost:8787"
  );
  assert.equal(url, "http://localhost:3001");
});

test("resolvePublicUrl uses production default when env unset on production API", () => {
  const url = resolvePublicUrl(undefined, "https://api.coop-ai.dev", "https://coop-ai.dev/welcome");
  assert.equal(url, "https://coop-ai.dev/welcome");
});

test("assertSafePublicEmailUrl allows https coop hosts on production API", () => {
  assert.doesNotThrow(() =>
    assertSafePublicEmailUrl("https://admin.coop-ai.dev/login", "https://api.coop-ai.dev")
  );
  assert.doesNotThrow(() =>
    assertSafePublicEmailUrl("mailto:hello@coop-ai.dev", "https://api.coop-ai.dev")
  );
});

test("assertSafePublicEmailUrl rejects localhost on production API", () => {
  assert.throws(
    () => assertSafePublicEmailUrl("http://localhost:3001/login", "https://api.coop-ai.dev"),
    /non-public link/
  );
  assert.throws(
    () => assertSafePublicEmailUrl("https://admin.demo.local/login", "https://api.coop-ai.dev"),
    /non-public link/
  );
});

test("assertSafePublicEmailUrl allows localhost when API is local", () => {
  assert.doesNotThrow(() =>
    assertSafePublicEmailUrl("http://localhost:3001/login", "http://localhost:8787")
  );
});

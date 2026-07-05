import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicBaseUrl } from "./publicBaseUrl";

test("resolvePublicBaseUrl prefers WEBHOOK_DOMAIN", () => {
  assert.equal(
    resolvePublicBaseUrl({
      WEBHOOK_DOMAIN: "https://api.example.com/",
      COOP_PUBLIC_BASE_URL: "https://other.example.com",
      PORT: "8787"
    }),
    "https://api.example.com"
  );
});

test("resolvePublicBaseUrl falls back to COOP_PUBLIC_BASE_URL", () => {
  assert.equal(
    resolvePublicBaseUrl({
      COOP_PUBLIC_BASE_URL: "https://api.coop-ai.dev",
      PORT: "8787"
    }),
    "https://api.coop-ai.dev"
  );
});

test("resolvePublicBaseUrl falls back to COOP_PUBLIC_API_URL", () => {
  assert.equal(
    resolvePublicBaseUrl({
      COOP_PUBLIC_API_URL: "https://legacy.example.com",
      PORT: "8787"
    }),
    "https://legacy.example.com"
  );
});

test("resolvePublicBaseUrl defaults to localhost", () => {
  assert.equal(resolvePublicBaseUrl({ PORT: "9999" }), "http://localhost:9999");
});

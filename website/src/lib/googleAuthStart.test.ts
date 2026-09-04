import assert from "node:assert/strict";
import { backendGoogleStartUrl, marketingGoogleAuthStartUrl } from "./googleAuthStart";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("browser Google start is same-origin, never the local API", () => {
  const href = marketingGoogleAuthStartUrl({ mode: "signup" });
  const path = href.split("?")[0];
  assert.equal(path, "/api/auth/google/start");
  assert.equal(href.startsWith("/api/auth/google/start?"), true);
  assert.equal(href.includes("localhost:8787"), false);
  assert.equal(href.includes("/v1/auth/google/start"), false);
  assert.match(href, /mode=signup/);
});

test("forwards org name and checkout params on the same-origin path", () => {
  const href = marketingGoogleAuthStartUrl({
    mode: "checkout",
    orgName: "Acme",
    redirect: "https://coop-ai.dev/signup?tier=pro",
    checkout: { tier: "pro", intent: "team", seats: 5 }
  });
  assert.equal(href.startsWith("/api/auth/google/start?"), true);
  assert.match(href, /orgName=Acme/);
  assert.match(href, /tier=pro/);
  assert.match(href, /intent=team/);
  assert.match(href, /seats=5/);
  assert.equal(href.includes("localhost:8787"), false);
});

test("server forwards only allowlisted query keys to the public API", () => {
  const params = new URLSearchParams({
    mode: "signup",
    redirect: "https://admin.coop-ai.dev/auth/callback",
    orgName: "Acme",
    evil: "https://evil.example"
  });
  const url = backendGoogleStartUrl("https://api.coop-ai.dev", params);
  assert.equal(url.startsWith("https://api.coop-ai.dev/v1/auth/google/start?"), true);
  assert.equal(url.includes("localhost"), false);
  assert.match(url, /mode=signup/);
  assert.match(url, /orgName=Acme/);
  assert.equal(url.includes("evil"), false);
});

console.log(`\ngoogleAuthStart: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

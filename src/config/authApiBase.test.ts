import assert from "node:assert/strict";
import { DEFAULT_API_BASE } from "../chat/types";
import {
  buildUserGoogleAuthStartUrl,
  isLoopbackCoopApiBase,
  resolveUserAuthApiBase
} from "./authApiBase";

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

test("loopback hosts are detected", () => {
  assert.equal(isLoopbackCoopApiBase("http://localhost:8787"), true);
  assert.equal(isLoopbackCoopApiBase("http://127.0.0.1:8787"), true);
  assert.equal(isLoopbackCoopApiBase("https://api.coop-ai.dev"), false);
});

test("Google/password/SSO never keep a localhost API base", () => {
  assert.equal(resolveUserAuthApiBase("http://localhost:8787"), DEFAULT_API_BASE);
  assert.equal(resolveUserAuthApiBase("http://127.0.0.1:8787/"), DEFAULT_API_BASE);
  assert.equal(resolveUserAuthApiBase(""), DEFAULT_API_BASE);
  assert.equal(resolveUserAuthApiBase("https://api.coop-ai.dev/"), "https://api.coop-ai.dev");
});

test("hosted Google sign-in keeps the browser on the admin portal", () => {
  const url = new URL(
    buildUserGoogleAuthStartUrl(
      "https://api.coop-ai.dev",
      "vscode://coop-ai.coop-ai/auth/callback"
    )
  );
  assert.equal(url.origin, "https://admin.coop-ai.dev");
  assert.equal(url.pathname, "/api/auth/google/start");
  assert.equal(url.searchParams.get("mode"), "login");
  assert.equal(url.searchParams.get("redirect"), "vscode://coop-ai.coop-ai/auth/callback");
});

test("self-hosted Google sign-in stays on the configured API", () => {
  const url = new URL(buildUserGoogleAuthStartUrl("https://coop-api.example.test"));
  assert.equal(url.origin, "https://coop-api.example.test");
  assert.equal(url.pathname, "/v1/auth/google/start");
});

console.log(`\nauthApiBase: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

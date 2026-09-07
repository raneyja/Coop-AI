import assert from "node:assert/strict";
import { classifyCoopUriPath, vscodeSignInHref } from "./coopUriRoutes";

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

test("classifies auth callback", () => {
  assert.equal(classifyCoopUriPath("/auth/callback"), "auth-callback");
  assert.equal(classifyCoopUriPath("/auth/callback/"), "auth-callback");
});

test("classifies sign-in from the marketing site", () => {
  assert.equal(classifyCoopUriPath("/sign-in"), "sign-in");
  assert.equal(classifyCoopUriPath("/sign-in/"), "sign-in");
  assert.equal(classifyCoopUriPath("sign-in"), "sign-in");
  assert.equal(classifyCoopUriPath("/signin"), "sign-in");
});

test("ignores unrelated paths", () => {
  assert.equal(classifyCoopUriPath("/"), "unknown");
  assert.equal(classifyCoopUriPath("/auth/callback/extra"), "unknown");
  assert.equal(classifyCoopUriPath("/login"), "unknown");
});

test("vscode sign-in href never points at admin or localhost", () => {
  const href = vscodeSignInHref();
  assert.equal(href, "vscode://coop-ai.coop-ai/sign-in");
  assert.equal(href.includes("admin."), false);
  assert.equal(href.includes("localhost"), false);
  assert.equal(href.includes("http"), false);
});

console.log(`\ncoopUriRoutes: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

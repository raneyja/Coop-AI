import assert from "node:assert/strict";
import { DEFAULT_API_BASE } from "../chat/types";
import { isLoopbackCoopApiBase, resolveUserAuthApiBase } from "./authApiBase";

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

console.log(`\nauthApiBase: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

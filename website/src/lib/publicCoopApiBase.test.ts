import assert from "node:assert/strict";
import { resolvePublicCoopApiBase } from "./publicCoopApiBase";

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

test("production without env never uses localhost", () => {
  const base = resolvePublicCoopApiBase({ NODE_ENV: "production" });
  assert.equal(base, "https://api.coop-ai.dev");
  assert.equal(base.includes("localhost"), false);
});

test("production empty strings still use the public API", () => {
  const base = resolvePublicCoopApiBase({
    NODE_ENV: "production",
    NEXT_PUBLIC_COOP_API_BASE: "  ",
    NEXT_PUBLIC_API_BASE: ""
  });
  assert.equal(base, "https://api.coop-ai.dev");
});

test("explicit env wins over production default", () => {
  assert.equal(
    resolvePublicCoopApiBase({
      NODE_ENV: "production",
      NEXT_PUBLIC_COOP_API_BASE: "https://api.staging.example/"
    }),
    "https://api.staging.example"
  );
});

test("local next dev keeps localhost when unset", () => {
  assert.equal(resolvePublicCoopApiBase({ NODE_ENV: "development" }), "http://localhost:8787");
});

console.log(`\npublicCoopApiBase: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { resolveCoopApiBase, resolvePublicCoopApiBase } from "./publicCoopApiBase";

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
  const base = resolveCoopApiBase({ NODE_ENV: "production" });
  assert.equal(base, "https://api.coop-ai.dev");
  assert.equal(base.includes("localhost"), false);
});

test("production empty strings still use the public API", () => {
  const base = resolveCoopApiBase({
    NODE_ENV: "production",
    NEXT_PUBLIC_COOP_API_BASE: "  ",
    NEXT_PUBLIC_API_BASE: ""
  });
  assert.equal(base, "https://api.coop-ai.dev");
});

test("production ignores leftover localhost NEXT_PUBLIC env", () => {
  assert.equal(
    resolveCoopApiBase({
      NODE_ENV: "production",
      NEXT_PUBLIC_COOP_API_BASE: "http://localhost:8787"
    }),
    "https://api.coop-ai.dev"
  );
  assert.equal(
    resolveCoopApiBase({
      VERCEL_ENV: "production",
      NODE_ENV: "development",
      COOP_API_BASE: "http://127.0.0.1:8787"
    }),
    "https://api.coop-ai.dev"
  );
});

test("explicit https env wins over production default", () => {
  assert.equal(
    resolveCoopApiBase({
      NODE_ENV: "production",
      NEXT_PUBLIC_COOP_API_BASE: "https://api.staging.example/"
    }),
    "https://api.staging.example"
  );
});

test("server COOP_API_BASE wins when not loopback", () => {
  assert.equal(
    resolveCoopApiBase({
      NODE_ENV: "production",
      COOP_API_BASE: "https://api.coop-ai.dev/",
      NEXT_PUBLIC_COOP_API_BASE: "http://localhost:8787"
    }),
    "https://api.coop-ai.dev"
  );
});

test("local next dev keeps localhost when unset", () => {
  assert.equal(resolveCoopApiBase({ NODE_ENV: "development" }), "http://localhost:8787");
});

test("deprecated alias matches resolveCoopApiBase", () => {
  assert.equal(
    resolvePublicCoopApiBase({ NODE_ENV: "production" }),
    resolveCoopApiBase({ NODE_ENV: "production" })
  );
});

console.log(`\npublicCoopApiBase: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

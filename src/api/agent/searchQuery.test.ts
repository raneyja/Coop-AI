import assert from "node:assert/strict";
import {
  extractAgentSearchQuery,
  isBarrelPath,
  pickSearchHitsToRead,
  pickTopSearchHit,
  sanitizeAgentSearchQuery
} from "./searchQuery";

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

test("extracts requireAuth from a location question", () => {
  assert.equal(
    extractAgentSearchQuery("Where is requireAuth or authentication middleware defined in this repo?"),
    "requireAuth"
  );
});

test("extracts camelCase without grabbing Where", () => {
  assert.equal(extractAgentSearchQuery("Where is verifyToken enforced in the codebase?"), "verifyToken");
});

test("sanitize replaces the whole question", () => {
  const q = "Where is requireAuth or authentication middleware defined in this repo?";
  assert.equal(sanitizeAgentSearchQuery(q, q), "requireAuth");
});

test("prefers API middleware over space auth-form barrels", () => {
  const top = pickTopSearchHit([
    { fileName: "apps/space/components/views/index.ts", lineNumber: 1, score: 0.95 },
    { fileName: "apps/api/plane/authentication/middleware.py", lineNumber: 12, score: 0.4 }
  ]);
  assert.equal(top?.fileName, "apps/api/plane/authentication/middleware.py");
});

test("pickSearchHitsToRead skips barrels", () => {
  const picked = pickSearchHitsToRead([
    { fileName: "apps/space/components/account/auth-forms/index.ts", lineNumber: 1, score: 0.9 },
    { fileName: "apps/api/plane/authentication/adapter.py", lineNumber: 4, score: 0.5 }
  ]);
  assert.equal(picked[0]?.fileName, "apps/api/plane/authentication/adapter.py");
});

test("isBarrelPath", () => {
  assert.equal(isBarrelPath("apps/space/components/views/index.ts"), true);
  assert.equal(isBarrelPath("apps/api/middleware.py"), false);
});

console.log(`\nsearchQuery: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

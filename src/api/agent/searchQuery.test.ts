import assert from "node:assert/strict";
import { DOGFOOD_HUNT_QUESTION, DOGFOOD_HUNT_SEARCH_QUERY } from "./dogfoodContract";
import {
  extractAgentSearchQuery,
  fallbackAgentSearchQueries,
  isBarrelPath,
  isGeneratedOrVendorPath,
  pickSearchHitsToRead,
  pickSymbolHitsToRead,
  pickTopSearchHit,
  sanitizeAgentSearchQuery,
  selectChatEvidencePaths,
  shouldSkipEvidencePath
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

test("prefers the symbol the user named over a prose phrase", () => {
  assert.equal(extractAgentSearchQuery(DOGFOOD_HUNT_QUESTION), DOGFOOD_HUNT_SEARCH_QUERY);
});

test("extracts camelCase without grabbing Where", () => {
  assert.equal(
    extractAgentSearchQuery("Where is verifyToken enforced in the codebase?"),
    "verifyToken"
  );
});

test("falls back to a role noun phrase when no symbol is named", () => {
  assert.equal(
    extractAgentSearchQuery("Where is the authentication middleware defined?"),
    "authentication middleware"
  );
});

test("sanitize replaces the whole question", () => {
  assert.equal(
    sanitizeAgentSearchQuery(DOGFOOD_HUNT_QUESTION, DOGFOOD_HUNT_QUESTION),
    DOGFOOD_HUNT_SEARCH_QUERY
  );
});

test("sanitize keeps a short model-chosen identifier", () => {
  assert.equal(sanitizeAgentSearchQuery("requireAuth", DOGFOOD_HUNT_QUESTION), "requireAuth");
});

test("fallback queries broaden from symbol to plain words", () => {
  const queries = fallbackAgentSearchQueries(DOGFOOD_HUNT_QUESTION);
  assert.equal(queries[0], "requireAuth");
  assert.equal(queries.includes("authentication middleware"), true);
  assert.equal(
    queries.every((q) => q.split(/\s+/).length <= 4),
    true
  );
});

test("fallback queries never repeat the whole question", () => {
  const queries = fallbackAgentSearchQueries(DOGFOOD_HUNT_QUESTION);
  assert.equal(queries.includes(DOGFOOD_HUNT_QUESTION), false);
});

test("ranks a path that matches the question's words above one that does not", () => {
  const top = pickTopSearchHit(
    [
      { fileName: "web/components/dashboard/card.tsx", lineNumber: 1, score: 1 },
      { fileName: "server/auth/require_auth.py", lineNumber: 12, score: 1 }
    ],
    DOGFOOD_HUNT_QUESTION
  );
  assert.equal(top?.fileName, "server/auth/require_auth.py");
});

test("pickSearchHitsToRead skips barrels", () => {
  const picked = pickSearchHitsToRead([
    { fileName: "packages/ui/src/index.ts", lineNumber: 1, score: 0.9 },
    { fileName: "server/auth/adapter.py", lineNumber: 4, score: 0.5 }
  ]);
  assert.equal(picked[0]?.fileName, "server/auth/adapter.py");
});

test("pickSearchHitsToRead skips build output and vendored code", () => {
  const picked = pickSearchHitsToRead([
    { fileName: "dist/bundle.min.js", lineNumber: 1, score: 0.99 },
    { fileName: "node_modules/express/lib/router.js", lineNumber: 1, score: 0.98 },
    { fileName: "server/auth/adapter.py", lineNumber: 4, score: 0.1 }
  ]);
  assert.deepEqual(
    picked.map((hit) => hit.fileName),
    ["server/auth/adapter.py"]
  );
});

test("does not drop a UI path just because the question sounds backend", () => {
  const picked = selectChatEvidencePaths(
    ["web/components/auth/login-form.tsx", "server/auth/middleware.py"],
    DOGFOOD_HUNT_QUESTION,
    3
  );
  assert.equal(picked.includes("web/components/auth/login-form.tsx"), true);
  assert.equal(picked[0], "server/auth/middleware.py");
});

test("keeps a barrel when the user named that exact file", () => {
  assert.equal(shouldSkipEvidencePath("packages/ui/src/index.ts"), true);
  assert.equal(
    shouldSkipEvidencePath("packages/ui/src/index.ts", "What does packages/ui/src/index.ts export?"),
    false
  );
});

test("picks the declaration whose name matches the symbol the user asked about", () => {
  const picked = pickSymbolHitsToRead(
    [
      { file: "web/hooks/use-session.ts", line: 8, displayName: "useSession", kind: "function" },
      { file: "server/auth/middleware.py", line: 412, displayName: "requireAuth", kind: "function" }
    ],
    2,
    DOGFOOD_HUNT_QUESTION
  );
  assert.equal(picked[0]?.file, "server/auth/middleware.py");
  assert.equal(picked[0]?.line, 412);
});

test("ignores declarations unrelated to the question", () => {
  const picked = pickSymbolHitsToRead(
    [{ file: "web/theme/colors.ts", line: 3, displayName: "palette", kind: "variable" }],
    2,
    DOGFOOD_HUNT_QUESTION
  );
  assert.deepEqual(picked, []);
});

test("ignores declarations inside vendored code", () => {
  const picked = pickSymbolHitsToRead(
    [
      {
        file: "node_modules/authlib/index.js",
        line: 10,
        displayName: "requireAuth",
        kind: "function"
      }
    ],
    2,
    DOGFOOD_HUNT_QUESTION
  );
  assert.deepEqual(picked, []);
});

test("isBarrelPath", () => {
  assert.equal(isBarrelPath("packages/ui/src/index.ts"), true);
  assert.equal(isBarrelPath("server/middleware.py"), false);
});

test("isGeneratedOrVendorPath", () => {
  assert.equal(isGeneratedOrVendorPath("node_modules/express/index.js"), true);
  assert.equal(isGeneratedOrVendorPath("dist/app.js"), true);
  assert.equal(isGeneratedOrVendorPath("pnpm-lock.yaml"), true);
  assert.equal(isGeneratedOrVendorPath("src/server/auth.ts"), false);
});

console.log(`\nsearchQuery: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

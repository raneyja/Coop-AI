import assert from "node:assert/strict";
import {
  classifyLocateRead,
  locateReadCountsAsGrounding,
  preferredHitsForLocate
} from "./locateEvidence";

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

const CARD1_ASK = "Where is auth middleware enforced and what calls it?";
const REQUIRE_AUTH_ASK = "Where is requireAuth defined in this repo?";

const STORY_PATH = "web/stories/authMiddlewareDemo.ts";
const STORY_BODY = [
  "const AUTH_MIDDLEWARE_STORY = `",
  "func AuthMiddleware(next http.Handler) http.Handler {",
  "  return next",
  "}",
  "// see internal/auth/auth_middleware.go",
  "`;"
].join("\n");

const SERVER_TS_PATH = "src/server/authMiddleware.ts";
const SERVER_TS_BODY = [
  "export function requireAuth(request) {",
  "  return Boolean(request.auth);",
  "}"
].join("\n");

const SERVER_PY_PATH = "server/http/middleware.py";
const SERVER_PY_BODY = [
  "class AuthenticationMiddleware:",
  "    def __init__(self, get_response):",
  "        self.get_response = get_response",
  "",
  "def require_auth(view):",
  "    return view"
].join("\n");

const LEFTOVER_PATH = "src/config/responseDeadline.ts";
const LEFTOVER_BODY = [
  "export const MAX_USER_FACING_RESPONSE_MS = 15_000;",
  "export function remainingContextGatherBudgetMs() { return 1; }"
].join("\n");

const PLANE_SHAPED_PATH = "apps/api/middleware/api_authentication.py";
const PLANE_SHAPED_BODY = [
  "class APIKeyAuthentication:",
  "    def authenticate(self, request):",
  "        return True"
].join("\n");

test("story template with Go func is a mention", () => {
  assert.equal(
    classifyLocateRead({ path: STORY_PATH, body: STORY_BODY, query: CARD1_ASK }),
    "mention"
  );
  assert.equal(
    locateReadCountsAsGrounding({ path: STORY_PATH, body: STORY_BODY, query: CARD1_ASK }),
    false
  );
});

test("server export / def is an implementation", () => {
  assert.equal(
    classifyLocateRead({ path: SERVER_TS_PATH, body: SERVER_TS_BODY, query: CARD1_ASK }),
    "implementation"
  );
  assert.equal(
    classifyLocateRead({ path: SERVER_PY_PATH, body: SERVER_PY_BODY, query: CARD1_ASK }),
    "implementation"
  );
  assert.equal(
    locateReadCountsAsGrounding({ path: SERVER_TS_PATH, body: SERVER_TS_BODY, query: CARD1_ASK }),
    true
  );
});

test("leftover latency file is unrelated", () => {
  assert.equal(
    classifyLocateRead({ path: LEFTOVER_PATH, body: LEFTOVER_BODY, query: CARD1_ASK }),
    "unrelated"
  );
});

test("plane-shaped middleware folder + class is implementation", () => {
  assert.equal(
    classifyLocateRead({
      path: PLANE_SHAPED_PATH,
      body: PLANE_SHAPED_BODY,
      query: CARD1_ASK
    }),
    "implementation"
  );
});

test("named-symbol implementation only on the export file", () => {
  assert.equal(
    classifyLocateRead({ path: SERVER_TS_PATH, body: SERVER_TS_BODY, query: REQUIRE_AUTH_ASK }),
    "implementation"
  );
  assert.notEqual(
    classifyLocateRead({ path: STORY_PATH, body: STORY_BODY, query: REQUIRE_AUTH_ASK }),
    "implementation"
  );
});

test("preferredHitsForLocate keeps the server and drops the story", () => {
  const picked = preferredHitsForLocate(
    [
      {
        fileName: STORY_PATH,
        content: "func AuthMiddleware(next http.Handler) http.Handler {"
      },
      {
        fileName: SERVER_TS_PATH,
        content: "export function requireAuth(request) {"
      }
    ],
    CARD1_ASK
  );
  assert.deepEqual(
    picked.map((hit) => hit.fileName),
    [SERVER_TS_PATH]
  );
});

test("preferredHitsForLocate returns empty when the pool is only mentions", () => {
  const picked = preferredHitsForLocate(
    [
      {
        fileName: STORY_PATH,
        content: "func AuthMiddleware(next http.Handler) http.Handler {"
      }
    ],
    CARD1_ASK
  );
  assert.deepEqual(picked, []);
});

console.log(`\nlocateEvidence: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

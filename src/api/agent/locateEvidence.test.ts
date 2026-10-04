import assert from "node:assert/strict";
import {
  classifyLocateRead,
  locateReadCountsAsGrounding,
  lineNumberOfGroundedExport,
  pickGroundedExport,
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

test("prose parser locate rejects token storage and callers, accepts the parsing declaration", () => {
  const query = "Where do we parse the Authorization Bearer token? Don’t write a new helper — point me at the existing function.";
  for (const body of ["export class AuthTokenStore { createToken() {} }", "const token = extractBearerToken(headers);", "// function extractBearerToken(headers) {}"]) {
    assert.equal(locateReadCountsAsGrounding({ path: "server/auth/token.ts", body, query }), false);
  }
  assert.equal(locateReadCountsAsGrounding({ path: "server/auth/middleware.ts", body: "export function extractBearerToken(headers) { return headers.authorization.slice(7).trim(); }", query }), true);
});

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

test("backend state locate grounds on State model, not seed JSON", () => {
  const ask = "Where do work-item states live in the backend?";
  assert.equal(
    classifyLocateRead({
      path: "apps/api/db/models/state.py",
      body: "class State(BaseModel):\n    name = models.CharField()",
      query: ask
    }),
    "implementation"
  );
  assert.equal(
    classifyLocateRead({
      path: "apps/api/seeds/data/issues.json",
      body: '[{"id": 1, "state_id": 3}]',
      query: ask
    }),
    "mention"
  );
  assert.equal(
    locateReadCountsAsGrounding({
      path: "apps/api/db/models/state.py",
      body: "class State(BaseModel):\n    name = models.CharField()",
      query: ask
    }),
    true
  );
  assert.equal(
    locateReadCountsAsGrounding({
      path: "apps/api/seeds/data/issues.json",
      body: '[{"id": 1, "state_id": 3}]',
      query: ask
    }),
    false
  );
});

test("API key auth locate grounds on Authentication class", () => {
  const ask = "Where is API key / request authentication defined in this repo?";
  assert.equal(
    classifyLocateRead({
      path: PLANE_SHAPED_PATH,
      body: PLANE_SHAPED_BODY,
      query: ask
    }),
    "implementation"
  );
  assert.equal(
    locateReadCountsAsGrounding({
      path: "web/hooks/use-keypress.tsx",
      body: "export function useKeypress() {}",
      query: ask
    }),
    false
  );
});

test("L3 compound: comment_html validate is mention; StateSerializer grounds", () => {
  const ask =
    "Where does the API authenticate requests with an API key, and where are issue/work-item states defined on the server?";
  const htmlValidate = [
    "def validate(self, data):",
    '    if data.get("comment_html"):',
    '        raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
    "    return data"
  ].join("\n");
  assert.equal(
    classifyLocateRead({
      path: "apps/api/app/serializers/issue.py",
      body: htmlValidate,
      query: ask
    }),
    "mention"
  );
  assert.equal(
    locateReadCountsAsGrounding({
      path: "apps/api/app/serializers/state.py",
      body: "class StateSerializer(serializers.ModelSerializer):\n    pass",
      query: ask
    }),
    true
  );
});

test("create locate grounds on ViewSet create, not a mention-only window", () => {
  const ask = "Where does the API create an issue?";
  const viewBody = [
    "class IssueViewSet(viewsets.ModelViewSet):",
    "    def create(self, request, *args, **kwargs):",
    "        return super().create(request, *args, **kwargs)"
  ].join("\n");
  assert.equal(
    classifyLocateRead({
      path: "apps/api/app/views/issue/base.py",
      body: viewBody,
      query: ask
    }),
    "implementation"
  );
  assert.equal(
    locateReadCountsAsGrounding({
      path: "apps/api/app/views/issue/base.py",
      body: viewBody,
      query: ask
    }),
    true
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

test("pickGroundedExport prefers requireAuth for a role-only auth middleware ask", () => {
  const body = [
    "export function extractBearerToken(headers) { return headers.authorization; }",
    "export async function resolveAuthContext(headers) { return undefined; }",
    "export function requireAuth(auth, requireInProduction) { return Boolean(auth); }"
  ].join("\n");
  assert.equal(pickGroundedExport(SERVER_TS_PATH, body, CARD1_ASK), "requireAuth");
});

test("a top-of-file window without requireAuth picks a weaker auth export", () => {
  const window = [
    "export function extractBearerToken(headers) { return headers.authorization; }",
    "export async function resolveAuthContextDetailed(headers) { return {}; }"
  ].join("\n");
  assert.equal(pickGroundedExport(SERVER_TS_PATH, window, CARD1_ASK), "resolveAuthContextDetailed");
  const full = `${window}\nexport function requireAuth(auth, requireInProduction) { return Boolean(auth); }\n`;
  assert.equal(pickGroundedExport(SERVER_TS_PATH, full, CARD1_ASK), "requireAuth");
});

test("pickGroundedExport prefers APIKeyAuthentication for an authentication middleware role ask", () => {
  assert.equal(
    pickGroundedExport(PLANE_SHAPED_PATH, PLANE_SHAPED_BODY, CARD1_ASK),
    "APIKeyAuthentication"
  );
});

test("pickGroundedExport leaves named-symbol asks to the user-typed name", () => {
  assert.equal(pickGroundedExport(SERVER_TS_PATH, SERVER_TS_BODY, REQUIRE_AUTH_ASK), undefined);
});

test("lineNumberOfGroundedExport finds the chosen export below a top helper", () => {
  const body = Array.from({ length: 160 }, (_, i) => {
    const line = i + 1;
    if (line === 10) {
      return "export function extractBearerToken(headers) {";
    }
    if (line === 17) {
      return "}";
    }
    if (line === 132) {
      return "export function requireAuth(auth, requireInProduction) {";
    }
    if (line === 136) {
      return "}";
    }
    return `// line ${line}`;
  }).join("\n");
  assert.equal(lineNumberOfGroundedExport(SERVER_TS_PATH, body, "requireAuth"), 132);
  assert.equal(lineNumberOfGroundedExport(SERVER_TS_PATH, body, "extractBearerToken"), 10);
  assert.equal(lineNumberOfGroundedExport(SERVER_TS_PATH, body, "missingExport"), undefined);
});

test("lineNumberOfGroundedExport finds APIKeyAuthentication without a Coop export", () => {
  assert.equal(
    lineNumberOfGroundedExport(PLANE_SHAPED_PATH, PLANE_SHAPED_BODY, "APIKeyAuthentication"),
    1
  );
  assert.equal(
    lineNumberOfGroundedExport(PLANE_SHAPED_PATH, PLANE_SHAPED_BODY, "requireAuth"),
    undefined
  );
});

console.log(`\nlocateEvidence: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

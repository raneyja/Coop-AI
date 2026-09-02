import assert from "node:assert/strict";
import {
  COPILOT_C1_ASK,
  COPILOT_C2_ASK,
  COPILOT_C5_ASK,
  COPILOT_T2_ASK,
  COPILOT_ASSIGNEE_REJECT_ASK,
  DOGFOOD_HUNT_QUESTION,
  DOGFOOD_HUNT_SEARCH_QUERY
} from "./dogfoodContract";
import {
  extractAgentSearchQuery,
  extractNamedSourceFiles,
  fallbackAgentSearchQueries,
  identifierSearchAliases,
  indexQueryForRetrieval,
  isBarrelPath,
  isGeneratedOrVendorPath,
  contentLooksLikeWriteReject,
  contentLooksLikeStateTransitionReject,
  apiRejectSearchQueries,
  contentLooksLikeAskedFieldReject,
  contentLooksLikeWrongFieldReject,
  filterWriteRejectFiles,
  isApiRejectAsk,
  askedRejectFieldTokens,
  askedRejectJobTokens,
  lineNumberOfWriteReject,
  pickSearchHitsToRead,
  pickSymbolHitsToRead,
  pickTopSearchHit,
  proseLocateSearchAliases,
  queryHasNamedSymbol,
  queryNamesSourceFile,
  queryRoleHints,
  sanitizeAgentSearchQuery,
  selectChatEvidencePaths,
  shouldSkipEvidencePath,
  textMentionsNamedSymbol,
  textMentionsQueryRoles
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
  assert.equal(queries.includes("require_auth"), true, "must try snake_case alias for Python/Go repos");
  assert.equal(queries.includes("authentication middleware"), true);
  assert.equal(
    queries.every((q) => q.split(/\s+/).length <= 4),
    true
  );
});

test("identifier aliases bridge camelCase and snake_case", () => {
  assert.deepEqual(identifierSearchAliases("requireAuth"), ["require_auth"]);
  assert.deepEqual(identifierSearchAliases("require_auth"), ["requireAuth"]);
  assert.deepEqual(identifierSearchAliases("middleware"), []);
});

test("index retrieval OR-covers both casings", () => {
  assert.equal(
    indexQueryForRetrieval(DOGFOOD_HUNT_QUESTION),
    "requireAuth or require_auth"
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
    "How does authentication work across the codebase?",
    3
  );
  assert.equal(picked.includes("web/components/auth/login-form.tsx"), true);
  assert.equal(picked.includes("server/auth/middleware.py"), true);
});

test("exact symbol path beats a weak auth UI path for requireAuth asks", () => {
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/space/components/account/auth-forms/auth-root.tsx",
        lineNumber: 1,
        score: 0.99,
        content: "export function AuthRoot() { const searchParams = useSearchParams(); }"
      },
      {
        fileName: "apps/api/plane/authentication/middleware.py",
        lineNumber: 12,
        score: 0.4,
        content: "def require_auth(request):"
      }
    ],
    2,
    "add logging around requireAuth"
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.fileName, "apps/api/plane/authentication/middleware.py");
});

test("drops auth UI hits that never mention requireAuth", () => {
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/space/components/account/auth-forms/auth-root.tsx",
        lineNumber: 1,
        score: 0.99,
        content: "export function AuthRoot() {}"
      }
    ],
    2,
    "add logging around requireAuth"
  );
  assert.equal(picked.length, 0);
});

test("role-noun hunts keep middleware hits and drop collab auth", () => {
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "collab/session/auth.ts",
        lineNumber: 8,
        score: 0.99,
        content: "export async function onAuthenticate() { return true }"
      },
      {
        fileName: "server/http/middleware.py",
        lineNumber: 12,
        score: 0.2,
        content: "def auth_middleware(get_response):"
      }
    ],
    8,
    "Where is auth middleware enforced and what calls it?"
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.fileName, "server/http/middleware.py");
});

test("does not treat require_authentication filenames as requireAuth", () => {
  const ask = "add logging around requireAuth";
  assert.equal(
    textMentionsNamedSymbol(
      "apps/api/plane/tests/contract/app/test_api_token.py\ndef test_all_endpoints_require_authentication():",
      ask
    ),
    false
  );
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/api/plane/tests/contract/app/test_api_token.py",
        lineNumber: 40,
        score: 0.99,
        content: "def test_all_endpoints_require_authentication():\n    assert True"
      },
      {
        fileName: "apps/api/plane/authentication/middleware.py",
        lineNumber: 12,
        score: 0.4,
        content: "def require_auth(request):\n    pass"
      }
    ],
    2,
    ask
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.fileName, "apps/api/plane/authentication/middleware.py");
});

test("symbol index rejects require_authentication as a requireAuth match", () => {
  const ask = "add logging around requireAuth";
  const picked = pickSymbolHitsToRead(
    [
      {
        file: "apps/api/plane/tests/contract/app/test_api_token.py",
        line: 40,
        displayName: "test_all_endpoints_require_authentication",
        kind: "function"
      },
      {
        file: "apps/api/plane/utils/auth.py",
        line: 88,
        displayName: "RequireAuthentication",
        kind: "class"
      },
      {
        file: "apps/api/plane/authentication/middleware.py",
        line: 12,
        displayName: "require_auth",
        kind: "function"
      }
    ],
    2,
    ask
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.file, "apps/api/plane/authentication/middleware.py");
});

test("skips test paths for named-symbol hunts unless the user asked about tests", () => {
  assert.equal(
    shouldSkipEvidencePath(
      "apps/api/plane/tests/contract/app/test_api_token.py",
      "add logging around requireAuth"
    ),
    true
  );
  assert.equal(
    shouldSkipEvidencePath(
      "apps/api/plane/tests/contract/app/test_api_token.py",
      "which contract test covers requireAuth"
    ),
    false
  );
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

test("queryRoleHints extracts middleware from a locate ask", () => {
  assert.deepEqual(
    queryRoleHints("Where is auth middleware enforced and what calls it?"),
    ["middleware"]
  );
  assert.deepEqual(queryRoleHints("Where is requireAuth defined?"), []);
});

test("textMentionsQueryRoles requires the role in the file or path", () => {
  const ask = "Where is auth middleware enforced and what calls it?";
  assert.equal(
    textMentionsQueryRoles(
      "collab/session/auth.ts\nexport async function onAuthenticate() { return true }",
      ask
    ),
    false
  );
  assert.equal(
    textMentionsQueryRoles(
      "server/http/middleware.py\ndef auth_middleware(get_response):\n  return get_response",
      ask
    ),
    true
  );
});

test("C1 prose locate does not require Authorization as a named symbol", () => {
  const ask = COPILOT_C1_ASK;
  assert.equal(queryHasNamedSymbol(ask), false);
  const primary = extractAgentSearchQuery(ask);
  assert.notEqual(primary.toLowerCase(), "authorization");
  assert.match(primary, /Bearer/i);
  const fallbacks = fallbackAgentSearchQueries(ask);
  assert.equal(
    fallbacks.some((q) => /bearer/i.test(q)),
    true,
    `fallbacks must include Bearer, got ${fallbacks.join(", ")}`
  );
  assert.equal(
    fallbacks.some((q) => /^function\.?$/i.test(q) || /^existing$/i.test(q)),
    false,
    `must not burn retries on junk, got ${fallbacks.join(", ")}`
  );
});

test("C2 prose locate does not require Users as a named symbol", () => {
  const ask = COPILOT_C2_ASK;
  assert.equal(queryHasNamedSymbol(ask), false);
  const primary = extractAgentSearchQuery(ask);
  assert.notEqual(primary.toLowerCase(), "users");
  assert.equal(/^users\b/i.test(primary), false);
  const fallbacks = fallbackAgentSearchQueries(ask);
  const blob = [primary, ...fallbacks].join(" ").toLowerCase();
  assert.equal(
    /\bwork-item\b/.test(blob) || /\btransition\b/.test(blob),
    true,
    `C2 search must include work-item or transition, got ${primary} / ${fallbacks.join(", ")}`
  );
  assert.equal(
    fallbacks[0]?.toLowerCase() === "users",
    false,
    "Users must not be the first fallback"
  );
  const aliases = proseLocateSearchAliases(ask);
  assert.equal(
    aliases.some((q) => /issue|state|workflow/.test(q)),
    true,
    `C2 aliases must include issue/state/workflow, got ${aliases.join(", ")}`
  );
  assert.equal(
    fallbacks.some((q) => /issue state|state transition|validate_state|state validation|ValidationError/.test(q)),
    true,
    `C2 fallbacks must search issue/state, got ${fallbacks.join(", ")}`
  );
  assert.equal(
    fallbacks.some((q) => /ValidationError/.test(q)),
    true,
    `C2 fallbacks must search ValidationError, got ${fallbacks.join(", ")}`
  );
  assert.equal(sanitizeAgentSearchQuery("Users", ask).toLowerCase() === "users", false);
});

test("C2 skips locale catalogs and prefers API write paths over client grouping", () => {
  const ask = COPILOT_C2_ASK;
  assert.equal(shouldSkipEvidencePath("web/locales/en/workItem.json", ask), true);
  assert.equal(shouldSkipEvidencePath("packages/i18n/src/locales/en/workItem.ts", ask), true);
  assert.equal(
    shouldSkipEvidencePath("web/locales/en/workItem.json", "Where is the i18n string for backlog?"),
    false
  );
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "packages/utils/src/work-item/state.ts",
        lineNumber: 4,
        content: "export function groupWorkItemByState(items) {",
        score: 0.95
      },
      {
        fileName: "web/locales/en/workItem.json",
        lineNumber: 3,
        content: '"cannotMoveOutOfBacklog": "Users cannot move a work item out of backlog"',
        score: 0.99
      },
      {
        fileName: "apps/api/issues/work_item_state.py",
        lineNumber: 12,
        content: "def write_work_item_state(item, new_state):",
        score: 0.4
      }
    ],
    2,
    ask
  );
  assert.equal(picked[0]?.fileName, "apps/api/issues/work_item_state.py");
  assert.equal(
    picked.some((hit) => /locales|i18n/.test(hit.fileName)),
    false
  );
});

test("C2 skips state catalogs and client posts; prefers the write/reject handler", () => {
  const ask = COPILOT_C2_ASK;
  assert.equal(shouldSkipEvidencePath("apps/api/plane/db/models/state.py", ask), true);
  assert.equal(
    shouldSkipEvidencePath(
      "apps/web/core/components/power-k/ui/pages/context-based/work-item/commands.ts",
      ask
    ),
    true
  );
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/api/plane/db/models/state.py",
        lineNumber: 14,
        content: 'class StateGroup(models.TextChoices):',
        score: 0.99
      },
      {
        fileName: "apps/web/core/components/work-item/commands.ts",
        lineNumber: 198,
        content: "handleUpdateEntity({ state_id: stateId });",
        score: 0.9
      },
      {
        fileName: "apps/api/plane/app/views/issue.py",
        lineNumber: 40,
        content: "raise ValidationError(\"cannot move work item out of backlog\")",
        score: 0.3
      }
    ],
    2,
    ask
  );
  assert.equal(picked[0]?.fileName, "apps/api/plane/app/views/issue.py");
  assert.equal(
    picked.some((hit) => /db\/models|commands\.ts/.test(hit.fileName)),
    false
  );
});

test("C2 skips seed JSON and read-only serializers; prefers the reject snippet", () => {
  const ask = COPILOT_C2_ASK;
  assert.equal(shouldSkipEvidencePath("apps/api/plane/seeds/data/issues.json", ask), true);
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/api/plane/seeds/data/issues.json",
        lineNumber: 12,
        content: '"state_id": 3,',
        score: 0.99
      },
      {
        fileName: "apps/api/plane/app/serializers/issue.py",
        lineNumber: 728,
        content: "state_detail = StateLiteSerializer(read_only=True, source=\"state\")",
        score: 0.95
      },
      {
        fileName: "apps/api/plane/app/views/issue.py",
        lineNumber: 40,
        content: "raise ValidationError(\"cannot move work item out of backlog\")",
        score: 0.2
      }
    ],
    2,
    ask
  );
  assert.equal(picked[0]?.fileName, "apps/api/plane/app/views/issue.py");
  assert.equal(
    picked.some((hit) => /seeds\//.test(hit.fileName)),
    false
  );
});

test("filterWriteRejectFiles drops OpenAPI and read-only serializer windows", () => {
  const kept = filterWriteRejectFiles(
    [
      {
        path: "apps/api/plane/settings/openapi.py",
        content: "Work Items & Tasks"
      },
      {
        path: "apps/api/plane/app/serializers/issue.py",
        content: "state_detail = StateLiteSerializer(read_only=True, source=\"state\")"
      },
      {
        path: "apps/api/plane/app/serializers/issue.py",
        content:
          'raise serializers.ValidationError("State is not valid please pass a valid state_id")'
      }
    ],
    COPILOT_C2_ASK
  );
  assert.equal(kept.length, 1);
  assert.match(kept[0]?.content ?? "", /State is not valid/);
});

test("C2 skips OpenAPI specs and does not treat partial_update as a reject", () => {
  const ask = COPILOT_C2_ASK;
  assert.equal(shouldSkipEvidencePath("apps/api/plane/settings/openapi.py", ask), true);
  assert.equal(contentLooksLikeWriteReject("    def partial_update(self, request, slug, project_id, pk):"), false);
  assert.equal(
    contentLooksLikeWriteReject(
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")'
    ),
    true
  );
});

test("C2 skips query-filter converters and does not stop on generic ValidationError", () => {
  const ask = COPILOT_C2_ASK;
  assert.equal(
    shouldSkipEvidencePath("apps/api/plane/utils/filters/converters.py", ask),
    true
  );
  const filterWindow = [
    "    def _validate_value(self, rich_field_name: str, value: Any) -> bool:",
    '        if rich_field_name in self.UUID_FIELDS:',
    "            return self._validate_uuid(value)",
    '        raise ValidationError("Invalid filter value")'
  ].join("\n");
  assert.equal(contentLooksLikeStateTransitionReject(filterWindow), false);
  assert.equal(
    contentLooksLikeStateTransitionReject(
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")'
    ),
    true
  );
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/api/plane/utils/filters/converters.py",
        lineNumber: 184,
        content: "def _validate_value(self, rich_field_name: str, value: Any) -> bool:",
        score: 0.99
      },
      {
        fileName: "apps/api/plane/app/serializers/issue.py",
        lineNumber: 12,
        content:
          'raise serializers.ValidationError("State is not valid please pass a valid state_id")',
        score: 0.3
      }
    ],
    2,
    ask
  );
  assert.equal(picked[0]?.fileName, "apps/api/plane/app/serializers/issue.py");
  assert.equal(
    picked.some((hit) => /filters\/converters/.test(hit.fileName)),
    false
  );
});

test("C2 does not pick a permission-only view when a reject snippet exists", () => {
  const ask = COPILOT_C2_ASK;
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/api/plane/app/views/intake.py",
        lineNumber: 80,
        content: "def partial_update(self, request, slug, project_id, pk):",
        score: 0.95
      },
      {
        fileName: "apps/api/plane/app/serializers/issue.py",
        lineNumber: 12,
        content:
          'raise serializers.ValidationError("State is not valid please pass a valid state_id")',
        score: 0.4
      }
    ],
    2,
    ask
  );
  assert.equal(picked[0]?.fileName, "apps/api/plane/app/serializers/issue.py");
  assert.equal(
    picked.some((hit) => /views\/intake/.test(hit.fileName)),
    false
  );
});

test("lineNumberOfWriteReject prefers ValidationError near state", () => {
  const body = [
    "class IssueStateFlatSerializer:",
    "    state_detail = StateLiteSerializer(read_only=True, source=\"state\")",
    "",
    "class IssueSerializer:",
    "    def validate(self, data):",
    '        raise serializers.ValidationError("State is not valid please pass a valid state_id")'
  ].join("\n");
  assert.equal(lineNumberOfWriteReject(body), 6);
});

test("lineNumberOfWriteReject ignores filter ValidationError that is not a state transition", () => {
  const body = [
    "class FilterConverter:",
    "    def _validate_value(self, rich_field_name, value):",
    '        if rich_field_name == "state":',
    '            raise ValidationError("Invalid filter value")'
  ].join("\n");
  assert.equal(lineNumberOfWriteReject(body), undefined);
});

test("Where is requireAuth defined still requires that symbol", () => {
  assert.equal(queryHasNamedSymbol("Where is requireAuth defined?"), true);
  assert.equal(extractAgentSearchQuery("Where is requireAuth defined?"), "requireAuth");
});

test("Where is the Button component still searches Button", () => {
  assert.equal(
    extractAgentSearchQuery("Where is the Button component defined in this repo?"),
    "Button"
  );
  assert.equal(
    queryHasNamedSymbol("Where is the Button component defined in this repo?"),
    false
  );
});

test("edit tests-for-X prefers the callee over the test-file stem", () => {
  assert.equal(extractAgentSearchQuery(COPILOT_C5_ASK), "extractBearerToken");
  assert.equal(queryHasNamedSymbol(COPILOT_C5_ASK), true);
});

test("filename asks are file hunts, not required in-body symbols", () => {
  const findAsk = "Find authMiddleware.ts and show me the export.";
  const readAsk = "Read src/server/authMiddleware.ts and show me the export.";
  assert.deepEqual(extractNamedSourceFiles(findAsk), ["authMiddleware.ts"]);
  assert.deepEqual(extractNamedSourceFiles(readAsk), ["src/server/authMiddleware.ts"]);
  assert.equal(queryHasNamedSymbol(findAsk), false);
  assert.equal(queryHasNamedSymbol(readAsk), false);
  assert.equal(queryHasNamedSymbol("Where is requireAuth defined?"), true);
  assert.equal(queryNamesSourceFile("src/server/authMiddleware.ts", findAsk), true);
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "src/server/authMiddleware.ts",
        lineNumber: 1,
        content: "export function extractBearerToken() {}",
        score: 0.4
      },
      {
        fileName: "web/login-form.tsx",
        lineNumber: 1,
        content: "export function LoginForm() {}",
        score: 0.9
      }
    ],
    2,
    findAsk
  );
  assert.equal(picked[0]?.fileName, "src/server/authMiddleware.ts");
});

test("API-reject hunt is a class: C2, parent, and assignee fields all match", () => {
  assert.equal(isApiRejectAsk(COPILOT_C2_ASK), true);
  assert.equal(isApiRejectAsk(COPILOT_T2_ASK), true);
  assert.equal(isApiRejectAsk(COPILOT_ASSIGNEE_REJECT_ASK), true);
  assert.equal(isApiRejectAsk("Where is the Button component defined in this repo?"), false);
  assert.equal(isApiRejectAsk("Where does the API create an issue?"), false);
});

test("T2 hunt searches parent field access, not bare issue_id", () => {
  const primary = extractAgentSearchQuery(COPILOT_T2_ASK);
  assert.match(primary, /parent/i);
  assert.notEqual(primary.toLowerCase(), "issue_id");
  const fallbacks = fallbackAgentSearchQueries(COPILOT_T2_ASK);
  assert.equal(fallbacks[0]?.toLowerCase() === "issue_id", false);
  assert.equal(
    fallbacks.slice(0, 6).some((q) => /get\("parent"\)/.test(q) || /parent is not valid/i.test(q)),
    true,
    `T2 first queries must include parent access or slogan, got ${fallbacks.join(", ")}`
  );
  assert.equal(
    apiRejectSearchQueries(COPILOT_T2_ASK).some((q) => /ValidationError parent/i.test(q)),
    true
  );
  assert.equal(
    apiRejectSearchQueries(COPILOT_T2_ASK).some((q) => /get\("parent"\)/.test(q)),
    true
  );
});

test("API-reject hunts do not latch *_id as a named symbol", () => {
  assert.equal(queryHasNamedSymbol(COPILOT_T2_ASK), false);
  assert.equal(queryHasNamedSymbol(COPILOT_ASSIGNEE_REJECT_ASK), false);
  assert.equal(queryHasNamedSymbol(COPILOT_C2_ASK), false);
  assert.equal(queryHasNamedSymbol("Where is requireAuth defined?"), true);
});

test("asked-field tokens use the qualifier, not a type suffix like issue_id", () => {
  const parentFields = askedRejectFieldTokens(
    "Where does the API reject a bad parent issue_id?"
  );
  assert.ok(parentFields.includes("parent"));
  assert.equal(parentFields.includes("issue_id"), false);
  const ownerFields = askedRejectFieldTokens("Where does the API reject a bad owner_id?");
  assert.ok(ownerFields.includes("owner"));
  assert.ok(ownerFields.includes("owner_id"));
});

test("wrong-field validate() is not an asked-field reject", () => {
  const htmlValidate = [
    "def validate(self, data):",
    "    if data.get(\"comment_html\"):",
    "        raise serializers.ValidationError({\"comment_html\": \"HTML content is not valid\"})",
    "    return data"
  ].join("\n");
  const parentReject =
    'if data.get("parent"):\n    raise serializers.ValidationError("Parent is not valid issue_id")';
  const ask = "Where does the API reject a bad parent issue_id?";
  assert.equal(contentLooksLikeAskedFieldReject(htmlValidate, ask), false);
  assert.equal(contentLooksLikeWrongFieldReject(htmlValidate, ask), true);
  assert.equal(contentLooksLikeAskedFieldReject(parentReject, ask), true);
  assert.equal(contentLooksLikeWrongFieldReject(parentReject, ask), false);
  const kept = filterWriteRejectFiles(
    [
      { path: "api/serializers/item.py", content: htmlValidate },
      { path: "app/serializers/item.py", content: parentReject }
    ],
    ask
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.path, "app/serializers/item.py");
});

test("asked-field reject keeps the matching ValidationError and drops converters", () => {
  const parentBody = 'raise serializers.ValidationError("Parent is not valid issue_id")';
  const assigneeBody = 'raise serializers.ValidationError("Assignee is not valid assignee_id")';
  const stateBody =
    'raise serializers.ValidationError("State is not valid please pass a valid state_id")';
  const filterBody = 'raise ValidationError("Invalid filter value")';
  assert.equal(contentLooksLikeAskedFieldReject(parentBody, COPILOT_T2_ASK), true);
  assert.equal(contentLooksLikeAskedFieldReject(assigneeBody, COPILOT_ASSIGNEE_REJECT_ASK), true);
  assert.equal(contentLooksLikeAskedFieldReject(stateBody, COPILOT_C2_ASK), true);
  assert.equal(contentLooksLikeAskedFieldReject(filterBody, COPILOT_T2_ASK), false);
  assert.equal(contentLooksLikeAskedFieldReject(parentBody, COPILOT_C2_ASK), false);
  const t2Picked = pickSearchHitsToRead(
    [
      {
        fileName: "apps/api/utils/filters/converters.py",
        lineNumber: 184,
        content: "def _validate_value(self, rich_field_name: str, value: Any) -> bool:",
        score: 0.99
      },
      {
        fileName: "apps/api/app/serializers/issue.py",
        lineNumber: 40,
        content: parentBody,
        score: 0.2
      }
    ],
    2,
    COPILOT_T2_ASK
  );
  assert.equal(t2Picked[0]?.fileName, "apps/api/app/serializers/issue.py");
});

test("API-reject pick prefers asked-field reject over a different field's validate()", () => {
  const ask = "Where does the API reject a bad parent issue_id?";
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "api/serializers/item.py",
        lineNumber: 10,
        content:
          'raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
        score: 0.99
      },
      {
        fileName: "app/serializers/item.py",
        lineNumber: 40,
        content: 'raise serializers.ValidationError("Parent is not valid issue_id")',
        score: 0.2
      }
    ],
    2,
    ask
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.fileName, "app/serializers/item.py");
});

test("API-reject pick keeps a serializer with a wrong-field snippet so hunt can jump in-file", () => {
  const ask = "Where does the API reject a bad parent issue_id?";
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "api/serializers/item.py",
        lineNumber: 10,
        content:
          'raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
        score: 0.9
      },
      {
        fileName: "utils/filters/converters.py",
        lineNumber: 184,
        content: 'raise ValidationError("Invalid filter value")',
        score: 0.95
      }
    ],
    2,
    ask
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.fileName, "api/serializers/item.py");
});

test("filterWriteRejectFiles keeps the asked field reject, not OpenAPI", () => {
  const kept = filterWriteRejectFiles(
    [
      { path: "apps/api/settings/openapi.py", content: "Work Items" },
      {
        path: "apps/api/app/serializers/issue.py",
        content: 'raise serializers.ValidationError("Parent is not valid issue_id")'
      }
    ],
    COPILOT_T2_ASK
  );
  assert.equal(kept.length, 1);
  assert.match(kept[0]?.content ?? "", /Parent is not valid/);
});

test("asked-field reject matches a raise whose message does not repeat the field", () => {
  const ask =
    "A client sent a reviewer that isn’t on the team — the API returns an error. Where does the API reject a bad reviewer_id?";
  const reviewerReject = [
    'if data.get("reviewer"):',
    '    raise serializers.ValidationError("user not in project")'
  ].join("\n");
  const htmlValidate = [
    "def validate(self, data):",
    '    if data.get("comment_html"):',
    '        raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
    "    return data"
  ].join("\n");
  assert.equal(contentLooksLikeAskedFieldReject(reviewerReject, ask), true);
  assert.equal(contentLooksLikeAskedFieldReject(htmlValidate, ask), false);
  const queries = apiRejectSearchQueries(ask);
  assert.equal(
    queries.some((q) => /get\("reviewer"\)/.test(q) || q.toLowerCase() === "reviewer"),
    true,
    `must search field access, got ${queries.join(", ")}`
  );
});

test("API-reject job: invite email is not a signup email reject", () => {
  const ask =
    "A client sent an org invite with a blank email — the API returns an error. Where does the API reject a bad email?";
  assert.deepEqual(askedRejectJobTokens(ask), ["invite"]);
  const signup = [
    "export function handleSignup(body) {",
    "  if (!isValidEmail(body.email)) {",
    '    raise ValidationError({"email": "Enter a valid email address."})',
    "  }",
    "}"
  ].join("\n");
  const invite = [
    "export async function inviteUser(input) {",
    "  const email = input.email.trim();",
    '  if (!email) {',
    '    throw new Error("email is required");',
    "  }",
    "}"
  ].join("\n");
  assert.equal(contentLooksLikeAskedFieldReject(signup, ask, "app/signup_api.py"), false);
  assert.equal(contentLooksLikeAskedFieldReject(invite, ask, "app/invite_user.py"), true);
  assert.equal(
    shouldSkipEvidencePath("app/signup_api.test.ts", ask),
    true
  );
  const queries = apiRejectSearchQueries(ask);
  assert.equal(
    queries.some((q) => /^invite$/i.test(q) || /invite email/i.test(q)),
    true,
    `must search the invite job, got ${queries.join(", ")}`
  );
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "app/signup_api.py",
        lineNumber: 3,
        content: 'raise ValidationError({"email": "Enter a valid email address."})',
        score: 0.99
      },
      {
        fileName: "app/invite_user.py",
        lineNumber: 4,
        content: 'throw new Error("email is required")',
        score: 0.2
      },
      {
        fileName: "app/signup_api.test.ts",
        lineNumber: 20,
        content: 'assert.equal(response.body.error, "invalid_email")',
        score: 0.95
      }
    ],
    2,
    ask
  );
  assert.equal(picked[0]?.fileName, "app/invite_user.py");
  assert.equal(
    picked.some((hit) => /signup/i.test(hit.fileName)),
    false
  );
});

test("API-reject hunt ignores invite callers that rethrow and pass email through", () => {
  const ask =
    "A client sent an org invite with a blank email — the API returns an error. Where does the API reject a bad email?";
  const caller = [
    "    try {",
    "      inviteResult = await inviteUser({ email: adminEmail, role: \"admin\" });",
    "    } catch (error) {",
    "      if (isSeatLimitError(error)) {",
    "        writeJson(response, 403, { error: error.code, seats: error.seats, used: error.used });",
    "        return true;",
    "      }",
    "      throw error;",
    "    }"
  ].join("\n");
  const check = [
    "export async function inviteUser(input) {",
    "  const email = input.email.trim();",
    "  if (!email) {",
    '    throw new Error("email is required");',
    "  }",
    "}"
  ].join("\n");
  const http400 = [
    "  const email = String(body.email ?? \"\").trim();",
    "  if (!email) {",
    '    writeJson(response, 400, { error: "email is required" });',
    "    return true;",
    "  }"
  ].join("\n");
  assert.equal(contentLooksLikeWriteReject("      throw error;"), false);
  assert.equal(contentLooksLikeAskedFieldReject(caller, ask, "app/org_api.ts"), false);
  assert.equal(contentLooksLikeAskedFieldReject(check, ask, "app/invite_user.ts"), true);
  assert.equal(contentLooksLikeAskedFieldReject(http400, ask, "app/invite_handler.ts"), true);
  assert.equal(
    lineNumberOfWriteReject(`${caller}\n\n${check}`, ask, "app/invite_user.ts"),
    14
  );
  const picked = pickSearchHitsToRead(
    [
      {
        fileName: "app/org_api.ts",
        lineNumber: 8,
        content: caller,
        score: 0.99
      },
      {
        fileName: "app/invite_user.ts",
        lineNumber: 4,
        content: check,
        score: 0.2
      }
    ],
    2,
    ask
  );
  assert.equal(picked[0]?.fileName, "app/invite_user.ts");
  assert.equal(
    picked.some((hit) => hit.fileName === "app/org_api.ts"),
    false
  );
  const queries = apiRejectSearchQueries(ask);
  assert.equal(
    queries.some((q) => /email is required/i.test(q)),
    true,
    `must search the reject slogan, got ${queries.join(", ")}`
  );
});

console.log(`\nsearchQuery: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

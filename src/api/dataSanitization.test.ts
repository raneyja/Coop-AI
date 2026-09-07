import assert from "node:assert/strict";
import { sanitizeCode, sanitizeLlmRequestPayload } from "./dataSanitization";

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

test("sanitizeCode preserves token variable assignments used in SEARCH blocks", () => {
  const source = [
    "def authenticate(self, request):",
    "    token = self.get_api_token(request)",
    "    user = self.validate_api_token(token)",
    "    return user, token"
  ].join("\n");
  const sanitized = sanitizeCode(source);
  assert.ok(sanitized.includes("token = self.get_api_token(request)"));
  assert.ok(!sanitized.includes("TOKEN_REDACTED"));
  assert.ok(!sanitized.includes("$1="));
});

test("sanitizeCode preserves object property token: hashedToken", () => {
  const source = ["where: {", "  token: hashedToken,", "},"].join("\n");
  const sanitized = sanitizeCode(source);
  assert.equal(sanitized, source);
});

test("sanitizeCode still redacts quoted token secrets with real backrefs", () => {
  const source = 'const token = "sk_live_abcdefghijklmnopqrstuv";';
  const sanitized = sanitizeCode(source);
  assert.ok(sanitized.includes('token="TOKEN_REDACTED"') || sanitized.includes("TOKEN_REDACTED"));
  assert.ok(!sanitized.includes("$1="), "must not leave literal $1= replacement templates");
  assert.ok(!sanitized.includes("sk_live_abcdefghijklmnopqrstuv"));
});

test("sanitizeLlmRequestPayload keeps auth middleware identifiers intact", () => {
  const payload = sanitizeLlmRequestPayload({
    messages: [
      {
        role: "user",
        content: "<file_content>\napi_token = request.headers.get('X-Api-Key')\n</file_content>"
      }
    ]
  });
  assert.ok(payload.payload.messages?.[0]?.content.includes("api_token = request.headers.get"));
  assert.ok(!payload.payload.messages?.[0]?.content.includes("$1="));
});

test("sanitizeLlmRequestPayload preserves token: hashedToken inside file_content for /edit", () => {
  const content = [
    "<attached_context>",
    '<editor_selection path="get-api-token-by-token.ts" lines="21-52">',
    "const apiToken = await prisma.apiToken.findFirst({",
    "  where: {",
    "    token: hashedToken,",
    "  },",
    "});",
    "</editor_selection>",
    "<local_files>",
    '<file_content path="get-api-token-by-token.ts">',
    "const apiToken = await prisma.apiToken.findFirst({",
    "  where: {",
    "    token: hashedToken,",
    "  },",
    "});",
    "</file_content>",
    "</local_files>",
    "</attached_context>"
  ].join("\n");

  const payload = sanitizeLlmRequestPayload({
    messages: [{ role: "user", content }]
  });
  const out = payload.payload.messages?.[0]?.content ?? "";
  assert.ok(out.includes("token: hashedToken,"), "identifier property must survive for SEARCH");
  assert.ok(!out.includes("TOKEN_REDACTED"), "must not redact hashedToken identifier");
  assert.ok(!out.includes("$1="), "must not emit literal $1 templates");
});

test("sanitizeLlmRequestPayload still redacts sk_ tokens inside file_content", () => {
  const payload = sanitizeLlmRequestPayload({
    messages: [
      {
        role: "user",
        content: "<file_content>\nconst key = \"sk_live_abcdefghijklmnopqrstuv\";\n</file_content>"
      }
    ]
  });
  const out = payload.payload.messages?.[0]?.content ?? "";
  assert.ok(!out.includes("sk_live_abcdefghijklmnopqrstuv"));
  assert.ok(out.includes("sk_***"));
});

function s1ReadFileToolJson(): string {
  const body = [
    "# Copyright (c) 2023-present Plane Software, Inc. and contributors",
    "",
    "class APIKeyAuthentication:",
    "    \"\"\"Authenticate API requests with an X-Api-Key header.\"\"\"",
    "    def authenticate(self, request):",
    "        token = request.headers.get(\"X-Api-Key\")",
    "        return True"
  ].join("\n");
  const numbered = body.split("\n").map((row, i) => `${i + 1}|${row}`).join("\n");
  return JSON.stringify({
    path: "apps/api/plane/api/middleware/api_authentication.py",
    startLine: 1,
    files: [
      {
        path: "apps/api/plane/api/middleware/api_authentication.py",
        content: numbered
      }
    ]
  });
}

test("sanitizeLlmRequestPayload keeps APIKeyAuthentication in agent read_file JSON (S1)", () => {
  const payload = sanitizeLlmRequestPayload({
    messages: [{ role: "user", content: s1ReadFileToolJson() }]
  });
  const out = payload.payload.messages?.[0]?.content ?? "";
  assert.ok(out.includes("class APIKeyAuthentication:"), "model must see the class, not a wiped file");
  assert.ok(out.includes("X-Api-Key"), "model must see what the class authenticates");
  assert.equal(out.includes("REDACTED_SENSITIVE_COMMENT"), false);
});

test("sanitizeLlmRequestPayload keeps APIKeyAuthentication in search_code JSON snippets", () => {
  const toolJson = JSON.stringify({
    hits: [
      {
        fileName: "apps/api/plane/api/middleware/api_authentication.py",
        lineNumber: 1,
        content: "# APIKeyAuthentication middleware\nclass APIKeyAuthentication:"
      }
    ],
    symbols: [
      {
        file: "apps/api/plane/api/middleware/api_authentication.py",
        line: 17,
        symbol: "APIKeyAuthentication",
        kind: "class"
      }
    ]
  });
  const payload = sanitizeLlmRequestPayload({
    messages: [{ role: "user", content: toolJson }]
  });
  const out = payload.payload.messages?.[0]?.content ?? "";
  assert.ok(out.includes("class APIKeyAuthentication:"));
  assert.ok(out.includes("\"line\":17") || out.includes('"line": 17'));
  assert.equal(out.includes("REDACTED_SENSITIVE_COMMENT"), false);
});

test("sanitizeLlmRequestPayload still redacts sk_live inside agent read_file JSON", () => {
  const toolJson = JSON.stringify({
    files: [
      {
        path: "apps/api/plane/api/middleware/api_authentication.py",
        content: "1|# demo\n2|KEY = \"sk_live_abcdefghijklmnopqrstuv\""
      }
    ]
  });
  const payload = sanitizeLlmRequestPayload({
    messages: [{ role: "user", content: toolJson }]
  });
  const out = payload.payload.messages?.[0]?.content ?? "";
  assert.ok(!out.includes("sk_live_abcdefghijklmnopqrstuv"));
  assert.ok(out.includes("sk_***"));
});

test("sanitizeCode does not wipe APIKeyAuthentication comments; still redacts assigned secrets", () => {
  const source = [
    "# APIKeyAuthentication authenticates API token headers",
    "class APIKeyAuthentication:",
    "    pass",
    "# password: hunter2"
  ].join("\n");
  const sanitized = sanitizeCode(source);
  assert.ok(sanitized.includes("class APIKeyAuthentication:"));
  assert.ok(sanitized.includes("APIKeyAuthentication authenticates"));
  assert.ok(sanitized.includes("[REDACTED_SENSITIVE_COMMENT]"));
  assert.ok(!sanitized.includes("hunter2"));
});

console.log(`\ndataSanitization: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

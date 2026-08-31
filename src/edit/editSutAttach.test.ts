import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPILOT_C5_ASK } from "../api/agent/dogfoodContract";
import { formatChatMessageWithLocalFiles, systemPromptForUseCase } from "../prompts/systemPrompts";
import {
  isTestSourcePath,
  mergeSutFile,
  namedCalleeForEditAsk,
  siblingImplementationPath,
  snippetDefinesSymbol,
  evaluateNamedFunctionAtElapsedMs,
  rewriteTestReplaceToMatchSut,
  sutAssertionGrounding,
  sutNumericExpectation,
  sutPathForEditAsk
} from "./editSutAttach";

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

test("test path detection and sibling mapping", () => {
  assert.equal(isTestSourcePath("src/server/authMiddleware.test.ts"), true);
  assert.equal(isTestSourcePath("src/server/authMiddleware.ts"), false);
  assert.equal(
    siblingImplementationPath("src/server/authMiddleware.test.ts"),
    "src/server/authMiddleware.ts"
  );
  assert.equal(siblingImplementationPath("foo.spec.tsx"), "foo.tsx");
  assert.equal(siblingImplementationPath("bar_test.py"), "bar.py");
  assert.equal(sutPathForEditAsk("src/server/authMiddleware.test.ts"), "src/server/authMiddleware.ts");
  assert.equal(sutPathForEditAsk("src/server/authMiddleware.ts"), undefined);
});

test("C5 ask names extractBearerToken as the callee", () => {
  assert.equal(namedCalleeForEditAsk(COPILOT_C5_ASK), "extractBearerToken");
});

test("snippetDefinesSymbol matches the real extractBearerToken export", () => {
  const body =
    'export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {\n  return undefined;\n}\n';
  assert.equal(snippetDefinesSymbol(body, "extractBearerToken"), true);
  assert.equal(snippetDefinesSymbol("export function requireAuth() {}", "extractBearerToken"), false);
});

test("mergeSutFile appends the implementation next to the test file", () => {
  const merged = mergeSutFile(
    {
      source: "remote-codehost",
      activeFile: "src/server/authMiddleware.test.ts",
      files: [
        {
          path: "src/server/authMiddleware.test.ts",
          content: "import assert from \"node:assert/strict\";\n",
          encoding: "utf8"
        }
      ],
      fallbackLevel: "partial"
    },
    {
      path: "src/server/authMiddleware.ts",
      content:
        'export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {\n  const header = headers.authorization ?? "";\n  return header;\n}\n',
      encoding: "utf8"
    }
  );
  assert.equal(merged.files.length, 2);
  assert.equal(merged.files[1]?.path, "src/server/authMiddleware.ts");
});

test("C5 edit prompt includes the real signature and import contract", () => {
  const sut =
    'export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {\n  const header = headers.authorization ?? "";\n  if (!header.startsWith("Bearer ")) {\n    return undefined;\n  }\n  return header.slice("Bearer ".length).trim() || undefined;\n}\n';
  const prompt = formatChatMessageWithLocalFiles({
    message: COPILOT_C5_ASK,
    file: "src/server/authMiddleware.test.ts",
    files: [
      {
        path: "src/server/authMiddleware.test.ts",
        content:
          'import {\n  requireAuth\n} from "./authMiddleware";\n\nassert.equal(requireAuth(undefined, true), false);\nassert.equal(extractBearerToken({ authorization: "Bearer some-api-key" }), undefined);\n'
      },
      {
        path: "src/server/authMiddleware.ts",
        content: sut
      }
    ]
  });
  assert.match(prompt, /headers: Record<string, string \| undefined>/);
  assert.match(prompt, /authorization: "Bearer some-api-key"/);
  assert.match(prompt, /src\/server\/authMiddleware\.ts/);
  const editSystem = systemPromptForUseCase("code_edit");
  assert.match(editSystem, /copy arity and types/i);
  assert.match(editSystem, /import hunk/i);
});

test("T8 /edit encodes gather=0 at 10s from the attached SUT, not greater than zero", () => {
  const sut = [
    "export const MAX_USER_FACING_RESPONSE_MS = 15_000;",
    "export const RESERVED_SYNTHESIS_MS = 6_000;",
    "export function remainingContextGatherBudgetMs(startedAt: number, now = Date.now(), maxMs = MAX_USER_FACING_RESPONSE_MS, reserveSynthesisMs = RESERVED_SYNTHESIS_MS) {",
    "  return Math.max(0, maxMs - (now - startedAt) - reserveSynthesisMs);",
    "}"
  ].join("\n");
  const ask =
    "/edit Add one test to src/config/responseDeadline.test.ts: remainingContextGatherBudgetMs 10 seconds after start is still greater than zero. Match this file’s node:test style. Do not rewrite the existing suite.";
  const files = [
    { path: "src/config/responseDeadline.test.ts", content: "import { remainingContextGatherBudgetMs } from \"./responseDeadline\";\n" },
    { path: "src/config/responseDeadline.ts", content: sut }
  ];
  const grounding = sutAssertionGrounding(ask, files);
  assert.match(grounding ?? "", /returns 0/);
  assert.match(grounding ?? "", /do not copy “greater than zero”/i);
  const prompt = formatChatMessageWithLocalFiles({
    message: ask,
    file: "src/config/responseDeadline.test.ts",
    files
  });
  assert.match(prompt, /<sut_assertions>/);
  assert.match(prompt, /returns 0/);
});

test("/edit tests encode attached constants for any elapsed-budget function", () => {
  const sut = [
    "export const MAX_WAIT_MS = 8_000;",
    "export const RESERVE_MS = 3_000;",
    "export function remainingRetryBudgetMs(startedAt: number, now = Date.now(), maxMs = MAX_WAIT_MS, reserveMs = RESERVE_MS) {",
    "  return Math.max(0, maxMs - (now - startedAt) - reserveMs);",
    "}"
  ].join("\n");
  const ask =
    "/edit Add one test: remainingRetryBudgetMs 6 seconds after start is still greater than zero.";
  const files = [
    { path: "src/retry.test.ts", content: "import { remainingRetryBudgetMs } from \"./retry\";\n" },
    { path: "src/retry.ts", content: sut }
  ];
  assert.equal(evaluateNamedFunctionAtElapsedMs(sut, "remainingRetryBudgetMs", 6_000), 0);
  const grounding = sutAssertionGrounding(ask, files);
  assert.match(grounding ?? "", /returns 0/);
  const rewritten = rewriteTestReplaceToMatchSut(
    `  await test("still greater than zero", () => {\n    const left = remainingRetryBudgetMs(started, started + 6_000);\n    assert.ok(left > 0);\n  });`,
    0
  );
  assert.match(rewritten, /assert\.equal\(left, 0\)/);
  assert.doesNotMatch(rewritten, /assert\.ok\(left > 0\)/);
});

test("rewriteTestReplaceToMatchSut rewrites MAX-RESERVED budget asserts to the SUT value", () => {
  const rewritten = rewriteTestReplaceToMatchSut(
    `    const gather = remainingContextGatherBudgetMs(started, started + 10_000);\n    assert.equal(gather, MAX_USER_FACING_RESPONSE_MS - RESERVED_SYNTHESIS_MS);`,
    0
  );
  assert.match(rewritten, /assert\.equal\(gather, 0\)/);
  assert.doesNotMatch(rewritten, /MAX_USER_FACING_RESPONSE_MS/);
});

test("evaluateNamedFunctionAtElapsedMs follows a nested helper inside Math.max", () => {
  const sut = [
    "export const MAX_WAIT_MS = 8_000;",
    "export const RESERVE_MS = 3_000;",
    "export function remainingWaitMs(startedAt: number, now = Date.now(), maxMs = MAX_WAIT_MS) {",
    "  return Math.max(0, maxMs - (now - startedAt));",
    "}",
    "export function remainingRetryBudgetMs(startedAt: number, now = Date.now(), maxMs = MAX_WAIT_MS, reserveMs = RESERVE_MS) {",
    "  return Math.max(0, remainingWaitMs(startedAt, now, maxMs) - reserveMs);",
    "}"
  ].join("\n");
  assert.equal(evaluateNamedFunctionAtElapsedMs(sut, "remainingRetryBudgetMs", 6_000), 0);
});

test("sutNumericExpectation encodes the attached remainingContextGatherBudgetMs file", () => {
  const src = readFileSync("src/config/responseDeadline.ts", "utf8");
  const ask =
    "/edit Add one test to this file for remainingContextGatherBudgetMs 10 seconds after start. Match this file’s node:test style. Do not rewrite the existing suite.";
  const expectation = sutNumericExpectation(ask, [
    { path: "src/config/responseDeadline.test.ts", content: 'import { remainingContextGatherBudgetMs } from "./responseDeadline";\n' },
    { path: "src/config/responseDeadline.ts", content: src }
  ]);
  assert.equal(expectation?.actual, 0);
  const rewritten = rewriteTestReplaceToMatchSut(
    `    const gather = remainingContextGatherBudgetMs(started, Date.now() + 10_000);\n    assert.equal(gather, MAX_USER_FACING_RESPONSE_MS - RESERVED_SYNTHESIS_MS);`,
    expectation!.actual
  );
  assert.match(rewritten, /assert\.equal\(gather, 0\)/);
});

console.log(`\neditSutAttach: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

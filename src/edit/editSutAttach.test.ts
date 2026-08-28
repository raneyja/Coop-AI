import assert from "node:assert/strict";
import { COPILOT_C5_ASK } from "../api/agent/dogfoodContract";
import { formatChatMessageWithLocalFiles, systemPromptForUseCase } from "../prompts/systemPrompts";
import {
  isTestSourcePath,
  mergeSutFile,
  namedCalleeForEditAsk,
  siblingImplementationPath,
  snippetDefinesSymbol,
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

console.log(`\neditSutAttach: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

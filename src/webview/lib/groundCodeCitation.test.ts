import assert from "node:assert/strict";
import { applyGroundedCitations, groundCodeCitation } from "./groundCodeCitation";

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

const FILE = `import type { AuthContext } from "./orgStore";

export type AuthenticatedRequest = {
  auth?: AuthContext;
};

export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {
  return undefined;
}

export function requireAuth(
  auth: AuthContext | undefined,
  requireInProduction: boolean
): auth is AuthContext {
  if (auth) {
    return true;
  }
  return !requireInProduction;
}
`;

test("keeps claimed lines when the file slice already matches", () => {
  const snippet = `export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {
  return undefined;
}`;
  const grounded = groundCodeCitation(FILE, snippet, 7, 9);
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.startLine, 7);
  assert.equal(grounded.endLine, 9);
});

test("relocates a snippet the model attached to the wrong lines", () => {
  const snippet = `export function requireAuth(
  auth: AuthContext | undefined,
  requireInProduction: boolean
): auth is AuthContext {
  if (auth) {
    return true;
  }
  return !requireInProduction;
}`;
  const grounded = groundCodeCitation(FILE, snippet, 7, 15);
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.startLine, 11);
  assert.equal(grounded.endLine, 19);
  assert.ok(grounded.code.startsWith("export function requireAuth("));
});

test("rewrites the citation fence locator to the real line range", () => {
  const markdown = [
    "Defined here:",
    "",
    "```7:15:src/server/authMiddleware.ts",
    "export function requireAuth(",
    "  auth: AuthContext | undefined,",
    "  requireInProduction: boolean",
    "): auth is AuthContext {",
    "  if (auth) {",
    "    return true;",
    "  }",
    "  return !requireInProduction;",
    "}",
    "```"
  ].join("\n");
  const rewritten = applyGroundedCitations(
    markdown,
    new Map([["src/server/authMiddleware.ts", FILE]])
  );
  assert.ok(rewritten.includes("```11:19:src/server/authMiddleware.ts"));
  assert.equal(rewritten.includes("```7:15:src/server/authMiddleware.ts"), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

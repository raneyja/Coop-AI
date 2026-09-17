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

const DEADLINE_FILE = `/**
 * Soft latency guidance for chat / quick actions.
 *
 * 15s is a *start answering* guideline — stop gathering context and hand off to
 * the model with whatever evidence we have. It must never abort the turn,
 * kill the model, or replace an answer with a timeout message.
 *
 * Soft gather is silent to the user: synthesize with partial evidence, do not
 * post degradation banners or engineer jargon about “budget exhausted.”
 *
 * Agent-owned locate / understand / change turns use \`AGENT_JOB_WALL_MS\` instead
 * of this gather budget — see agentJobBudget.ts.
 */
export const MAX_USER_FACING_RESPONSE_MS = 15_000;
`;

test("restores cite-body comment lines dropped from the claimed range", () => {
  const stripped = `/**
 * Soft latency guidance for chat / quick actions.
 *
 * 15s is a *start answering* guideline — stop gathering context and hand off to
 * the model with whatever evidence we have. It must never abort the turn,
 * kill the model, or replace an answer with a timeout message.
 *
 * post degradation banners or engineer jargon about “budget exhausted.”
 *
 * Agent-owned locate / understand / change turns use \`AGENT_JOB_WALL_MS\` instead
 */
export const MAX_USER_FACING_RESPONSE_MS = 15_000;`;
  const grounded = groundCodeCitation(DEADLINE_FILE, stripped, 1, 14);
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.startLine, 1);
  assert.equal(grounded.endLine, 14);
  assert.match(grounded.code, /Soft gather is silent to the user/);
  assert.match(grounded.code, /of this gather budget/);
});

test("applyGroundedCitations restores stripped comments inside a citation fence", () => {
  const markdown = [
    "```1:14:src/config/responseDeadline.ts",
    "/**",
    " * Soft latency guidance for chat / quick actions.",
    " *",
    " * 15s is a *start answering* guideline — stop gathering context and hand off to",
    " * the model with whatever evidence we have. It must never abort the turn,",
    " * kill the model, or replace an answer with a timeout message.",
    " *",
    " * post degradation banners or engineer jargon about “budget exhausted.”",
    " *",
    " * Agent-owned locate / understand / change turns use `AGENT_JOB_WALL_MS` instead",
    " */",
    "export const MAX_USER_FACING_RESPONSE_MS = 15_000;",
    "```"
  ].join("\n");
  const rewritten = applyGroundedCitations(
    markdown,
    new Map([["src/config/responseDeadline.ts", DEADLINE_FILE]])
  );
  assert.match(rewritten, /Soft gather is silent to the user/);
  assert.match(rewritten, /of this gather budget/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

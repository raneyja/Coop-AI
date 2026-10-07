import assert from "node:assert/strict";
import { applyGroundedCitations, citationPathsInMarkdown, groundCodeCitation } from "./groundCodeCitation";

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

test("numbered source citations recover actual lines only after body verification", () => {
  const file = "// header\nif (item.status !== Status.PENDING) {\n  throw new Error('Must be pending');\n}";
  const snippet = "2 | if (item.status !== Status.PENDING) {\n3 |   throw new Error('Must be pending');\n4 | }";
  assert.deepEqual(groundCodeCitation(file, snippet), {
    startLine: 2, endLine: 4,
    code: file.split("\n").slice(1).join("\n"), grounded: true
  });
  const wrong = snippet.replace("Status.PENDING", "Status.READY");
  assert.equal(groundCodeCitation(file, wrong).grounded, false);
  assert.equal(groundCodeCitation(file, wrong).code, wrong);
  const markdown = "The guard lives in `server/sign.ts`:\n  ```typescript\n2 |if (item.status !== Status.PENDING) {\n3 |throw new Error('Must be pending');\n4 |}\n5 | ```";
  assert.deepEqual(citationPathsInMarkdown(markdown), ["server/sign.ts"]);
  const recovered = applyGroundedCitations(markdown, new Map([["server/sign.ts", file]]));
  assert.equal(recovered.includes("2:4:server/sign.ts"), true);
  assert.equal(recovered.includes("3 |"), false);
  const malformedTail = `${markdown}\n127:126:server/sign.ts\`\n\`\``;
  assert.equal(applyGroundedCitations(malformedTail, new Map([["server/sign.ts", file]])).includes("2:4:server/sign.ts"), true);
  assert.equal(applyGroundedCitations(markdown.replace("Status.PENDING", "Status.READY"), new Map([["server/sign.ts", file]])).includes("2:4:server/sign.ts"), false);
  const patch = markdown.replace("typescript", "patch").replace("5 | ```", "```");
  assert.deepEqual(citationPathsInMarkdown(patch), []);
  assert.equal(applyGroundedCitations(patch, new Map([["server/sign.ts", file]])), patch);
});

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

test("strict grounding relocates a narrower verified snippet instead of preserving a broad claim", () => {
  const snippet = `export function requireAuth(
  auth: AuthContext | undefined,
  requireInProduction: boolean
): auth is AuthContext {
  if (auth) {
    return true;
  }
  return !requireInProduction;
}`;
  const grounded = groundCodeCitation(FILE, snippet, 7, 19, { strictRange: true });
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.startLine, 11);
  assert.equal(grounded.endLine, 19);
});

test("strict grounding preserves an oversized matching claim for complete rendering", () => {
  const file = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`).join("\n");
  const snippet = file.split("\n").slice(0, 21).join("\n");
  const grounded = groundCodeCitation(file, snippet, 1, 21, { strictRange: true });
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.startLine, 1);
  assert.equal(grounded.endLine, 21);
  assert.equal(grounded.code.split("\n").length, 21);
});

test("strict citation rendering splits an oversized range without dropping source lines", () => {
  const file = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`).join("\n");
  const markdown = ["```1:21:src/example.ts", ...file.split("\n").slice(0, 21), "```"].join("\n");
  const rendered = applyGroundedCitations(markdown, new Map([["src/example.ts", file]]), { strictRange: true });
  assert.equal(rendered.includes("> Citation omitted"), false);
  assert.equal(rendered.includes("```1:20:src/example.ts"), true);
  assert.equal(rendered.includes("```21:21:src/example.ts"), true);
  assert.equal(rendered.includes("line 20"), true);
  assert.equal(rendered.includes("line 21"), true);
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

test("explicit elision restores verified intervening source instead of assigning false lines", () => {
  const lines = ["def update(self, instance, validated_data):", '    assignees = validated_data.pop("assignees", None)',
    ...Array.from({ length: 40 }, (_, index) => `    apply_relation_${index}(instance)`),
    "    instance.updated_at = timezone.now()", "    return super().update(instance, validated_data)"];
  const snippet = [...lines.slice(0, 2), "    ...", ...lines.slice(-2)].join("\n");
  const file = [...Array(233).fill(""), ...lines].join("\n");
  const grounded = groundCodeCitation(file, snippet, 234, 233 + lines.length);
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.code, lines.join("\n"));
  assert.equal(grounded.endLine, 233 + lines.length);
  assert.equal(groundCodeCitation(file, snippet.replace("timezone.now()", "wrong_clock()"), 234, 233 + lines.length).grounded, false);
  assert.equal(groundCodeCitation(file, snippet, 233, 233 + lines.length).grounded, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import {
  applyChangeHuntFinish,
  CUSTOMER_EMPTY_HUNT_ANSWER,
  customerFacingAgentAnswer,
  rewriteCustomerFacingProse
} from "./customerFacingAnswer";

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

test("keeps a reading-list answer and does not append patch internals", () => {
  const prose = "Start with customers.jsp, then CustomerDAO.java.";
  assert.equal(
    customerFacingAgentAnswer({ content: prose, hasApplyPatch: false }),
    prose
  );
});

test("locked-pass answers with no intern-speak stay byte-identical", () => {
  const locked = "requireAuth lives in src/server/authMiddleware.ts.";
  assert.equal(rewriteCustomerFacingProse(locked), locked);
  assert.equal(
    customerFacingAgentAnswer({ content: locked, hasApplyPatch: false }),
    locked
  );
});

test("rewrites I3/I4 intern-speak into teammate English without blanking the bubble", () => {
  const intern = [
    "Slack search returned zero hits for `coop backend`.",
    "There are 16 issue(s) in the attached search sample.",
    "From the evidence bundle, requireAuth is in src/server/authMiddleware.ts.",
    "The index returned no usable matches for `requireAuth`.",
    "If you want I can run the indexed search."
  ].join("\n");
  const out = rewriteCustomerFacingProse(intern);
  assert.match(out, /No mention in Slack of coop backend/i);
  assert.match(out, /16 issues/i);
  assert.match(out, /requireAuth is in src\/server\/authMiddleware\.ts/);
  assert.match(out, /I couldn't find requireAuth in this repo/i);
  assert.doesNotMatch(out, /evidence bundle|search sample|zero hits for|If you want I can|index returned no usable/i);
  assert.ok(out.trim().length > 0);
});

test("rewrites intern-speak in a mixed sentence instead of deleting the line", () => {
  const mixed =
    "COOP-101 is still open; 16 issue(s) in the attached search sample mention peel-auth.";
  const out = rewriteCustomerFacingProse(mixed);
  assert.match(out, /COOP-101 is still open/);
  assert.match(out, /peel-auth/);
  assert.doesNotMatch(out, /search sample/i);
});

test("does not invent a patch-failure footer when the hunt already answered", () => {
  const out = customerFacingAgentAnswer({
    content: "Read CustomerDAO — SQL is already parameterized.",
    hasApplyPatch: false
  });
  assert.equal(out.includes("apply-able"), false);
  assert.equal(out.includes("/edit"), false);
  assert.equal(out.includes("index"), false);
});

test("rewrites timed-out vendor search into teammate English", () => {
  const out = rewriteCustomerFacingProse("Timed out searching Notion for coop backend.");
  assert.match(out, /No mention in Notion of coop backend/i);
  assert.doesNotMatch(out, /timed out/i);
});

test("leaves Apply-patch answers unchanged", () => {
  const withPatch = "Here is the change.\n\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE";
  assert.equal(
    customerFacingAgentAnswer({ content: withPatch, hasApplyPatch: true }),
    withPatch
  );
});

test("intern-speak only inside a citation fence leaves the bubble byte-identical", () => {
  const locked = [
    "The cap lives in `src/config/responseDeadline.ts`.",
    "",
    "```1:4:src/config/responseDeadline.ts",
    " * Soft gather is silent to the user.",
    " * If you want I can reindex later.",
    "```"
  ].join("\n");
  assert.equal(rewriteCustomerFacingProse(locked), locked);
});

test("keeps locate prose and citation-fence comments about the soft gather budget", () => {
  const firstFence = [
    "```1:15:src/config/responseDeadline.ts",
    "/**",
    " * Soft gather is silent to the user: synthesize with partial evidence, do not",
    " * post degradation banners or engineer jargon about “budget exhausted.”",
    " */",
    "export const MAX_USER_FACING_RESPONSE_MS = 15_000;",
    "```"
  ].join("\n");
  const secondFence = [
    "```56:63:src/config/responseDeadline.ts",
    "export function remainingContextGatherBudgetMs(",
    "  startedAt: number,",
    "  now = Date.now(),",
    "  maxMs = MAX_USER_FACING_RESPONSE_MS,",
    "  reserveSynthesisMs = RESERVED_SYNTHESIS_MS",
    "): number {",
    "```"
  ].join("\n");
  const locate = [
    "The soft gather budget is defined in `src/config/responseDeadline.ts`.",
    "Callers use `remainingContextGatherBudgetMs` for context fetching.",
    "",
    firstFence,
    "",
    "That helper subtracts the synthesis reserve from the remaining 15s window.",
    "",
    secondFence
  ].join("\n");
  const out = rewriteCustomerFacingProse(locate);
  assert.equal(out, locate);
  assert.match(out, /The soft gather budget is defined/);
  assert.match(out, /Callers use `remainingContextGatherBudgetMs`/);
  assert.match(out, /Soft gather is silent to the user/);
  assert.ok(out.includes(firstFence), "first citation fence must stay byte-identical");
  assert.ok(out.includes(secondFence), "second citation fence must stay byte-identical");
});

test("citation fences stay byte-identical even when surrounding intern-speak is rewritten", () => {
  const fence = [
    "```8:12:src/config/responseDeadline.ts",
    " * Soft gather is silent to the user: synthesize with partial evidence, do not",
    "",
    "",
    " * post degradation banners or engineer jargon about “budget exhausted.”",
    "```"
  ].join("\n");
  const mixed = [
    "From the evidence bundle, the cap lives here.",
    "",
    fence,
    "",
    "If you want I can run the indexed search."
  ].join("\n");
  const out = rewriteCustomerFacingProse(mixed);
  assert.ok(out.includes(fence), "cite body must not be rewritten");
  assert.match(out, /the cap lives here/);
  assert.doesNotMatch(out, /evidence bundle|If you want I can/i);
});

test("drops latency-banner intern copy without blanking a real answer", () => {
  const out = rewriteCustomerFacingProse(
    "Soft gather budget exhausted — synthesizing with partial blast evidence.\nrequireAuth lives in src/server/authMiddleware.ts."
  );
  assert.match(out, /requireAuth lives in src\/server\/authMiddleware\.ts/);
  assert.doesNotMatch(out, /soft gather budget exhausted|partial blast evidence|synthesizing with partial/i);
});

test("highlight change keeps a synthesis patch and does not use the empty-hunt miss", () => {
  const patch = [
    "Adding the comment on the highlighted line.",
    "",
    "File: .dockerignore",
    "```patch",
    "<<<<<<< SEARCH",
    "node_modules",
    "=======",
    "# note",
    "node_modules",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const kept = applyChangeHuntFinish({
    agentAction: "none",
    hasAgentPatch: false,
    content: patch,
    preserveAnswer: false
  });
  assert.equal(kept, patch);
  assert.equal(kept.includes(CUSTOMER_EMPTY_HUNT_ANSWER), false);
});

test("empty agent change hunt still uses the canned miss", () => {
  assert.equal(
    applyChangeHuntFinish({
      agentAction: "change",
      hasAgentPatch: false,
      content: "",
      preserveAnswer: false
    }),
    CUSTOMER_EMPTY_HUNT_ANSWER
  );
});

console.log(`\ncustomerFacingAnswer: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

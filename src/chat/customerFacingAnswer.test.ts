import assert from "node:assert/strict";
import { customerFacingAgentAnswer, rewriteCustomerFacingProse } from "./customerFacingAnswer";

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

test("leaves Apply-patch answers unchanged", () => {
  const withPatch = "Here is the change.\n\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE";
  assert.equal(
    customerFacingAgentAnswer({ content: withPatch, hasApplyPatch: true }),
    withPatch
  );
});

console.log(`\ncustomerFacingAnswer: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

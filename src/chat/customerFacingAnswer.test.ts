import assert from "node:assert/strict";
import { customerFacingAgentAnswer } from "./customerFacingAnswer";

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

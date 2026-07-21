import assert from "node:assert/strict";
import { enrichFindOwnerResponse } from "./ownershipResponseEnrichment";

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

const CORE = `**Summary**
Contact @jonraney first — primary committer on this path (strong evidence).

**True experts**
- @jonraney (primary) — 12 commits in 6mo

**Sources**
- [Sources: GitHub commits & reviews] — path history
`;

test("enrichFindOwnerResponse strips Recommended next step and low-signal optionals", () => {
  const padded = `${CORE}

**Availability**
Unknown.

**Risks**
None identified.

**Knowledge transfer**
No clear pairing target from evidence.

**Recommended next step**
Message @jonraney on Slack and ask for a walkthrough.
`;

  const enriched = enrichFindOwnerResponse(padded);
  assert.ok(enriched.includes("**Summary**"));
  assert.ok(enriched.includes("@jonraney"));
  assert.ok(enriched.includes("**Sources**"));
  assert.equal(enriched.includes("**Availability**"), false);
  assert.equal(enriched.includes("**Risks**"), false);
  assert.equal(enriched.includes("**Knowledge transfer**"), false);
  assert.equal(enriched.includes("**Recommended next step**"), false);
  assert.equal(enriched.includes("walkthrough"), false);
});

test("enrichFindOwnerResponse keeps high-signal availability and SPOF risk", () => {
  const content = `**Summary**
Ask @alice.

**True experts**
- @alice (primary) — sole recent committer

**Availability**
@alice is Active on Slack (US/Pacific).

**Risks**
Single point of failure — only @alice has recent commits; no backup.

**Escalation path**
If @alice is unavailable, ask #platform-auth.

**Sources**
- [Sources: GitHub commits & reviews]
`;

  const enriched = enrichFindOwnerResponse(content);
  assert.ok(enriched.includes("**Availability**"));
  assert.ok(enriched.includes("Active on Slack"));
  assert.ok(enriched.includes("**Risks**"));
  assert.ok(enriched.includes("Single point of failure"));
  assert.ok(enriched.includes("**Escalation path**"));
});

test("enrichFindOwnerResponse keeps named knowledge-transfer pairing", () => {
  const content = `**Summary**
Ask @alice.

**True experts**
- @alice (primary)
- @bob (secondary)

**Knowledge transfer**
Pair @bob with @alice on the next auth change.

**Sources**
- [Sources: GitHub commits & reviews]
`;

  const enriched = enrichFindOwnerResponse(content);
  assert.ok(enriched.includes("**Knowledge transfer**"));
  assert.ok(enriched.includes("@bob"));
});

console.log(`\nownershipResponseEnrichment: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

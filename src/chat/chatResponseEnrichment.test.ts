import assert from "node:assert/strict";
import { enrichChatResponseForAction } from "./chatResponseEnrichment";
import { extractExistingCapabilityEvidence } from "../context/existingCapabilityGrounding";

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

test("incident reconstruction enriches code-only skim with tickets + gaps", () => {
  const content = `**Answer**
Retry helpers exist in webhook_task.py.

**Symptoms**
- Board sync webhook failures.
`;
  const enriched = enrichChatResponseForAction({
    content,
    contextBundle: [
      {
        data: {
          jiraSearch: { issues: [] },
          slackSearch: { messages: [] }
        }
      }
    ],
    incidentReconstruction: { jiraConnected: true, slackConnected: true }
  });
  assert.ok(enriched.includes("**Code paths**"));
  assert.ok(enriched.includes("**Tickets / threads**"));
  assert.ok(enriched.includes("**Gaps**"));
  assert.ok(/Searched Jira/i.test(enriched));
  assert.ok(/Searched Slack/i.test(enriched));
});

test("incident reconstruction with disconnected tools still has gaps", () => {
  const enriched = enrichChatResponseForAction({
    content: "**Answer**\nRetries in code.",
    incidentReconstruction: { jiraConnected: false, slackConnected: false }
  });
  assert.ok(enriched.includes("**Tickets / threads**"));
  assert.ok(enriched.includes("**Gaps**"));
  assert.ok(/not connected/i.test(enriched));
});

test("existing-capability enricher corrects greenfield blocked_by advice", () => {
  const mapper = `
RELATION_TYPE_MAP = {
    "blocking": "blocked_by",
    "blocked_by": "blocking",
}
`.trim();
  const evidence = extractExistingCapabilityEvidence({
    filePath: "apps/api/plane/utils/issue_relation_mapper.py",
    fileContent: mapper,
    ask: "We're adding a blocked by link type for issues"
  });
  assert.ok(evidence);
  assert.equal(evidence!.verdict, "already-exists");
  const enriched = enrichChatResponseForAction({
    content: "**Answer**\nAdd a new blocked_by link type to the mapper.",
    existingCapability: evidence
  });
  assert.ok(/already exists/i.test(enriched));
  assert.ok(/\bextend\b/i.test(enriched));
});

const total = passed + failed;
console.log(`\nchatResponseEnrichment: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

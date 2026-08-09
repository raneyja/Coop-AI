import assert from "node:assert/strict";
import {
  knowledgeGapsFocusGatherTerms,
  knowledgeGapsFocusTopics,
  knowledgeGapsFocusTopicGapStubs,
  knowledgeGapsGatherQuery,
  openFileRelatedToGapsFocus,
  resolveKnowledgeGapsAuditScope
} from "./knowledgeGapsFocus";
import { buildKnowledgeGapsSynthesisUserPrompt } from "../prompts/knowledgeGapsSynthesis";

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

test("knowledgeGapsGatherQuery keeps focus as primary gather query", () => {
  const focus = "focus on webhook delivery and signature certificates";
  assert.equal(knowledgeGapsGatherQuery(focus), focus);
  assert.equal(knowledgeGapsGatherQuery("short"), undefined);
  assert.equal(knowledgeGapsGatherQuery(undefined), undefined);
});

test("knowledgeGapsFocusTopics splits webhook + certificate subsystems", () => {
  const topics = knowledgeGapsFocusTopics(
    "focus on webhook delivery and signature certificates"
  );
  assert.ok(topics.some((t) => /webhook/i.test(t)), `topics=${JSON.stringify(topics)}`);
  assert.ok(topics.some((t) => /certificate/i.test(t)), `topics=${JSON.stringify(topics)}`);
});

test("knowledgeGapsFocusTopics covers notifications and webhooks", () => {
  const topics = knowledgeGapsFocusTopics("focus on notifications and webhooks");
  assert.ok(topics.some((t) => /notification/i.test(t)));
  assert.ok(topics.some((t) => /webhook/i.test(t)));
});

test("openFileRelatedToGapsFocus rejects unrelated helper file", () => {
  assert.equal(
    openFileRelatedToGapsFocus(
      "apps/docs/src/lib/is-document-status.ts",
      "focus on webhook delivery and signature certificates"
    ),
    false
  );
  assert.equal(
    openFileRelatedToGapsFocus(
      "apps/api/src/webhooks/delivery.ts",
      "focus on webhook delivery and signature certificates"
    ),
    true
  );
});

test("resolveKnowledgeGapsAuditScope demotes unrelated open file when focus present", () => {
  const scope = resolveKnowledgeGapsAuditScope({
    file: "apps/docs/src/lib/is-document-status.ts",
    userFocus: "focus on webhook delivery and signature certificates"
  });
  assert.equal(scope.focusPrimary, true);
  assert.equal(scope.gatherQuery, "focus on webhook delivery and signature certificates");
  assert.equal(scope.secondaryUnrelatedFile, "apps/docs/src/lib/is-document-status.ts");
  assert.equal(scope.relatedOpenFile, undefined);
  assert.ok(scope.focusTopics.some((t) => /webhook/i.test(t)));
  assert.ok(scope.focusTopics.some((t) => /certificate/i.test(t)));
});

test("knowledgeGapsFocusGatherTerms puts webhook/cert tokens first", () => {
  const terms = knowledgeGapsFocusGatherTerms(
    "focus on webhook delivery and signature certificates"
  );
  assert.ok(terms.length > 0);
  assert.ok(
    terms.some((t) => /webhook/i.test(t)),
    `expected webhook term in ${JSON.stringify(terms)}`
  );
  assert.ok(
    terms.some((t) => /certificate/i.test(t)),
    `expected certificate term in ${JSON.stringify(terms)}`
  );
});

test("knowledgeGapsFocusTopicGapStubs emit no-evidence stubs per topic without hits", () => {
  const stubs = knowledgeGapsFocusTopicGapStubs({
    userFocus: "focus on webhook delivery and signature certificates",
    focusHitPaths: []
  });
  assert.ok(stubs.length >= 2);
  assert.ok(stubs.every((gap) => gap.type === "missing_docs"));
  assert.ok(stubs.some((gap) => String(gap.message).includes("webhook")));
  assert.ok(stubs.some((gap) => String(gap.message).includes("certificate")));
});

test("synthesis builder includes focus as primary topic — not unrelated open-file ownership headline", () => {
  const focus = "focus on webhook delivery and signature certificates";
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {
      file: "apps/docs/src/lib/is-document-status.ts",
      jobScan: {
        gaps: [
          {
            type: "missing_owner",
            message: "No ownership scores attached for this path",
            file: "apps/docs/src/lib/is-document-status.ts"
          }
        ]
      },
      userFocus: focus,
      focusSearchQuery: focus
    },
    file: "apps/docs/src/lib/is-document-status.ts",
    owner: "documenso",
    repo: "documenso",
    userFocus: focus
  });
  assert.ok(prompt.includes(focus), "gather/prompt must include focus text F");
  assert.ok(prompt.includes("## Primary topic"), "focus must be Primary topic section");
  assert.match(prompt, /Primary topic[\s\S]*webhook delivery/i);
  assert.match(prompt, /Primary topic[\s\S]*signature certificates/i);
  assert.ok(
    prompt.includes("secondary — unrelated to focus") ||
      prompt.includes("Open editor (secondary"),
    "unrelated open file must be secondary"
  );
  assert.ok(
    !prompt.includes("## Primary target\n- File: apps/docs/src/lib/is-document-status.ts"),
    "unrelated open file must not be Primary target"
  );
  assert.match(
    prompt,
    /Do not make ownership of the unrelated open editor/i
  );
  assert.ok(
    prompt.includes("webhook") && prompt.includes("certificate"),
    "smoke shape: webhooks AND certificates must be emphasized"
  );
});

test("synthesis with notifications/webhooks focus keeps focus primary for plane-style ask", () => {
  const focus = "focus on notifications and webhooks";
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { userFocus: focus, focusSearchQuery: focus },
    file: "apps/api/src/helpers/url.ts",
    owner: "CoopAI-Corp",
    repo: "plane",
    userFocus: focus
  });
  assert.ok(prompt.includes(focus));
  assert.ok(prompt.includes("## Primary topic"));
  assert.match(prompt, /notifications/i);
  assert.match(prompt, /webhooks/i);
  assert.ok(prompt.includes("secondary — unrelated to focus") || prompt.includes("Open editor (secondary"));
});

const total = passed + failed;
console.log(`\nknowledgeGapsFocus: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

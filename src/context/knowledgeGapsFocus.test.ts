import assert from "node:assert/strict";
import { buildConfluenceCql, buildConfluenceRepoOnlyCql } from "./docSearchQuery";
import {
  filterDocPagesForUseRepo,
  sanitizeIntegrationSnippet,
  scoreDocPageForUseRepo
} from "./integrationDocRelevance";
import {
  knowledgeGapsFocusGatherTerms,
  knowledgeGapsFocusTopics,
  knowledgeGapsFocusTopicGapStubs,
  knowledgeGapsGatherQuery,
  knowledgeGapsIndexQueries,
  mergeKnowledgeGapsFocusStubsIntoScan,
  openFileRelatedToGapsFocus,
  resolveKnowledgeGapsAuditScope,
  stripKnowledgeGapsTopicFraming
} from "./knowledgeGapsFocus";
import { indexQueryForRetrieval } from "../api/agent/searchQuery";
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

const SIGNING_FOCUS =
  "Where are the biggest documentation or knowledge gaps around signing / document status?";

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

test("signing/document-status NL ask extracts subsystem topics — not documentation meta", () => {
  const stripped = stripKnowledgeGapsTopicFraming(SIGNING_FOCUS);
  assert.match(stripped, /signing/i);
  assert.match(stripped, /document status/i);
  assert.ok(!/^where are/i.test(stripped));

  const topics = knowledgeGapsFocusTopics(SIGNING_FOCUS);
  assert.ok(topics.some((t) => /^signing$/i.test(t.trim())), `topics=${JSON.stringify(topics)}`);
  assert.ok(
    topics.some((t) => /document status/i.test(t)),
    `topics=${JSON.stringify(topics)}`
  );
  assert.ok(
    !topics.some((t) => /documentation or knowledge/i.test(t)),
    "must not keep the documentation meta phrase as a topic"
  );
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

test("focus gather terms for signing ask prefer signing/status — not documentation meta flood", () => {
  const terms = knowledgeGapsFocusGatherTerms(SIGNING_FOCUS);
  assert.ok(terms.some((t) => /signing/i.test(t)), `terms=${JSON.stringify(terms)}`);
  assert.ok(
    terms.some((t) => /document status|status/i.test(t)),
    `terms=${JSON.stringify(terms)}`
  );
  assert.ok(
    !terms.some((t) => /^documentation$/i.test(t)),
    "documentation meta must not be a Confluence search term"
  );
  assert.ok(
    !terms.some((t) => /where are the biggest/i.test(t)),
    "full NL question must not be pushed as a search term"
  );
});

test("knowledgeGapsFocusTopicGapStubs emit honest miss stubs per topic without hits", () => {
  const stubs = knowledgeGapsFocusTopicGapStubs({
    userFocus: "focus on webhook delivery and signature certificates",
    focusHitPaths: []
  });
  assert.ok(stubs.length >= 2);
  assert.ok(stubs.every((gap) => gap.type === "focus_search_miss"));
  assert.ok(stubs.every((gap) => !String(gap.message).includes("No indexed code")));
  assert.ok(stubs.some((gap) => String(gap.message).includes("webhook")));
  assert.ok(stubs.some((gap) => String(gap.message).includes("certificate")));
});

test("signing focus stubs survive weak document-path hits (focus influences Gaps gather)", () => {
  // Index may return document-status helpers; that must not wipe the signing topic stub,
  // and must not treat the whole NL ask as "covered" via the word documentation/document.
  const stubs = knowledgeGapsFocusTopicGapStubs({
    userFocus: SIGNING_FOCUS,
    focusHitPaths: [
      "apps/docs/src/lib/is-document-status.ts",
      "packages/lib/types/document-status.ts",
      "README.md"
    ]
  });
  assert.ok(
    stubs.some((gap) => String(gap.topic ?? gap.message).toLowerCase().includes("signing")),
    `expected signing stub, got ${JSON.stringify(stubs)}`
  );
});

test("mergeKnowledgeGapsFocusStubsIntoScan fills empty job scan with focus stubs", () => {
  const stubs = knowledgeGapsFocusTopicGapStubs({
    userFocus: SIGNING_FOCUS,
    focusHitPaths: []
  });
  assert.ok(stubs.length >= 1);
  const merged = mergeKnowledgeGapsFocusStubsIntoScan(
    {
      source: "knowledge-gap-job",
      cached: false,
      foundGaps: 0,
      highPriority: 0,
      mediumPriority: 0,
      lowPriority: 0,
      gaps: []
    },
    stubs
  );
  assert.ok(merged);
  assert.ok(Number(merged!.foundGaps) >= 1);
  assert.ok(Array.isArray(merged!.gaps) && (merged!.gaps as unknown[]).length >= 1);
  assert.ok(
    (merged!.gaps as Array<Record<string, unknown>>).some((gap) =>
      String(gap.message).toLowerCase().includes("signing")
    )
  );
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

test("buildConfluenceCql ANDs Use-repo with focus extras (no documentation OR bleed)", () => {
  const cql = buildConfluenceCql("documenso", "documenso", [
    "signing",
    "document status",
    "documentation"
  ]);
  assert.ok(cql);
  assert.match(cql!, /text ~ "documenso"/i);
  assert.match(cql!, /text ~ "signing"/i);
  assert.ok(cql!.includes(") AND ("), `expected AND between repo and focus: ${cql}`);
  assert.ok(!cql!.includes('text ~ "documenso" OR text ~ "signing"'));
});

test("buildConfluenceRepoOnlyCql is repo-scoped without focus extras", () => {
  const cql = buildConfluenceRepoOnlyCql("documenso", "documenso");
  assert.ok(cql);
  assert.match(cql!, /documenso/i);
  assert.ok(!cql!.includes("signing"));
});

test("filterDocPagesForUseRepo drops Coop-AI ADRs when Use-repo is documenso", () => {
  const pages = filterDocPagesForUseRepo(
    [
      {
        title: "ADR: Webview vs native sidebar (COOP-55)",
        excerpt: "Coop AI architecture decision record template \uFFFD\uFE0F"
      },
      {
        title: "Coop AI Demo Home",
        excerpt: "Onboarding templates for Coop-AI"
      },
      {
        title: "Documenso signing status overview",
        excerpt: "How document status transitions work in documenso"
      }
    ],
    { owner: "documenso", repo: "documenso", focusTerms: ["signing", "document status"] }
  );
  assert.equal(pages.length, 1);
  assert.match(pages[0]!.title, /documenso signing/i);
  assert.ok(!pages.some((page) => /coop/i.test(page.title)));
});

test("sanitizeIntegrationSnippet strips mojibake and Confluence highlight markers", () => {
  const cleaned = sanitizeIntegrationSnippet(
    "Status \uFFFD\uFE0F ready @@@hl@@@signing@@@endhl@@@ flow"
  );
  assert.ok(cleaned);
  assert.ok(!cleaned!.includes("\uFFFD"));
  assert.ok(!cleaned!.includes("@@@hl@@@"));
  assert.match(cleaned!, /Status/);
  assert.match(cleaned!, /signing/);
});

test("scoreDocPageForUseRepo penalizes foreign Coop pages for documenso", () => {
  const coop = scoreDocPageForUseRepo(
    { title: "Coop AI — Architecture Overview", excerpt: "ADR template" },
    { owner: "documenso", repo: "documenso" }
  );
  const doc = scoreDocPageForUseRepo(
    { title: "Signing pipeline", excerpt: "documenso envelope status" },
    { owner: "documenso", repo: "documenso", focusTerms: ["signing"] }
  );
  assert.ok(coop < 0);
  assert.ok(doc >= 50);
  assert.ok(doc > coop);
});

const E6_ASK =
  "Focus on the agent hunt loop and mid-loop Slack/Jira tools — what's undocumented or still unsafe for a 500-person org to turn on by default?";

test("E6 ask keeps Slack/Jira as one topic and drops the safety question", () => {
  const topics = knowledgeGapsFocusTopics(E6_ASK);
  assert.ok(topics.length <= 2, `topics=${JSON.stringify(topics)}`);
  assert.ok(topics.some((t) => /hunt loop/i.test(t)), `topics=${JSON.stringify(topics)}`);
  assert.ok(
    topics.some((t) => /slack\/jira/i.test(t) || (/slack/i.test(t) && /jira/i.test(t))),
    `topics=${JSON.stringify(topics)}`
  );
  assert.ok(!topics.some((t) => /undocumented|500-person/i.test(t)));
  assert.ok(!topics.some((t) => /^jira tools/i.test(t)));
});

test("E6 index queries are not hunt-shortened to Focus", () => {
  const hunt = indexQueryForRetrieval(E6_ASK);
  assert.ok(hunt.length > 0 && hunt.length < E6_ASK.length, `hunt=${hunt}`);
  const queries = knowledgeGapsIndexQueries(E6_ASK);
  assert.ok(queries.length >= 2, `queries=${JSON.stringify(queries)}`);
  assert.ok(queries.every((q) => q.toLowerCase() !== "focus"));
  assert.ok(queries.some((q) => /hunt|orchestrator|agent/i.test(q)));
  assert.ok(queries.some((q) => /slack|jira/i.test(q)));
});

test("E6 stubs stay silent on no-indexed-code when AgentOrchestrator and slack paths exist", () => {
  const stubs = knowledgeGapsFocusTopicGapStubs({
    userFocus: E6_ASK,
    focusHitPaths: [
      "src/api/agent/AgentOrchestrator.ts",
      "src/server/slackAppApi.ts",
      "src/api/agent/tools/integrationTools.ts"
    ],
    focusFiles: [
      {
        path: "src/api/agent/AgentOrchestrator.ts",
        content: "export function createAgentOrchestrator() { search_slack; search_jira; }"
      }
    ]
  });
  assert.ok(!stubs.some((gap) => String(gap.message).includes("No indexed code")));
  assert.ok(!stubs.some((gap) => gap.type === "focus_search_miss"));
});

const T14_ASK = "What's still unsafe about default-on hunt for on-call API-error locates?";

test("hunt/locate risk index queries attach hunt files not Focus", () => {
  const queries = knowledgeGapsIndexQueries(T14_ASK);
  assert.ok(queries.every((q) => q.toLowerCase() !== "focus"));
  assert.ok(
    queries.some((q) => /searchQuery|AgentOrchestrator|hunt|locate/i.test(q)),
    `queries=${JSON.stringify(queries)}`
  );
});

test("hunt/locate risk stubs name evidence-class gaps not runbook-only", () => {
  const stubs = knowledgeGapsFocusTopicGapStubs({
    userFocus: T14_ASK,
    focusHitPaths: ["src/api/agent/searchQuery.ts", "src/api/agent/AgentOrchestrator.ts"]
  });
  assert.ok(stubs.some((gap) => gap.type === "wrong_file_evidence"));
  assert.ok(stubs.some((gap) => gap.type === "canned_miss"));
  assert.ok(stubs.some((gap) => gap.type === "ui_for_api"));
  assert.ok(!stubs.some((gap) => String(gap.message).includes("Docs/runbook may be thin")));
});

test("unrelated chip is secondary for hunt/locate Gaps focus", () => {
  const scope = resolveKnowledgeGapsAuditScope({
    file: "src/config/responseDeadline.ts",
    userFocus: T14_ASK
  });
  assert.equal(scope.focusPrimary, true);
  assert.equal(scope.relatedOpenFile, undefined);
  assert.equal(scope.secondaryUnrelatedFile, "src/config/responseDeadline.ts");
});

const total = passed + failed;
console.log(`\nknowledgeGapsFocus: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

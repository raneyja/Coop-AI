import assert from "node:assert/strict";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  asksAboutAlternativesOrTradeoffs,
  buildThinAlternativesTradeOffsResponse,
  enrichTraceDecisionResponse,
  responseHasSpeculativeTradeoffs,
  stripTitleOnlyDocReviewClaims,
  stripUnknownFillerSections,
  timelineHasDiscussionEvidence
} from "./decisionResponseEnrichment";

const thinTimeline: DecisionTimeline = {
  file: "fastify.js",
  completeness: "minimal",
  originalCommit: {
    sha: "dd2bb739fe3b",
    author: "mcollina",
    date: "2016-10-04",
    message: "Some random code."
  },
  alternatives: [],
  chronology: [],
  warnings: ["No linked pull request found for the introducing commit."],
  fallbackMessage: undefined,
  linkedPR: undefined,
  slackThread: undefined,
  teamsThread: undefined,
  jiraTickets: undefined
};

const bundle = [
  {
    type: "decision_history",
    data: { timeline: thinTimeline }
  }
];

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

test("asksAboutAlternativesOrTradeoffs matches trade-off follow-ups", () => {
  assert.equal(asksAboutAlternativesOrTradeoffs("What trade-offs were rejected?"), true);
  assert.equal(asksAboutAlternativesOrTradeoffs("Who owns this file?"), false);
});

test("responseHasSpeculativeTradeoffs detects generic inference filler", () => {
  const bad = "However, based on common practices in software engineering, we can infer Performance vs. Development Speed.";
  assert.equal(responseHasSpeculativeTradeoffs(bad), true);
});

test("buildThinAlternativesTradeOffsResponse stays compact and omits Unknown by default", () => {
  const text = buildThinAlternativesTradeOffsResponse(thinTimeline, "fastify.js");
  assert.ok(text.includes("**Summary**"));
  assert.ok(text.includes("**Technical decision**"));
  assert.ok(text.includes("Some random code."));
  assert.ok(text.includes("**Who to engage**"));
  assert.ok(text.includes("mcollina"));
  assert.ok(!text.includes("Unknown — not recorded"));
  assert.ok(!text.includes("**Alternatives considered**"));
  assert.ok(text.includes("[Sources: GitHub commit dd2bb73]"));
  assert.ok(!text.includes("Performance vs"));
  assert.ok(text.split("\n").length < 18);

  const asked = buildThinAlternativesTradeOffsResponse(thinTimeline, "fastify.js", {
    includeUnknownSections: true
  });
  assert.ok(asked.includes("**Alternatives considered**"));
  assert.ok(asked.includes("Not documented"));
  assert.ok(asked.split("\n").length < 24);
});

test("enrichTraceDecisionResponse does not replace initial trace run when model prompt mentions trade-offs", () => {
  const goodTrace = [
    "**Summary**",
    "fastify.js was introduced in commit dd2bb73.",
    "",
    "**Business context**",
    "Core server bootstrap.",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73] — introducing commit"
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: goodTrace,
    userQuestion: "[trace-decision] Trace the engineering decision behind this code.",
    contextBundle: bundle,
    activeFile: "fastify.js",
    fallbackTimeline: thinTimeline,
    isFollowUp: false
  });

  assert.equal(enriched, goodTrace);
});

test("enrichTraceDecisionResponse strips speculative trade-offs on thin evidence without Unknown fillers", () => {
  const speculative = [
    "**Summary**",
    "Introduced in dd2bb73.",
    "",
    "**Trade-offs**",
    "However, based on common practices, we can infer Performance vs. Development Speed."
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: speculative,
    userQuestion: "[trace-decision] Trace the engineering decision behind this code.",
    contextBundle: bundle,
    activeFile: "fastify.js",
    fallbackTimeline: thinTimeline,
    isFollowUp: false
  });

  assert.ok(enriched.includes("**Summary**"));
  assert.ok(enriched.includes("Introduced in dd2bb73"));
  assert.ok(!enriched.includes("**Trade-offs**"));
  assert.ok(!enriched.includes("**Alternatives considered**"));
  assert.ok(!enriched.includes("we can infer"));
});

test("enrichTraceDecisionResponse replaces speculative thin-evidence answer", () => {
  const speculative = [
    "Trade-offs",
    "",
    "The evidence does not explicitly document any alternatives.",
    "However, based on common practices, we can infer Performance vs. Development Speed."
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: speculative,
    userQuestion: "What trade-offs were rejected?",
    contextBundle: bundle,
    activeFile: "fastify.js",
    isFollowUp: true
  });

  assert.ok(enriched.includes("**Alternatives considered**"));
  assert.ok(!enriched.includes("we can infer"));
  assert.ok(enriched.includes("[Sources: GitHub commit dd2bb73]"));
});

test("enrichTraceDecisionResponse uses fallback timeline when bundle lost decision_history", () => {
  const speculative = "However, based on common practices, we can infer Robustness vs. Simplicity.";
  const enriched = enrichTraceDecisionResponse({
    content: speculative,
    userQuestion: "What trade-offs were rejected?",
    contextBundle: [],
    activeFile: "fastify.js",
    fallbackTimeline: thinTimeline,
    isFollowUp: true
  });
  assert.ok(enriched.includes("**Trade-offs**"));
  assert.ok(!enriched.includes("Robustness vs"));
});

test("timelineHasDiscussionEvidence requires PR Slack Jira or extracted alternatives", () => {
  const withDocs: DecisionTimeline = {
    ...thinTimeline,
    integrationSearch: {
      confluence: {
        pages: [{ id: "1", title: "ADR", htmlUrl: "https://confluence/1" }]
      }
    }
  };
  assert.equal(timelineHasDiscussionEvidence(withDocs), false);
});

test("enrichTraceDecisionResponse replaces speculative trace when Slack/Jira attached but sections lack quotes", () => {
  const richTimeline: DecisionTimeline = {
    ...thinTimeline,
    completeness: "partial",
    slackThread: {
      channelId: "C1",
      channelName: "epd",
      threadTs: "1",
      participants: ["alice"],
      messages: [
        {
          user: "alice",
          text: "We rejected rolling our own JWT middleware — chose GitHub App tokens instead for trade-off on ops burden.",
          ts: "1"
        }
      ]
    },
    jiraTickets: [
      {
        key: "COOP-101",
        summary: "GitHub App API rollout",
        description: "Decision: use installation tokens instead of PATs.",
        acceptanceCriteria: [],
        technicalDebt: false,
        htmlUrl: "https://jira/COOP-101"
      }
    ]
  };
  const bundleWithDiscussion = [{ type: "decision_history", data: { timeline: richTimeline } }];
  const speculative = [
    "**Summary**",
    "GitHub App API uses installation tokens.",
    "",
    "**Alternatives considered**",
    "Custom JWT middleware was likely rejected for simplicity vs robustness.",
    "",
    "**Trade-offs**",
    "However, based on common practices, we can infer Performance vs. Development Speed."
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: speculative,
    userQuestion: "[trace-decision] Trace the engineering decision behind this code.",
    contextBundle: bundleWithDiscussion,
    activeFile: "src/server/githubAppApi.ts",
    fallbackTimeline: richTimeline,
    isFollowUp: false
  });

  assert.ok(enriched.includes("@alice"));
  assert.ok(enriched.includes("COOP-101"));
  assert.ok(!enriched.includes("we can infer"));
  assert.ok(!enriched.includes("likely rejected"));
});

test("enrichTraceDecisionResponse strips narrative source pills on thin evidence", () => {
  const withPills = [
    "**Summary**",
    "Introduced in dd2bb73 [Sources: GitHub commit dd2bb73].",
    "",
    "**Architecture**",
    "Pattern from [Sources: Ownership signals].",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73] — introducing commit"
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: withPills,
    userQuestion: "[trace-decision] Trace the engineering decision behind this code.",
    contextBundle: bundle,
    activeFile: "fastify.js",
    fallbackTimeline: thinTimeline,
    isFollowUp: false
  });

  assert.ok(!enriched.includes("[Sources: Ownership signals]"));
  assert.ok(enriched.includes("[Sources: GitHub commit dd2bb73] — introducing commit"));
});

test("stripUnknownFillerSections removes Unknown Decision status padding", () => {
  const padded = [
    "**Summary**",
    "Introduced in dd2bb73.",
    "",
    "**Technical decision**",
    "Some random code.",
    "",
    "**Decision status**",
    "Unknown — not recorded in attached sources.",
    "",
    "**Business context**",
    "Not documented.",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73]"
  ].join("\n");
  const stripped = stripUnknownFillerSections(padded);
  assert.ok(stripped.includes("**Summary**"));
  assert.ok(stripped.includes("**Technical decision**"));
  assert.ok(!stripped.includes("**Decision status**"));
  assert.ok(!stripped.includes("**Business context**"));
  assert.ok(stripped.includes("**Sources**"));
});

test("stripTitleOnlyDocReviewClaims removes Notion reviewed empty-body UX", () => {
  const bad = [
    "**Summary**",
    "Retry helper from commit.",
    "",
    "**Notion pages reviewed**",
    "- ADR COOP-55 — content was not retrievable",
    "- 6 pages reviewed",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73]"
  ].join("\n");
  const stripped = stripTitleOnlyDocReviewClaims(bad);
  assert.ok(!stripped.includes("**Notion pages reviewed**"));
  assert.ok(!stripped.includes("content was not retrievable"));
  assert.ok(!stripped.includes("6 pages reviewed"));
  assert.ok(stripped.includes("**Summary**"));
});

test("enrichTraceDecisionResponse strips title-only Notion reviewed claims", () => {
  const withNotionNoise = [
    "**Summary**",
    "Introduced in dd2bb73.",
    "",
    "**Technical decision**",
    "Some random code.",
    "",
    "**Notion pages reviewed**",
    "- ADR COOP-55 — content was not retrievable",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73] — introducing commit"
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: withNotionNoise,
    userQuestion: "[trace-decision] Trace the engineering decision behind this code.",
    contextBundle: bundle,
    activeFile: "fastify.js",
    fallbackTimeline: thinTimeline,
    isFollowUp: false
  });

  assert.ok(!enriched.includes("**Notion pages reviewed**"));
  assert.ok(!enriched.includes("content was not retrievable"));
  assert.ok(enriched.includes("**Technical decision**"));
});

console.log(`\ndecisionResponseEnrichment: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

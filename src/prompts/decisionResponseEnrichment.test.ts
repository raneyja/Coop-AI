import assert from "node:assert/strict";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  alternativesSectionsLackGrounding,
  buildGroundedAlternativesTradeOffsSections,
  asksAboutAlternativesOrTradeoffs,
  buildThinAlternativesTradeOffsResponse,
  enrichTraceDecisionResponse,
  responseHasSpeculativeTradeoffs,
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

test("buildThinAlternativesTradeOffsResponse stays compact and honest", () => {
  const text = buildThinAlternativesTradeOffsResponse(thinTimeline, "fastify.js");
  assert.ok(text.includes("Evidence is **limited**"));
  assert.equal(text.includes("**Summary**"), false);
  assert.ok(text.includes("Unknown — not recorded"));
  assert.ok(text.includes("Not documented"));
  assert.match(text, /\[Sources: (?:GitHub|Code host) commit dd2bb73\]/);
  assert.ok(!text.includes("Performance vs"));
  assert.ok(text.split("\n").length < 20);
  assert.match(text, /sampled provenance; original introduction.*unverified/);
  assert.doesNotMatch(text, /only the introducing commit|— original introduction;/);
});

test("enrichTraceDecisionResponse does not replace initial trace run when model prompt mentions trade-offs", () => {
  const goodTrace = [
    "**Summary**",
    "Attached history for fastify.js includes sampled commit dd2bb73.",
    "",
    "**Business context**",
    "Core server bootstrap.",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73] — sampled provenance"
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

test("enrichTraceDecisionResponse replaces speculative initial trace run on thin evidence", () => {
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

  assert.ok(enriched.includes("**Alternatives considered**"));
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
  assert.match(enriched, /\[Sources: (?:GitHub|Code host) commit dd2bb73\]/);
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

test("timelineHasDiscussionEvidence requires original attached discussion text", () => {
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
    "Sampled history includes dd2bb73 [Sources: GitHub commit dd2bb73].",
    "",
    "**Architecture**",
    "Pattern from [Sources: Ownership signals].",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73] — sampled provenance"
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
  assert.ok(enriched.includes("[Sources: GitHub commit dd2bb73] — sampled provenance"));
});

test("enrichTraceDecisionResponse injects commit/PR when model did a code walkthrough", () => {
  const walkthrough = [
    "**Summary**",
    "The StateGroup model categorizes work item states to streamline project management.",
    "",
    "**Technical decision**",
    "StateGroup is implemented as TextChoices for Django queries."
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: walkthrough,
    userQuestion: "Why do we model states with StateGroup this way?",
    contextBundle: bundle,
    activeFile: "apps/api/plane/db/models/state.py",
    fallbackTimeline: thinTimeline,
    isFollowUp: false
  });

  assert.ok(enriched.includes("dd2bb73"), "must cite sampled commit SHA");
  assert.ok(enriched.includes("Decision history for") || enriched.includes("**Summary**"));
  assert.ok(enriched.includes("**Sources**") || enriched.includes("[Sources: GitHub commit"));
});

test("Z3 Gate B: does not force-cite mega demoted focus as the decision", () => {
  const megaTimeline: DecisionTimeline = {
    ...thinTimeline,
    focusCommit: {
      sha: "5933561abcdef",
      author: "dev",
      date: "2024-06-01",
      message: "feat: session auth implementation (#4411)"
    },
    focusDecisionQuality: "weak",
    focusIsMegaDriveBy: true,
    linkedPR: {
      number: 4411,
      title: "feat: session auth implementation",
      description: "Auth overhaul",
      state: "merged",
      labels: [],
      reviews: [],
      approvers: []
    }
  };

  const walkthrough = [
    "**Summary**",
    "StateGroup categorizes work item states.",
    "",
    "**Technical decision**",
    "Implemented as TextChoices."
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: walkthrough,
    userQuestion: "Why do we model StateGroup this way?",
    contextBundle: [{ type: "decision_history", data: { timeline: megaTimeline } }],
    activeFile: "apps/api/plane/db/models/state.py",
    fallbackTimeline: megaTimeline
  });

  assert.equal(enriched.includes("Decision history for"), false);
  assert.equal(enriched.includes("5933561"), false);
});

test("enrichTraceDecisionResponse leaves answers that already cite the commit", () => {
  const cited = [
    "**Summary**",
    "Attached history for StateGroup includes sampled commit dd2bb73.",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73] — sampled provenance"
  ].join("\n");

  const enriched = enrichTraceDecisionResponse({
    content: cited,
    userQuestion: "Why StateGroup?",
    contextBundle: bundle,
    activeFile: "state.py",
    fallbackTimeline: thinTimeline
  });

  assert.equal(enriched.includes("Decision history for"), false);
  assert.ok(enriched.includes("dd2bb73"));
});

test("metadata and approval presence do not become discussion evidence", () => {
  const timeline: DecisionTimeline = { ...thinTimeline, linkedPR: { number: 7, title: "Approval", description: "", state: "merged", labels: [], reviews: [], approvers: ["alice"] } };
  assert.equal(timelineHasDiscussionEvidence(timeline), false);
});

test("arbitrary quotes and identifiers cannot ground alternatives", () => {
  const timeline: DecisionTimeline = { ...thinTimeline, slackThread: { channelId: "C7", channelName: "engineering", threadTs: "7", participants: ["alice"], messages: [{ user: "alice", text: "We rejected polling because notifications preserve freshness.", ts: "7" }] } };
  for (const unsupported of ['"We rejected queues for latency."', 'PR #7 rejected queues for latency.', '#engineering rejected queues for latency.', 'alice rejected queues for latency.']) {
    const answer = `**Alternatives considered**\n${unsupported}\n\n**Trade-offs**\nUnknown.`;
    assert.equal(alternativesSectionsLackGrounding(answer, timeline), true, unsupported);
    const enriched = enrichTraceDecisionResponse({ content: answer, contextBundle: [{ type: "decision_history", data: { timeline } }], userQuestion: "What alternatives were considered?" });
    assert.ok(!enriched.includes("queues for latency"));
    assert.ok(enriched.includes("notifications preserve freshness"));
    assert.equal((enriched.match(/\*\*Alternatives considered\*\*/g) ?? []).length, 1);
  }
  assert.equal(alternativesSectionsLackGrounding('**Alternatives considered**\n"We rejected polling because notifications preserve freshness."\n\n**Trade-offs**\nUnknown.', timeline), false);
  assert.equal(alternativesSectionsLackGrounding('**Alternatives considered**\n"We rejected polling because notifications preserve freshness."\n- Queues were rejected for latency.\n\n**Trade-offs**\nUnknown.', timeline), true);
});

test("choosing an option does not manufacture trade-offs", () => {
  const timeline: DecisionTimeline = { ...thinTimeline, teamsThread: { teamId: "T", channelId: "C", rootMessageId: "1", participants: ["alice"], messages: [{ user: "alice", text: "We chose notifications instead of polling.", date: "2026-10-11" }] } };
  const sections = buildGroundedAlternativesTradeOffsSections(timeline);
  assert.ok(sections.alternatives.includes("We chose notifications instead of polling."));
  assert.ok(sections.tradeoffs.includes("Not explicitly recorded"));
  assert.ok(!sections.tradeoffs.includes("implied"));
});

test("derived-only alternative summaries cannot ground or enter a prepared answer", () => {
  const derived: DecisionTimeline = {
    ...thinTimeline,
    alternatives: [{ option: "Polling", reason_rejected: "Invented latency reason", proposed_by: "alice", source: "pr:7" }]
  };
  const candidate = '**Alternatives considered**\nPolling — rejected because Invented latency reason (pr:7).\n\n**Trade-offs**\nUnknown.';
  assert.equal(timelineHasDiscussionEvidence(derived), false);
  assert.equal(alternativesSectionsLackGrounding(candidate, derived), true);
  const sections = buildGroundedAlternativesTradeOffsSections(derived);
  assert.ok(sections.alternatives.includes("Not explicitly recorded"));
  assert.ok(!sections.alternatives.includes("Invented latency reason"));
  const enriched = enrichTraceDecisionResponse({ content: candidate, contextBundle: [{ type: "decision_history", data: { timeline: derived } }], userQuestion: "What alternatives were considered?" });
  assert.ok(!enriched.includes("Invented latency reason"));
  const original: DecisionTimeline = { ...derived, linkedPR: { number: 7, title: "Choice", description: "We rejected polling because notifications preserve freshness.", state: "merged", approvers: [], reviews: [] } };
  const grounded = buildGroundedAlternativesTradeOffsSections(original);
  assert.ok(grounded.alternatives.includes("notifications preserve freshness"));
  assert.ok(!grounded.alternatives.includes("Invented latency reason"));
});

test("long excerpts and separate Jira fields remain source members on repeat enrichment", () => {
  const timeline: DecisionTimeline = { ...thinTimeline, linkedPR: { number: 8, title: "Choice", description: "We rejected polling because " + "freshness matters ".repeat(30), state: "merged", labels: [], reviews: [], approvers: [] }, jiraTickets: [{ key: "APP-8", summary: "Choice", description: "Context only.", acceptanceCriteria: ["Decision: we chose notifications instead of polling."], technicalDebt: false, htmlUrl: "https://example/8" }] };
  const sections = buildGroundedAlternativesTradeOffsSections(timeline);
  const answer = `**Alternatives considered**\n${sections.alternatives}\n\n**Trade-offs**\n${sections.tradeoffs}`;
  assert.equal(alternativesSectionsLackGrounding(answer, timeline), false);
  assert.ok(answer.includes('" … (excerpt truncated)'));
  assert.ok(!answer.includes('Context only.\nDecision:'));
  const options = { content: answer, userQuestion: "What alternatives?", contextBundle: [{ type: "decision_history", data: { timeline } }] };
  const once = enrichTraceDecisionResponse(options);
  assert.equal(enrichTraceDecisionResponse({ ...options, content: once }), once);
});

test("combined heading repair keeps one alternatives section and separates status", () => {
  const timeline: DecisionTimeline = { ...thinTimeline, linkedPR: { number: 9, title: "Choice", description: "We rejected polling because freshness matters.", state: "merged", labels: [], reviews: [], approvers: [] } };
  const content = '**Alternatives considered / Decision status**\nUnknown.\n\nDecision status: Current behavior is visible; historical rationale remains unknown.';
  const enriched = enrichTraceDecisionResponse({ content, contextBundle: [{ type: "decision_history", data: { timeline } }], userQuestion: "What alternatives were considered?" });
  assert.equal((enriched.match(/\*\*Alternatives considered/g) ?? []).length, 1);
  assert.ok(!enriched.includes('Alternatives considered / Decision status'));
  assert.ok(enriched.includes('**Decision status**\nCurrent behavior is visible'));
});

console.log(`\ndecisionResponseEnrichment: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

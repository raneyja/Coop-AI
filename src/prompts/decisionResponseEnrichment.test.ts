import assert from "node:assert/strict";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  asksAboutAlternativesOrTradeoffs,
  buildThinAlternativesTradeOffsResponse,
  enrichTraceDecisionResponse,
  responseHasSpeculativeTradeoffs
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
  assert.ok(text.includes("**Summary**"));
  assert.ok(text.includes("Unknown — not recorded"));
  assert.ok(text.includes("Not documented"));
  assert.ok(text.includes("[Sources: GitHub commit dd2bb73]"));
  assert.ok(!text.includes("Performance vs"));
  assert.ok(text.split("\n").length < 20);
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

console.log(`\ndecisionResponseEnrichment: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

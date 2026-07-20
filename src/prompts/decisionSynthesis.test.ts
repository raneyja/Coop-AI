import assert from "node:assert/strict";
import type { DecisionTimeline } from "../types/decisionTimeline";
import { buildDecisionSynthesisUserPrompt, formatTimelineForPrompt } from "./decisionSynthesis";

const timeline: DecisionTimeline = {
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

test("decision synthesis includes primary trace target and citation checklist", () => {
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("## Primary trace target"));
  assert.ok(prompt.includes("fastify.js"));
  assert.ok(prompt.includes("[Sources: GitHub commit dd2bb73]"));
});

test("decision synthesis requires out-of-scope callout for local workspace @ attachments", () => {
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify",
    mentionedFiles: [
      { path: "lib/logger-factory.js", repoId: "github:coop-demo-lab/fastify" },
      {
        path: "src/webview/CoopChatPanel.tsx",
        repoId: "workspace:local",
        source: "local"
      }
    ],
    activeRepoId: "github:coop-demo-lab/fastify"
  });
  assert.ok(prompt.includes("## @ attachments"));
  assert.ok(prompt.includes("local workspace"));
  assert.ok(prompt.includes("Out-of-scope @ attachments"));
  assert.ok(prompt.includes("primary trace target only"));
});

test("decision synthesis requires short form on initial thin-evidence trace", () => {
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify",
    userQuestion:
      "Explain why this code exists and what trade-offs were accepted. Respond in complete sentences.",
    userBubble: "[trace-decision] Trace the engineering decision behind this code.",
    isFollowUp: false
  });
  assert.ok(prompt.includes("## Alternatives / trade-offs guidance"));
  assert.ok(prompt.includes("**omit** **Alternatives considered** and **Trade-offs** entirely"));
  assert.ok(prompt.includes("Do not infer generic trade-offs"));
  assert.ok(prompt.includes("SHORT form"));
  assert.ok(!prompt.includes("full trace narrative"));
});

test("decision synthesis follow-up steers compact alternatives answer when evidence is thin", () => {
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify",
    userQuestion: "What trade-offs were rejected?",
    userBubble: "What trade-offs were rejected?",
    isFollowUp: true
  });
  assert.ok(prompt.includes("## Follow-up"));
  assert.ok(prompt.includes("Alternatives / trade-offs guidance"));
  assert.ok(prompt.includes("**omit** **Alternatives considered** and **Trade-offs** entirely"));
  assert.ok(prompt.includes("Do not infer generic trade-offs"));
  assert.ok(prompt.includes("What trade-offs were rejected?"));
});

test("decision synthesis requires quote before alternatives when PR is attached", () => {
  const withPr: DecisionTimeline = {
    ...timeline,
    linkedPR: {
      number: 1506,
      title: "Add logger factory",
      state: "merged",
      description: "Centralize logging",
      approvers: ["alice"],
      reviews: [{ author: "alice", body: "We rejected the singleton approach.", createdAt: "2016-10-04" }]
    }
  };
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline: withPr,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("quote or paraphrase"));
  assert.ok(prompt.includes("PR #1506"));
});

test("decision synthesis includes enriched evidence fields and enrichment instructions", () => {
  const enrichedTimeline: DecisionTimeline = {
    ...timeline,
    targetLabel: "fastify.js:10-20",
    introducingDiffSummary: {
      filesChanged: 2,
      insertions: 30,
      deletions: 4,
      summary: "Introducing commit changed 2 files (+30 / -4)."
    },
    evolution: {
      commitCountSinceIntroduction: 7,
      lastModifiedAt: "2026-06-01",
      lastModifiedAuthor: "@bob"
    },
    rationaleRanking: [
      { source: "pr:1506", role: "rationale", label: "PR #1506" },
      { source: "commit:dd2bb73", role: "provenance", label: "GitHub commit dd2bb73" }
    ],
    completeness: "partial"
  };
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline: enrichedTimeline,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("Target: fastify.js:10-20"));
  assert.ok(prompt.includes("## Evidence enrichment"));
  assert.ok(prompt.includes("primary rationale source"));
  assert.ok(prompt.includes("Introducing diff summary"));
  assert.ok(prompt.includes("Evolution since introduction"));
  assert.ok(prompt.includes("Rationale ranking"));
  const formatted = formatTimelineForPrompt(enrichedTimeline);
  assert.ok(formatted.includes("targetLabel: fastify.js:10-20"));
  assert.ok(formatted.includes("primary rationale source"));
  assert.ok(formatted.includes("Commits since introduction: 7"));
});

test("decision synthesis includes trace completeness and omits status fillers when thin", () => {
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("### Trace completeness"));
  assert.ok(prompt.includes("Completeness: minimal"));
  assert.ok(prompt.includes("**Decision status**"));
  assert.ok(prompt.includes("**Who to engage**"));
  assert.ok(prompt.includes("only when evidence names people"));
  assert.ok(prompt.includes("introducing commit and message — provenance"));
});

test("decision synthesis expands when discussion evidence is attached", () => {
  const withPr: DecisionTimeline = {
    ...timeline,
    completeness: "partial",
    linkedPR: {
      number: 1506,
      title: "Add logger factory",
      state: "merged",
      description: "Centralize logging",
      approvers: ["alice"],
      reviews: [{ author: "alice", body: "We rejected the singleton approach.", createdAt: "2016-10-04" }]
    }
  };
  const prompt = buildDecisionSynthesisUserPrompt({
    timeline: withPr,
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify",
    isFollowUp: false
  });
  assert.ok(prompt.includes("Discussion evidence is attached"));
  assert.ok(prompt.includes("quote or paraphrase"));
  assert.ok(!prompt.includes("SHORT form"));
});

test("formatTimelineForPrompt surfaces technical debt on jira tickets", () => {
  const withDebt: DecisionTimeline = {
    ...timeline,
    jiraTickets: [
      {
        key: "WID-99",
        summary: "Retry cleanup",
        description: "Deferred refactor",
        acceptanceCriteria: [],
        technicalDebt: true,
        htmlUrl: "https://jira/acme/WID-99"
      }
    ]
  };
  const formatted = formatTimelineForPrompt(withDebt);
  assert.ok(formatted.includes("Technical debt: flagged in ticket metadata"));
  assert.ok(formatted.includes("Technical debt flagged: WID-99"));
});

test("formatTimelineForPrompt includes integration search evidence", () => {
  const withSearch: DecisionTimeline = {
    ...timeline,
    integrationSearch: {
      seedJiraKeys: ["COOP-101"],
      seedSearchTerms: ["githubAppApi"],
      confluence: {
        pages: [
          {
            id: "1",
            title: "ADR: GitHub App API",
            excerpt: "Centralize app auth validation",
            htmlUrl: "https://confluence/adr"
          }
        ]
      },
      jira: {
        issues: [{ key: "COOP-101", summary: "Trace validation", status: "Done", htmlUrl: "https://jira/COOP-101" }]
      }
    }
  };
  const formatted = formatTimelineForPrompt(withSearch);
  assert.ok(formatted.includes("Cross-tool search seeds"));
  assert.ok(formatted.includes("COOP-101"));
  assert.ok(formatted.includes("ADR: GitHub App API"));
});

console.log(`\ndecisionSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

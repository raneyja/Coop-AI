import assert from "node:assert/strict";
import { buildTeamDomainGraph, calculateOwnershipScores, collectEscalationAvenues } from "./ownershipAnalysis";
import type { OwnershipScore, OwnershipSignals } from "../../types/ownership";

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

function score(partial: Partial<OwnershipScore> & Pick<OwnershipScore, "owner" | "tier" | "score">): OwnershipScore {
  return {
    commitCount: 0,
    reviewApprovals: 0,
    issueResolutions: 0,
    activityWeight: 1,
    role: "author",
    ...partial
  };
}

test("calculateOwnershipScores propagates github login from commit stats", () => {
  const signals: OwnershipSignals = {
    commits: [
      {
        author: "raneyja",
        authorLogin: "raneyja",
        counts: { sixMonths: 2, oneYear: 2, allTime: 2 },
        recencyScore: 2,
        lastCommitDate: new Date().toISOString(),
        messages: []
      }
    ],
    reviews: [],
    issues: [],
    specialties: [],
    activity: [
      {
        author: "raneyja",
        lastActiveDate: new Date().toISOString(),
        weight: 1,
        inactive: false
      }
    ]
  };

  const scores = calculateOwnershipScores(signals);
  assert.equal(scores.length, 1);
  assert.equal(scores[0]?.owner, "raneyja");
  assert.equal(scores[0]?.githubLogin, "raneyja");
});

test("sparse-commit primary + CODEOWNERS team yields escalation avenue (smoke retest shape)", () => {
  // Mirrors documenso send-signing-email.ts: one primary committer, no secondary tier.
  const scores = [score({ owner: "dguyen", score: 100, tier: "primary", commitCount: 3, role: "author" })];
  const graph = buildTeamDomainGraph(scores, [], {
    orgContext: {
      teamName: "documenso",
      teamSlug: "documenso",
      members: ["documenso"],
      source: "codeowners"
    }
  });

  assert.match(graph.escalationPath, /@dguyen is the primary contact/);
  assert.match(graph.escalationPath, /CODEOWNERS team @documenso/);
  assert.match(graph.escalationPath, /\[Sources: CODEOWNERS\]/);
  assert.doesNotMatch(graph.escalationPath, /no strong backup identified/);
  assert.doesNotMatch(graph.escalationPath, /no strong secondary/);
});

test("sparse-commit primary + CODEOWNERS path owners (no team slug) yields path-owner escalation", () => {
  const scores = [score({ owner: "dguyen", score: 100, tier: "primary", commitCount: 2 })];
  const graph = buildTeamDomainGraph(scores, [], {
    orgContext: {
      teamName: "mythie, catalinpit",
      members: ["mythie", "catalinpit"],
      source: "codeowners"
    }
  });

  assert.match(graph.escalationPath, /@dguyen is the primary contact/);
  assert.match(graph.escalationPath, /CODEOWNERS path owners @mythie, @catalinpit/);
  assert.match(graph.escalationPath, /\[Sources: CODEOWNERS\]/);
  assert.doesNotMatch(graph.escalationPath, /no strong backup identified/);
});

test("sparse-commit primary + recent reviewers yields reviewer escalation when CODEOWNERS missing", () => {
  const scores = [score({ owner: "dguyen", score: 100, tier: "primary", commitCount: 1 })];
  const graph = buildTeamDomainGraph(scores, [], {
    recentReviewers: ["dguyen", "catalinpit", "mythie"]
  });

  assert.match(graph.escalationPath, /@dguyen is the primary contact/);
  assert.match(graph.escalationPath, /recent reviewers @catalinpit, @mythie/);
  assert.match(graph.escalationPath, /\[Sources: GitHub commits & reviews\]/);
  assert.doesNotMatch(graph.escalationPath, /@dguyen.*recent reviewers.*@dguyen/);
  assert.doesNotMatch(graph.escalationPath, /no strong backup identified/);
});

test("sparse-commit primary with no CODEOWNERS/reviewers yields explicit admin gap (not empty backup)", () => {
  const scores = [score({ owner: "dguyen", score: 100, tier: "primary", commitCount: 1 })];
  const graph = buildTeamDomainGraph(scores, []);

  assert.match(graph.escalationPath, /@dguyen is the primary contact/);
  assert.match(graph.escalationPath, /No CODEOWNERS team or path owners matched/);
  assert.match(graph.escalationPath, /Escalate via repository admins\/maintainers/);
  assert.match(graph.escalationPath, /\[Sources: GitHub commits & reviews\]/);
  assert.doesNotMatch(graph.escalationPath, /no strong backup identified/);
});

test("score-tier secondary still preferred over CODEOWNERS for backup contact", () => {
  const scores = [
    score({ owner: "dguyen", score: 100, tier: "primary", commitCount: 5 }),
    score({ owner: "mythie", score: 45, tier: "secondary", commitCount: 2, role: "both" })
  ];
  const graph = buildTeamDomainGraph(scores, [], {
    orgContext: {
      teamName: "documenso",
      teamSlug: "documenso",
      members: ["documenso"],
      source: "github_teams"
    }
  });

  assert.match(graph.escalationPath, /If @dguyen is unavailable, reach out to @mythie next/);
  assert.match(graph.escalationPath, /\[Sources: GitHub commits & reviews\]/);
});

test("collectEscalationAvenues never invents handles outside evidence", () => {
  const avenues = collectEscalationAvenues("dguyen", {
    orgContext: {
      teamName: "Platform",
      teamSlug: "platform",
      members: ["alice", "dguyen"],
      source: "github_teams"
    },
    recentReviewers: ["bob"]
  });
  const joined = avenues.join(" | ");
  assert.match(joined, /CODEOWNERS team @platform/);
  assert.match(joined, /CODEOWNERS path owners @alice/);
  assert.match(joined, /recent reviewers @bob/);
  assert.doesNotMatch(joined, /@invented/);
  assert.doesNotMatch(joined, /@dguyen/);
});

console.log(`\nownershipAnalysis: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

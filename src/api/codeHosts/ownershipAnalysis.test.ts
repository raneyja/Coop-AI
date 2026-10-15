import assert from "node:assert/strict";
import { analyzeCommitPatterns, buildOrgContextFromCodeowners, buildTeamDomainGraph, calculateOwnershipScores, collectEscalationAvenues, computeOwnershipRisk, draftOwnerMessage, parseCodeowners } from "./ownershipAnalysis";
import type { OwnershipReport, OwnershipScore, OwnershipSignals } from "../../types/ownership";

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
  assert.match(graph.escalationPath, /\[Sources: Code host commits & reviews\]/);
  assert.doesNotMatch(graph.escalationPath, /@dguyen.*recent reviewers.*@dguyen/);
  assert.doesNotMatch(graph.escalationPath, /no strong backup identified/);
});

test("sparse-commit primary with no CODEOWNERS/reviewers yields explicit admin gap (not empty backup)", () => {
  const scores = [score({ owner: "dguyen", score: 100, tier: "primary", commitCount: 1 })];
  const graph = buildTeamDomainGraph(scores, []);

  assert.match(graph.escalationPath, /@dguyen is the primary contact/);
  assert.match(graph.escalationPath, /No CODEOWNERS team or path owners matched/);
  assert.match(graph.escalationPath, /Escalate via repository admins\/maintainers/);
  assert.match(graph.escalationPath, /\[Sources: Code host commits & reviews\]/);
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
  assert.match(graph.escalationPath, /\[Sources: Code host commits & reviews\]/);
});

test("missing or recent contribution activity cannot prove contact availability", () => {
  const contributors = [score({ owner: "alice", score: 90, tier: "primary" })];
  assert.equal(buildTeamDomainGraph(contributors).members[0].available, false);
  assert.equal(buildTeamDomainGraph(contributors, [{ author: "alice", weight: 1, inactive: false }]).members[0].available, false);
  const present = [{ ...contributors[0], presence: { state: "active" as const, label: "Active · inferred" } }];
  assert.equal(buildTeamDomainGraph(present).members[0].available, false, "active presence does not prove response availability");
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
  assert.match(joined, /repository team @platform.*path ownership unverified/);
  assert.doesNotMatch(joined, /CODEOWNERS|@alice/);
  assert.match(joined, /recent reviewers @bob/);
  assert.doesNotMatch(joined, /@invented/);
  assert.doesNotMatch(joined, /@dguyen/);
});

test("missing or invalid expert activity is unknown rather than unavailable", () => {
  const experts = [score({owner: "alice", tier: "primary", score: 100})];
  const now = Date.parse("2026-10-04T22:00:00Z");
  assert.equal(computeOwnershipRisk(experts, [], [], now).expertUnavailable, false);
  assert.equal(computeOwnershipRisk(experts, [], [{author: "alice", lastActiveDate: "invalid", weight: 0, inactive: true}], now).expertUnavailable, false);
});

test("today's matching commit defeats stale expert inactivity but not unrelated authors", () => {
  const experts = [score({owner: "Alice", githubLogin: "alice", tier: "primary", score: 100})];
  const now = Date.parse("2026-10-04T22:00:00Z");
  const activity = [{author: "Alice", lastActiveDate: "2025-01-01T00:00:00Z", weight: 0, inactive: true}];
  const commit = {sha: "today", author: "Alice", authorLogin: "alice", date: "2026-10-04T20:00:00Z", message: "seed"};
  assert.equal(computeOwnershipRisk(experts, [commit], activity, now).expertUnavailable, false);
  assert.equal(computeOwnershipRisk(experts, [{...commit, author: "Bob", authorLogin: "bob"}], activity, now).expertUnavailable, true);
  assert.equal(computeOwnershipRisk(experts, [], activity, now).expertUnavailable, true);
});

test("matched policy preserves declared handles when team lookup returns extra members", () => {
  for (const path of ["src/handler.ts", "odd_area/process.py", "crates/core.rs", "cmd/main.go"]) {
    const match = parseCodeowners("* @org/platform @reviewer", path)!;
    const org = buildOrgContextFromCodeowners(match, [{ name: "Platform", slug: "platform", members: ["extra-member"], htmlUrl: "https://example.test/team" }])!;
    assert.equal(org.source, "codeowners");
    assert.equal(org.codeownersPattern, "*");
    assert.equal(org.teamSlug, "org/platform");
    assert.deepEqual(org.members, ["org/platform", "reviewer"]);
    assert.deepEqual(org.teamMembers, ["extra-member"]);
    const avenues = collectEscalationAvenues(undefined, { orgContext: org }).join("; ");
    assert.match(avenues, /CODEOWNERS team @org\/platform/);
    assert.match(avenues, /CODEOWNERS path owners @reviewer/);
    assert.doesNotMatch(avenues, /extra-member/);
    match.owners.push("late-mutation");
    assert.doesNotMatch(org.members.join(","), /late-mutation/);
  }
});

test("team metadata without a declared rule cannot establish path owners", () => {
  const graph = buildTeamDomainGraph([], [], {orgContext: {source: "github_teams", teamName: "Platform", teamSlug: "platform", members: ["alice", "bob"]}});
  assert.match(graph.escalationPath, /suggested contact; path ownership unverified/);
  assert.doesNotMatch(graph.escalationPath, /CODEOWNERS|@alice|@bob/);
});

test("secondary-only ranking and message draft cannot establish maintainer status or policy absence", () => {
  const candidate = score({ owner: "reviewer", score: 45, tier: "secondary", reviewApprovals: 2, role: "reviewer" });
  const graph = buildTeamDomainGraph([candidate]);
  assert.match(graph.escalationPath, /No primary score tier/);
  assert.doesNotMatch(graph.escalationPath, /No primary owner|has the most context/);
  const report: OwnershipReport = {owner: "org", repo: "repo", path: "strange/file.rs", scores: [candidate], teamGraph: graph, risk: {singlePointOfFailure: false, expertUnavailable: false, orphaned: false, highTurnover: false, teamDispersion: false}, history: [], warnings: [], completeness: "partial", messageDraft: {recipient: "", text: ""}};
  assert.doesNotMatch(draftOwnerMessage(report).text, /primary maintainer|recent activity/);
  assert.match(draftOwnerMessage(report).text, /sampled contribution signals/);
});

test("latest sampled commit keeps its own message beyond the capped traversal sample", () => {
  const commits = Array.from({ length: 21 }, (_, index) => ({ sha: String(index), author: "A", message: `older-${index}`, date: "2024-01-01T00:00:00Z" }));
  commits.push({ sha: "latest", author: "A", message: "Actual latest message", date: "2025-01-01T00:00:00Z" });
  for (const input of [commits, [...commits].reverse()]) {
    const entry = analyzeCommitPatterns(input, Date.parse("2025-02-01"))[0]!;
    assert.deepEqual(entry.latestSampledCommit, { sha: "latest", date: "2025-01-01T00:00:00Z", message: "Actual latest message", sameTimeCount: 1 });
    assert.equal(entry.messages.length, 20);
    assert.equal(entry.lastCommitDate, "2025-01-01T00:00:00.000Z");
  }
  assert.ok(!analyzeCommitPatterns(commits)[0]!.messages.includes("Actual latest message"));
});

test("parsed timestamps and ties preserve exact date-message identity without claiming uniqueness", () => {
  const commits = [
    { sha: "z", author: "A", message: "tie-z", date: "2025-01-01T01:00:00+01:00" },
    { sha: "a", author: "A", message: "tie-a", date: "2025-01-01T00:00:00Z" },
    { sha: "lexically-later", author: "A", message: "older", date: "2025-01-01T05:00:00+06:00" },
    { sha: "invalid", author: "A", message: "undated", date: "unavailable" }
  ];
  for (const input of [commits, [...commits].reverse()]) {
    const entry = analyzeCommitPatterns(input, Date.parse("2025-02-01"))[0]!;
    assert.deepEqual(entry.latestSampledCommit, { sha: "a", message: "tie-a", date: "2025-01-01T00:00:00Z", sameTimeCount: 2 });
    assert.equal(entry.counts.allTime, 4);
    assert.ok(Number.isFinite(entry.recencyScore));
  }
  const invalid = analyzeCommitPatterns([commits[3]!])[0]!;
  assert.equal(invalid.latestSampledCommit, undefined);
  assert.equal(invalid.lastCommitDate, undefined);
  assert.deepEqual(analyzeCommitPatterns([]), []);
});

console.log(`\nownershipAnalysis: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

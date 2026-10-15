import assert from "node:assert/strict";
import { buildUserMessageWithContext, systemPromptForUseCase } from "./systemPrompts";
import type { OwnershipReport } from "../types/ownership";
import { buildOwnershipSynthesisUserPrompt, formatOwnershipReportForPrompt, OWNERSHIP_EVIDENCE_SCOPE_RULES, OWNERSHIP_INTELLIGENCE_SYSTEM } from "./ownershipSynthesis";
import { listOwnershipSourceLabels } from "./ownershipSourceLabels";

const report: OwnershipReport = {
  owner: "acme",
  repo: "widgets",
  path: "src/handler.ts",
  provider: "github",
  completeness: "full",
  scores: [{ owner: "alice", score: 85, tier: "primary", commitCount: 12 }],
  risk: { singlePointOfFailure: false, expertUnavailable: false, orphaned: false, highTurnover: false, teamDispersion: false },
  teamGraph: { escalationPath: "Ask @alice first", members: [] },
  history: [],
  messageDraft: { text: "", recipient: "" },
  warnings: []
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

test("team lookup is not a CODEOWNERS source or declared ownership", () => {
  const lookup = {...report, orgContext: {source: "github_teams" as const, teamName: "Platform", teamSlug: "platform", members: ["alice"]}};
  assert.ok(!listOwnershipSourceLabels(lookup).includes("[Sources: CODEOWNERS]"));
  assert.ok(listOwnershipSourceLabels(lookup).includes("[Sources: GitHub repository teams]"));
  const formatted = formatOwnershipReportForPrompt(lookup);
  assert.match(formatted, /lookup does not establish declared ownership/);
  assert.doesNotMatch(formatted, /### \[Sources: CODEOWNERS\]/);
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /team lookup members are not additional CODEOWNERS/);
});

test("prompt uses the active code host and preserves matched rule handles", () => {
  for (const provider of ["github", "gitlab", "bitbucket"] as const) {
    const declared = {...report, provider, orgContext: {source: "codeowners" as const, teamName: "Platform", members: ["org/platform", "reviewer"], codeownersPattern: "*", teamMembers: ["extra-member"]}};
    const formatted = formatOwnershipReportForPrompt(declared);
    const codeHostLabel = listOwnershipSourceLabels(declared)[0];
    assert.ok(formatted.includes(`### ${codeHostLabel}`));
    if (provider !== "github") assert.doesNotMatch(formatted, /GitHub commits & reviews/);
    assert.match(formatted, /Declared handles: org\/platform, reviewer/);
    assert.match(formatted, /Matched rule: \*/);
    assert.match(formatted, /Team lookup members \(not additional declared owners\): extra-member/);
  }
});

test("independent heading and person-level scope policy reaches hosted system and actual user synthesis", () => {
  const hosted = systemPromptForUseCase("ownership", {activeFile: report.path});
  const user = buildOwnershipSynthesisUserPrompt({report, file: report.path});
  assert.ok(hosted.includes(OWNERSHIP_EVIDENCE_SCOPE_RULES));
  assert.ok(user.includes(OWNERSHIP_EVIDENCE_SCOPE_RULES));
  assert.match(OWNERSHIP_EVIDENCE_SCOPE_RULES, /Every heading, person bullet and recommendation must independently/);
  assert.match(OWNERSHIP_EVIDENCE_SCOPE_RULES, /sampled contributor may also be a declared owner under unreviewed policy/);
  assert.match(OWNERSHIP_EVIDENCE_SCOPE_RULES, /not establish no activity, inactivity/);
  assert.match(OWNERSHIP_EVIDENCE_SCOPE_RULES, /comment without a person's name does not establish an ownership or staffing gap/);
  assert.doesNotMatch(hosted, /Slack availability status|Be pragmatic: if someone is listed as owner but inactive|who should learn this|contact candidate, not a declared owner/);
});

test("zero commit buckets and old retrieved history remain commit samples across languages and layouts", () => {
  for (const path of ["odd/runtime.ts", "feature/handler.py", "engine.rs", "cmd/start.go"]) {
    const sampled: OwnershipReport = {...report, path,
      scores: [{...report.scores[0], commitCount: 0}],
      signals: {commits: [{author: "alice", authorLogin: "alice", counts: {sixMonths: 0, oneYear: 0, allTime: 4},
        recencyScore: 0, lastCommitDate: "2020-01-01T00:00:00Z", messages: []}], reviews: [], issues: [], activity: [], specialties: []},
      pathEvolution: {recentCommitCount: 4, lastModifiedAt: "2020-01-01T00:00:00Z", lastModifiedAuthor: "alice"}};
    const prompt = buildOwnershipSynthesisUserPrompt({report: sampled, file: path, now: new Date("2026-10-11T22:00:00Z")});
    assert.match(prompt, /0 retrieved commits \(6mo sample\)/);
    assert.match(prompt, /sampled commit counts 6mo=0, 1yr=0, all retrieved=4; other activity and contact availability unverified/);
    assert.match(prompt, /Retrieved commits analyzed: 4/);
    assert.match(prompt, /4 retrieved commit\(s\)/);
    assert.doesNotMatch(prompt, /4 recent commit\(s\)|Recent commits analyzed: 4/);
    assert.match(prompt, /older commit dates cannot establish that a person is inactive or unavailable/);
  }
});

test("presence and legacy team availability cannot prove reachability", () => {
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /not proof someone is reachable/);
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /inferred name matches are not verified person links/);
  const formatted = formatOwnershipReportForPrompt({
    ...report,
    teamGraph: { escalationPath: "Suggested contact", members: [{ owner: "alice", role: "primary", score: 85, available: true }] }
  });
  assert.match(formatted, /response availability unverified/);
  assert.doesNotMatch(formatted, /sampled primary contributor, available/);
});

test("ownership synthesis includes citation keys and sources checklist", () => {
  const prompt = buildOwnershipSynthesisUserPrompt({ report, file: report.path });
  assert.ok(prompt.includes("[Sources: GitHub commits & reviews]"));
  assert.ok(prompt.includes("Source labels (inline only"));
});

test("ownership synthesis splits out-of-repo @ attachments", () => {
  const prompt = buildOwnershipSynthesisUserPrompt({
    report,
    file: report.path,
    mentionedFiles: [
      { path: "src/util.ts", repoId: "github:acme/widgets" },
      { path: "other/repo/file.ts", repoId: "github:other/repo" }
    ],
    activeRepoId: "github:acme/widgets"
  });
  assert.ok(prompt.includes("util.ts"));
  assert.ok(prompt.includes("Out-of-scope @ attachments"));
  assert.ok(prompt.includes("repo/file.ts"));
});

test("ownership synthesis supports repository-wide scope", () => {
  const repoWideReport: OwnershipReport = {
    path: "(repository)",
    owner: "acme",
    repo: "widgets",
    completeness: "partial",
    scores: [],
    risk: {
      singlePointOfFailure: false,
      expertUnavailable: false,
      orphaned: false,
      highTurnover: false,
      teamDispersion: false
    },
    teamGraph: { escalationPath: "Check CODEOWNERS", members: [] },
    history: [],
    messageDraft: { text: "", recipient: "" },
    warnings: []
  };
  const prompt = buildOwnershipSynthesisUserPrompt({
    report: repoWideReport,
    file: "(repository)"
  });
  assert.ok(prompt.includes("repository-wide"));
  assert.ok(prompt.includes("Who owns acme/widgets"));
  assert.ok(prompt.includes("escalation order"));
  assert.ok(prompt.includes("CODEOWNERS data is present"));
});

test("ownership synthesis surfaces CODEOWNERS orgContext prominently", () => {
  const codeownersReport: OwnershipReport = {
    ...report,
    orgContext: {
      teamName: "Platform Auth",
      teamSlug: "platform-auth",
      members: ["alice", "bob"],
      manager: "carol",
      slackChannel: "#platform-auth",
      source: "codeowners"
    }
  };
  const formatted = formatOwnershipReportForPrompt(codeownersReport);
  assert.ok(formatted.startsWith("### [Sources: CODEOWNERS]"));
  assert.ok(formatted.includes("Platform Auth"));
  assert.ok(formatted.includes("@platform-auth"));
  assert.ok(!formatted.includes("### Organizational context"));

  const prompt = buildOwnershipSynthesisUserPrompt({
    report: codeownersReport,
    file: report.path
  });
  assert.ok(prompt.includes("[Sources: CODEOWNERS]"));
  assert.ok(!OWNERSHIP_INTELLIGENCE_SYSTEM.includes("hiring"));
  assert.ok(OWNERSHIP_INTELLIGENCE_SYSTEM.includes("coverage gaps"));
});

test("ownership synthesis omits outreach draft and includes pathEvolution guidance", () => {
  const reportWithEvolution: OwnershipReport = {
    ...report,
    messageDraft: { recipient: "alice", text: "Hi Alice, can you help with handler.ts?" },
    pathEvolution: {
      recentCommitCount: 12,
      lastModifiedAt: "2026-06-18",
      lastModifiedAuthor: "@alice"
    }
  };
  const formatted = formatOwnershipReportForPrompt(reportWithEvolution);
  assert.ok(!formatted.includes("Suggested outreach draft"));
  assert.ok(!formatted.includes("Hi Alice"));
  assert.ok(formatted.includes("Path evolution"));
  assert.ok(formatted.includes("Last modifier: @alice"));

  const prompt = buildOwnershipSynthesisUserPrompt({
    report: reportWithEvolution,
    file: report.path
  });
  assert.ok(prompt.includes("## Evidence enrichment"));
  assert.ok(prompt.includes("## Path evolution guidance"));
  assert.ok(prompt.includes("12 retrieved commit(s)"));
  assert.ok(!prompt.includes("Suggested outreach draft"));
});

test("ownership synthesis requires on-call escalation or explicit admin gap", () => {
  assert.ok(OWNERSHIP_INTELLIGENCE_SYSTEM.includes("Never end on \"no backup\""));
  assert.ok(OWNERSHIP_INTELLIGENCE_SYSTEM.includes("Never invent people"));
  const prompt = buildOwnershipSynthesisUserPrompt({ report, file: report.path });
  assert.ok(prompt.includes("Required on-call shape"));
  assert.ok(prompt.includes("Do not invent contacts"));
});

test("ownership synthesis cites Slack presence when discussions are empty", () => {
  const reportWithPresence: OwnershipReport = {
    ...report,
    scores: [
      {
        owner: "alice",
        score: 85,
        tier: "primary",
        commitCount: 12,
        presence: { label: "Active" }
      }
    ]
  };
  const formatted = formatOwnershipReportForPrompt(reportWithPresence, { messages: [] });
  assert.ok(formatted.includes("[Sources: Slack presence]"));
  assert.ok(!formatted.includes("[Sources: Slack discussions]"));

  const prompt = buildOwnershipSynthesisUserPrompt({
    report: reportWithPresence,
    file: report.path,
    slackSearch: { messages: [] }
  });
  assert.ok(prompt.includes("## Slack citation guidance"));
  assert.ok(prompt.includes("[Sources: Slack presence]"));
  assert.ok(prompt.includes("do not cite `[Sources: Slack discussions]`"));
  const checklistStart = prompt.indexOf("## Source labels (inline only");
  const checklistEnd = prompt.indexOf("## Grounding", checklistStart);
  const checklistSection = prompt.slice(checklistStart, checklistEnd);
  assert.equal(
    (checklistSection.match(/\[Sources: Slack presence\]/g) ?? []).length,
    1,
    "expected one Slack presence checklist bullet"
  );
});

test("a sole scored author is contribution evidence, not proof of exclusive knowledge", () => {
  const formatted = formatOwnershipReportForPrompt({...report, risk: {...report.risk, singlePointOfFailure: true}});
  assert.match(formatted, /Scored primary contributors: 1/);
  assert.match(formatted, /Scored secondary contributors: 0/);
  assert.match(formatted, /Broader maintainer, backup and knowledge coverage: unavailable/);
  assert.doesNotMatch(formatted, /only one person knows/);
});

test("today's dated commit contradicts stale risk rather than becoming inactive ownership", () => {
  const now = new Date("2026-10-04T22:00:00.000Z");
  const today: OwnershipReport = {
    ...report,
    risk: {...report.risk, orphaned: true, expertUnavailable: true},
    pathEvolution: {recentCommitCount: 1, lastModifiedAt: "2026-10-04T20:00:00.000Z", lastModifiedAuthor: "alice"},
    signals: {commits: [{author: "Alice", authorLogin: "alice", counts: {sixMonths: 1, oneYear: 1, allTime: 1}, recencyScore: 1, lastCommitDate: "2026-10-04T20:00:00.000Z", messages: []}], reviews: [], issues: [], activity: [], specialties: []}
  };
  const prompt = buildOwnershipSynthesisUserPrompt({report: today, file: today.path, now});
  assert.match(prompt, /Analysis time \(UTC\): 2026-10-04T22:00:00.000Z/);
  assert.match(prompt, /last retrieved commit 2026-10-04T20:00:00.000Z/);
  assert.match(prompt, /Recent dated activity conflicts/);
  assert.doesNotMatch(prompt, /Orphaned — no commits in 6\+ months|All experts appear unavailable \(inactive 3\+ months\)/);
});

test("sampled author and Slack away cannot establish declared ownership or inactivity", () => {
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /declared-owner status is a separate question, unverified without explicit attached/);
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /Slack away\/offline indicates presence only/);
  const prompt = formatOwnershipReportForPrompt(report, undefined, new Date("2026-10-04T22:00:00Z"));
  assert.match(prompt, /Score tiers rank sampled contributors; their declared-owner status is separate and unverified/);
  assert.match(prompt, /Missing or contradictory recency evidence is unknown/);
});

test("sole author and derived admin fallback preserve unknown ownership coverage", () => {
  const sampled = {...report, risk: {...report.risk, singlePointOfFailure: true}, teamGraph: {...report.teamGraph, escalationPath: "Escalate via repository admins/maintainers"}};
  const prompt = buildOwnershipSynthesisUserPrompt({report: sampled, file: sampled.path});
  assert.match(prompt, /sampled Primary contributor/);
  assert.match(prompt, /Suggested escalation \(not a verified policy\)/);
  assert.match(prompt, /Missing a scored secondary does not establish that no secondary owner exists/);
  assert.match(prompt, /Repository admins are a suggested fallback/);
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /coverage question, not proof the repository is a single point of failure/);
  assert.match(prompt, /Retrieved commit counts measure commits, not all activity or contact suitability/);
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /single seed commit cannot prove no commits in earlier quarters\/years/);
});

test("all derived risk booleans remain mechanical sample counts rather than personnel-risk facts", () => {
  const formatted = formatOwnershipReportForPrompt({...report, risk: {singlePointOfFailure: true, expertUnavailable: true, orphaned: true, highTurnover: true, teamDispersion: true}});
  assert.match(formatted, /Scored primary contributors: 1/);
  assert.match(formatted, /Scored secondary contributors: 0/);
  assert.doesNotMatch(formatted, /single.point.of.failure|Orphaned|High turnover|Team dispersion|All experts appear unavailable/i);
  assert.doesNotMatch(OWNERSHIP_INTELLIGENCE_SYSTEM, /Highlights any single-point-of-failure risks/);
});

test("derived history and cross-team prose cannot reintroduce unproven ownership risk", () => {
  const formatted = formatOwnershipReportForPrompt({...report,
    history: [{period: "recent", label: "Recent sample", primaryOwner: "alice", secondaryOwners: [], narrative: "Confirmed single-point-of-failure repository; no backup exists"}],
    teamGraph: {...report.teamGraph, crossTeamNote: "Team dispersion confirmed; only Alice knows this code"}
  });
  assert.match(formatted, /highest-ranked contributor alice; other ranked contributors none retrieved/);
  assert.doesNotMatch(formatted, /Confirmed single-point|no backup exists|Team dispersion confirmed|only Alice knows/);
});

test("missing policy matches stay unverified in actual assembled ownership prompt even with a full report", () => {
  const prompt = buildOwnershipSynthesisUserPrompt({ report: {
    ...report, owner: "CoopAI-Corp", repo: "coop-dogfood-launch", path: "src/mathRenamed.ts",
    orgContext: undefined, warnings: ["No CODEOWNERS file/team matched"],
    completeness: "full"
  } });
  const assembled = buildUserMessageWithContext(prompt, { owner: "CoopAI-Corp", repo: "coop-dogfood-launch" });
  assert.ok(assembled.includes("declared ownership is unverified in this pass, not absent"));
  assert.ok(assembled.includes("An absence claim requires independently attached policy coverage proving it"));
  assert.ok(assembled.includes("Report completeness and contributor scores do not establish exhaustive policy coverage"));
  assert.ok(OWNERSHIP_INTELLIGENCE_SYSTEM.includes("Missing CODEOWNERS/team matches do not prove that no declared owner exists"));
  assert.equal(OWNERSHIP_INTELLIGENCE_SYSTEM.includes('"no CODEOWNERS/team; escalate via repository admins/maintainers"'), false);
});

console.log(`\nownershipSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

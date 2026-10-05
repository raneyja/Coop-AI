import assert from "node:assert/strict";
import type { OwnershipReport } from "../types/ownership";
import { buildOwnershipSynthesisUserPrompt, formatOwnershipReportForPrompt, OWNERSHIP_INTELLIGENCE_SYSTEM } from "./ownershipSynthesis";

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
  assert.ok(prompt.includes("12 recent commit(s)"));
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
  assert.match(prompt, /last commit 2026-10-04T20:00:00.000Z/);
  assert.match(prompt, /Recent dated activity conflicts/);
  assert.doesNotMatch(prompt, /Orphaned — no commits in 6\+ months|All experts appear unavailable \(inactive 3\+ months\)/);
});

test("sampled author and Slack away cannot establish declared ownership or inactivity", () => {
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /contact candidate, not a declared owner/);
  assert.match(OWNERSHIP_INTELLIGENCE_SYSTEM, /Slack away\/offline indicates presence only/);
  const prompt = formatOwnershipReportForPrompt(report, undefined, new Date("2026-10-04T22:00:00Z"));
  assert.match(prompt, /Score tiers rank sampled contributors; they do not declare ownership/);
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
  assert.match(prompt, /Retrieved counts are sampled evidence, not complete history/);
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

console.log(`\nownershipSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

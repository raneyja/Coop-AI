import assert from "node:assert/strict";
import type { OwnershipReport } from "../types/ownership";
import { buildOwnershipSynthesisUserPrompt, formatOwnershipReportForPrompt, OWNERSHIP_INTELLIGENCE_SYSTEM } from "./ownershipSynthesis";

const report: OwnershipReport = {
  owner: "acme",
  repo: "widgets",
  path: "src/handler.ts",
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

test("ownership synthesis includes citation keys and sources checklist", () => {
  const prompt = buildOwnershipSynthesisUserPrompt({ report, file: report.path });
  assert.ok(prompt.includes("[Sources: GitHub commits & reviews]"));
  assert.ok(prompt.includes("Required **Sources** bullets"));
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
  const checklistStart = prompt.indexOf("## Required **Sources** bullets");
  const checklistEnd = prompt.indexOf("## Evidence quality", checklistStart);
  const checklistSection = prompt.slice(checklistStart, checklistEnd);
  assert.equal(
    (checklistSection.match(/\[Sources: Slack presence\]/g) ?? []).length,
    1,
    "expected one Slack presence checklist bullet"
  );
});

console.log(`\nownershipSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

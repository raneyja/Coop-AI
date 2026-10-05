import assert from "node:assert/strict";
import { buildKnowledgeGapsSynthesisUserPrompt, KNOWLEDGE_GAPS_EVIDENCE_SYSTEM } from "./knowledgeGapsSynthesis";

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

test("knowledge-gaps synthesis includes primary target and out-of-scope @ attachments", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { file: "fastify.js" },
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify",
    mentionedFiles: [
      { path: "lib/logger-factory.js", repoId: "github:coop-demo-lab/fastify" },
      { path: "src/webview/CoopChatPanel.tsx", repoId: "workspace:local", source: "local" }
    ],
    activeRepoId: "github:coop-demo-lab/fastify"
  });
  assert.ok(prompt.includes("## Open file"));
  assert.ok(prompt.includes("## @ attachments"));
  assert.ok(prompt.includes("local workspace"));
  assert.ok(prompt.includes("Out-of-scope @ attachments"));
});

test("knowledge-gaps synthesis supports repository-wide scope without file", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {},
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("across coop-demo-lab/fastify"));
  assert.ok(prompt.includes("## Repository"));
  assert.ok(prompt.includes("coop-demo-lab/fastify"));
  assert.ok(prompt.includes("repository-wide blind spots"));
  assert.ok(!prompt.includes("primary target"));
});

test("knowledge-gaps synthesis forbids invented gaps when scan is missing", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { file: "fastify.js" },
    confluence: { pages: [] },
    jira: { issues: [] },
    slack: { messages: [] },
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.match(prompt, /Do not invent Documentation gaps/i);
  assert.match(prompt, /No matching Confluence pages/);
  assert.match(prompt, /No matching Jira issues/);
});

test("knowledge-gaps synthesis uses response contract instead of invented enrichment", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("## Response contract (required)"));
  assert.ok(prompt.includes("Missing search hits or unattached source bodies establish a coverage limit"));
  assert.ok(prompt.includes("never turn unavailable evidence into a confirmed gap"));
  assert.ok(prompt.includes("Omit Ownership & maintenance entirely"));
  assert.ok(prompt.includes("Omit Integration & operations entirely"));
  assert.ok(!prompt.includes("missing runbooks"));
  assert.ok(!prompt.includes("introducingDiffSummary"));
});

test("knowledge-gaps synthesis requires Notion pages and scan gaps in response contract", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {
      file: "fastify.js",
      jobScan: {
        gaps: [
          { type: "missing_docs", message: "No Confluence pages matched repo scope", file: "fastify.js" },
          { type: "missing_docs", message: "No Google Docs matched repo scope", file: "fastify.js" }
        ]
      }
    },
    notion: {
      pages: [
        { id: "1", title: "ADR: Webview vs native sidebar (COOP-55)", updated: "2026-01-01" },
        { id: "2", title: "Coop AI Demo", updated: "2026-01-01" }
      ]
    },
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("**Notion pages reviewed** — exactly 2 titled bullet(s)"));
  assert.ok(prompt.includes("summarize what the attached Body says"));
  assert.ok(prompt.includes("Do not list titles alone as documentation gaps"));
  assert.ok(prompt.includes("No Confluence pages matched repo scope"));
  assert.ok(prompt.includes("No Google Docs matched repo scope"));
  assert.ok(prompt.includes("Omit Ownership & maintenance entirely"));
});

test("knowledge-gaps synthesis includes Notion opened excerpt in Attached facts", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    notion: {
      pages: [
        {
          id: "n1",
          title: "ADR: Auth",
          excerpt: "Decision: use installation tokens for requireAuth."
        }
      ]
    },
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.match(prompt, /Body: Decision: use installation tokens/);
  assert.doesNotMatch(prompt, /- ADR: Auth\n(?! {2}Body:)/);
});

test("knowledge-gaps synthesis includes Google Docs opened excerpt in Attached facts", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    googleDocs: {
      documents: [
        {
          id: "g1",
          title: "ADR: Auth",
          excerpt: "Chose GitHub App over PAT for requireAuth."
        }
      ]
    },
    file: "fastify.js"
  });
  assert.match(prompt, /Body: Chose GitHub App/);
});

test("knowledge-gaps synthesis includes Jira opened description not just summary", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    jira: {
      issues: [
        {
          key: "COOP-101",
          summary: "Auth hardening",
          status: "Done",
          description: "Chose GitHub App over PAT for requireAuth."
        }
      ]
    },
    file: "fastify.js"
  });
  assert.match(prompt, /Body: Chose GitHub App/);
});

test("knowledge-gaps synthesis includes Slack opened thread body when threadOpened", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    slack: {
      messages: [
        {
          channelName: "eng",
          text: "alice: Chose GitHub App over PAT.\nbob: Agreed — ship the App install path.",
          threadOpened: true
        }
      ]
    },
    file: "fastify.js"
  });
  assert.match(prompt, /Body: alice: Chose GitHub App/);
  assert.match(prompt, /ship the App install path/);
});

test("knowledge-gaps synthesis labels unattached Notion bodies honestly", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    notion: {
      pages: [{ id: "n1", title: "ADR: Auth" }]
    },
    file: "fastify.js"
  });
  assert.match(prompt, /Body: not attached/);
});

test("knowledge-gaps synthesis includes Teams opened thread body when threadOpened", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    teams: {
      messages: [
        {
          fromUserName: "dana",
          body: "Chose GitHub App over PAT for requireAuth.",
          threadOpened: true
        }
      ]
    },
    file: "fastify.js"
  });
  assert.match(prompt, /Body: Chose GitHub App/);
});

test("knowledge-gaps synthesis flags limited evidence when scan missing", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {},
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("[Sources: Evidence limited]"));
  assert.ok(prompt.includes("No automated scan attached"));
});

test("knowledge-gaps synthesis frames zero-gap scan with attached docs in response contract", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [], foundGaps: 0, scanCoverage: "no_structured_gaps" } },
    confluence: {
      pages: [{ id: "1", title: "Coop AI — Architecture Overview", updated: "2026-01-01" }]
    },
    file: "src/server/githubAppApi.ts",
    owner: "raneyja",
    repo: "Coop-AI"
  });
  assert.ok(prompt.includes("Automated scan found no structured gaps in this pass; attached doc review suggests"));
  assert.ok(prompt.includes("do not contradict the zero-gap scan"));
});

test("knowledge-gaps synthesis treats missing graph as incomplete not a docs gap", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {
      jobScan: {
        foundGaps: 1,
        gaps: [{ type: "impact_unknown", message: "No indexed dependency graph for impact context" }]
      }
    },
    owner: "raneyja",
    repo: "Coop-AI"
  });
  assert.ok(prompt.includes("scan was incomplete"));
  assert.ok(prompt.includes("GitHub Dependency Submission"));
  assert.ok(!prompt.includes("Scan gap subsection from [Sources: Knowledge gap scan]: No indexed dependency graph"));
});

test("knowledge-gaps synthesis labels Confluence as org docs not repo architecture SoT", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    confluence: {
      pages: [{ id: "1", title: "Coop AI — Architecture Overview", updated: "2026-01-01" }]
    },
    owner: "CoopAI-Corp",
    repo: "plane"
  });
  assert.ok(prompt.includes("Org docs"));
  assert.ok(prompt.includes("CoopAI-Corp/plane"));
  assert.ok(prompt.includes("architecture source of truth"));
  assert.ok(prompt.includes("Coop-AI ADRs"));
});

test("knowledge-gaps with focus excerpts audits attached code instead of claiming it is missing", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {
      userFocus:
        "Focus on the agent hunt loop and mid-loop Slack/Jira tools — what's undocumented or still unsafe for a 500-person org to turn on by default?",
      focusSearchQuery: "agent hunt loop | mid-loop Slack/Jira tools",
      focusSearchPaths: ["src/api/agent/AgentOrchestrator.ts"],
      focusFiles: [
        {
          path: "src/api/agent/AgentOrchestrator.ts",
          content: "const MAX_INTEGRATION_TOOL_CALLS = 3;\nsearch_slack(); search_jira();"
        }
      ]
    },
    owner: "raneyja",
    repo: "Coop-AI",
    userFocus:
      "Focus on the agent hunt loop and mid-loop Slack/Jira tools — what's undocumented or still unsafe for a 500-person org to turn on by default?"
  });
  assert.ok(prompt.includes("### Focus file excerpts"));
  assert.ok(prompt.includes("src/api/agent/AgentOrchestrator.ts"));
  assert.ok(prompt.includes("MAX_INTEGRATION_TOOL_CALLS"));
  assert.ok(prompt.includes("default-on"));
  assert.ok(!prompt.includes("No indexed code"));
  assert.ok(prompt.includes("Do not claim the code is missing"));
});

test("hunt/locate risk prompt names evidence-class gaps not runbook-only", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {
      file: "src/config/responseDeadline.ts",
      userFocus:
        "What's still unsafe about default-on hunt for on-call API-error locates?",
      focusFiles: [
        {
          path: "src/api/agent/searchQuery.ts",
          content: "export function isApiRejectAsk() { return true; }"
        }
      ],
      jobScan: {
        gaps: [
          {
            type: "wrong_file_evidence",
            message: "Hunt ranking can attach the wrong file"
          }
        ]
      }
    },
    file: "src/config/responseDeadline.ts",
    userFocus: "What's still unsafe about default-on hunt for on-call API-error locates?"
  });
  assert.ok(prompt.includes("wrong-file ranking"));
  assert.ok(prompt.includes("canned miss"));
  assert.ok(prompt.includes("docs/runbook may be thin"));
});

test("gap recommendations cannot assume earlier proposed edits were applied", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({ evidence: {}, file: "src/mathRenamed.ts" });
  assert.ok(prompt.includes("Recommendations are prospective"));
  assert.ok(prompt.includes("Never assume a proposed patch was applied"));
  assert.ok(prompt.includes("actual attached source body is authoritative"));
});

test("gaps synthesis preserves dated ownership evidence and labels scan absence as unproven", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    file: "src/mathRenamed.ts",
    evidence: {
      jobScan: { gaps: [{ type: "missing_owner", message: "No owner declared", file: "src/mathRenamed.ts" }] },
      ownershipReport: {
        owner: "org", repo: "fixture", path: "src/mathRenamed.ts", completeness: "partial",
        scores: [{ owner: "raneyja", score: 80, tier: "primary", commitCount: 3 }],
        signals: {
          commits: [{ author: "Jon", authorLogin: "raneyja", counts: { sixMonths: 3, oneYear: 3, allTime: 3 }, recencyScore: 1, lastCommitDate: "2026-10-04T21:00:00Z", messages: [] }],
          reviews: [], issues: [], activity: [], specialties: []
        },
        risk: { singlePointOfFailure: false, expertUnavailable: true, orphaned: true, highTurnover: false, teamDispersion: false },
        teamGraph: { escalationPath: "Unknown", members: [] }, history: [],
        messageDraft: { text: "", recipient: "" }, warnings: []
      }
    }
  });
  assert.ok(prompt.includes("Coverage flag (missing_owner)"));
  assert.ok(prompt.includes("absence is not established"));
  assert.ok(prompt.includes("last commit 2026-10-04T21:00:00Z"));
  assert.ok(prompt.includes("Analysis time (UTC)"));
  assert.ok(prompt.includes("reviewer checks, recommendations, and suggested contacts"));
  assert.ok(prompt.includes("Aggregate commit counts do not establish last-quarter inactivity"));
});

test("gaps full remote bodies retain real line offsets for source citations", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({ evidence: {
    focusFiles: [{ path: "src/mathRenamed.ts", startLine: 1, content: "\nexport function positiveSum() {\n  return 0;\n}" }]
  } });
  assert.ok(prompt.includes("L1: \nL2: export function positiveSum()"));
  assert.ok(prompt.includes("Verified source lines 1–4"));
  assert.ok(prompt.includes("numeric start:end:path citation fences"));
  assert.ok(prompt.includes("**Source-grounded review** section before scan coverage sections"));
  assert.ok(prompt.includes("Generic missing_docs/missing_owner flags do not substitute for reading the attached function"));
});

test("incomplete ownership scans require policy verification before recommending CODEOWNERS changes", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    file: "src/mathRenamed.ts",
    userFocus: "Identify concrete supported gaps for positiveSum with source citations",
    evidence: {
      focusFiles: [{ path: "src/mathRenamed.ts", startLine: 1, content: "export function positiveSum(values: number[]) { return values[0]; }" }],
      jobScan: { gaps: [{ type: "missing_owner", message: "No declared owner", file: "src/mathRenamed.ts" }] }
    }
  });
  assert.ok(prompt.includes("recommend checking the current ownership policy first"));
  assert.ok(prompt.includes("Do not recommend adding a CODEOWNERS entry"));
  assert.ok(prompt.includes("solely from missing_owner/orphaned scan flags"));
  assert.ok(prompt.includes("A policy change requires verified policy evidence"));
});

test("gaps arbitrary focus snippets cannot invent source line offsets", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({ evidence: {
    focusFiles: [{ path: "src/helper.ts", content: "export const helper = 1;" }]
  } });
  assert.ok(prompt.includes("Source line offsets unavailable"));
  assert.equal(prompt.includes("L1: export const helper"), false);
});

test("gap behavior claims require traced conditions and an evidenced expected contract", () => {
  assert.ok(KNOWLEDGE_GAPS_EVIDENCE_SYSTEM.includes("Universal behavior claims require tracing"));
  assert.match(KNOWLEDGE_GAPS_EVIDENCE_SYSTEM, /check relevant counterexamples/);
  assert.ok(KNOWLEDGE_GAPS_EVIDENCE_SYSTEM.includes("function name alone is not a formal specification"));
  assert.ok(KNOWLEDGE_GAPS_EVIDENCE_SYSTEM.includes("potential defect conditional on the expected behavior"));
});

test("named fixture audit does not convert observed loop bounds and a caller edge into a proven defect", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    file: "src/mathRenamed.ts",
    userFocus: "Identify concrete supported gaps for positiveSum and caller impact. Cite evidence and label unknowns.",
    evidence: {
      focusFiles: [
        { path: "src/mathRenamed.ts", startLine: 1, content: "export function positiveSum(values: number[]): number {\n  let total = 0;\n  for (let i = 0; i < values.length - 1; i++) {\n    if (values[i] > 0) total += values[i];\n  }\n  return total;\n}" },
        { path: "src/caller.ts", startLine: 1, content: 'import type { MathInput } from "./contract";\nimport { positiveSum } from "./mathRenamed";\n\nexport function summarize(input: MathInput): number {\n  return positiveSum(input.values);\n}' }
      ]
    }
  });
  assert.ok(prompt.includes("values.length - 1"));
  assert.ok(prompt.includes("return positiveSum(input.values)"));
  assert.ok(prompt.includes("in the finding itself, not a later disclaimer"));
  assert.ok(prompt.includes("do not label behavior a confirmed error, blocker, or wrong result"));
  assert.ok(prompt.includes("A function name is not contract evidence"));
  assert.ok(prompt.includes("do not claim inevitable wrong caller results without the relevant inputs and expected contract"));
});

test("normalized gaps file graph never labels importers as verified symbol callers", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({file: "src/mathRenamed.ts", userFocus: "Inspect positiveSum", evidence: {file: "src/mathRenamed.ts", dependencyGraph: {directDependents: ["src/caller.ts"]}}});
  assert.ok(prompt.includes("Retrieved file dependencies (1; sample, not complete caller coverage)"));
  assert.ok(prompt.includes("Graph provenance: unknown. Symbol use is unverified"));
  assert.ok(prompt.includes("do not call these named-function callers or claim behavior propagates"));
});

console.log(`\nknowledgeGapsSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

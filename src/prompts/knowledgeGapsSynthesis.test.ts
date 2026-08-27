import assert from "node:assert/strict";
import { buildKnowledgeGapsSynthesisUserPrompt } from "./knowledgeGapsSynthesis";

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
  assert.ok(prompt.includes("## Primary target"));
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
  assert.ok(prompt.includes("## Primary target"));
  assert.ok(prompt.includes("Repository: coop-demo-lab/fastify"));
  assert.ok(prompt.includes("repository-wide blind spots"));
  assert.ok(!prompt.includes("primary target file only"));
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
  assert.ok(prompt.includes("In **Documentation gaps**, name every attached page or document title"));
  assert.ok(prompt.includes("No Confluence pages matched repo scope"));
  assert.ok(prompt.includes("No Google Docs matched repo scope"));
  assert.ok(prompt.includes("Omit Ownership & maintenance entirely"));
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
    evidence: { jobScan: { gaps: [], foundGaps: 0 } },
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

console.log(`\nknowledgeGapsSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

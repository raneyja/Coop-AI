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

test("knowledge-gaps synthesis requires compact Notion pages and scan gaps in response contract", () => {
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
  assert.ok(prompt.includes("**Notion pages reviewed** — at most 3 titled bullets"));
  assert.ok(prompt.includes("No Confluence pages matched repo scope"));
  assert.ok(prompt.includes("No Google Docs matched repo scope"));
  assert.ok(prompt.includes("Omit Ownership & maintenance entirely"));
  assert.ok(prompt.includes("**Recommended next step** — exactly one concrete action"));
});

test("knowledge-gaps synthesis caps reviewed pages and scan gaps in response contract", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {
      jobScan: {
        gaps: [
          { type: "missing_docs", message: "Gap A" },
          { type: "missing_docs", message: "Gap B" },
          { type: "missing_docs", message: "Gap C" },
          { type: "missing_docs", message: "Gap D" },
          { type: "impact_unknown", message: "Gap E" }
        ]
      }
    },
    confluence: {
      pages: [
        { id: "1", title: "Page One", updated: "2026-01-01" },
        { id: "2", title: "Page Two", updated: "2026-01-01" },
        { id: "3", title: "Page Three", updated: "2026-01-01" },
        { id: "4", title: "Page Four", updated: "2026-01-01" }
      ]
    },
    file: "src/server/api.ts"
  });
  const contract = prompt.slice(prompt.indexOf("## Response contract (required)"));
  assert.ok(contract.includes("Top 3 of 4; full list in Sources card"));
  assert.ok(contract.includes("Omit remaining 2 lower-priority scan gaps"));
  assert.ok(contract.includes("Gap A"));
  assert.ok(contract.includes("Gap C"));
  assert.ok(!contract.includes("Gap D"));
  assert.ok(!contract.includes("Gap E"));
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

console.log(`\nknowledgeGapsSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

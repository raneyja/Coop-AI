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

test("knowledge-gaps synthesis uses knowledge-gaps enrichment instead of decision archaeology", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: { jobScan: { gaps: [] } },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("## Knowledge gaps enrichment"));
  assert.ok(prompt.includes("missing runbooks"));
  assert.ok(!prompt.includes("introducingDiffSummary"));
});

test("knowledge-gaps synthesis includes enterprise audit rubric when scan missing", () => {
  const prompt = buildKnowledgeGapsSynthesisUserPrompt({
    evidence: {},
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("[Sources: Evidence limited]"));
  assert.ok(prompt.includes("No automated scan attached"));
});

console.log(`\nknowledgeGapsSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

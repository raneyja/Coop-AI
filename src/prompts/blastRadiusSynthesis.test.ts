import assert from "node:assert/strict";
import { buildBlastRadiusSynthesisUserPrompt } from "./blastRadiusSynthesis";

const evidence = {
  file: "fastify.js",
  dependencyGraph: {
    directDependents: ["lib/plugin.js"],
    edgeCount: 3
  }
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

test("blast-radius synthesis includes primary target and out-of-scope @ attachments", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence,
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

test("blast-radius synthesis forbids zero-impact language in guardrails", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: { file: "fastify.js", directDependents: [], warnings: ["No dependents found in index"] },
    file: "fastify.js",
    owner: "coop-demo-lab",
    repo: "fastify"
  });
  assert.ok(prompt.includes("Impact unverified"));
  assert.ok(prompt.includes("no dependents found in index"));
});

test("blast-radius synthesis includes dependent details when present", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: {
      file: "fastify.js",
      directDependents: ["lib/plugin.js"],
      dependentDetails: [{ path: "lib/plugin.js", depth: 1, source: "zoekt" }]
    },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("lib/plugin.js (depth 1, zoekt)"));
});

test("blast-radius synthesis includes docs references section when present", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: {
      file: "fastify.js",
      directDependents: ["examples/https.js"],
      docsReferences: [{ path: "README.md", depth: 1, source: "zoekt" }]
    },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("[Sources: Docs references]"));
  assert.ok(prompt.includes("README.md"));
});

test("blast-radius synthesis includes top risk surfaces ranking", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: {
      file: "fastify.js",
      directDependents: ["test/a.test.js", "integration/server.js", "examples/https.js"],
      dependentDetails: [
        { path: "test/a.test.js", depth: 1, source: "heuristic" },
        { path: "integration/server.js", depth: 1, source: "heuristic" },
        { path: "examples/https.js", depth: 1, source: "heuristic" }
      ]
    },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("### Top risk surfaces"));
  assert.ok(prompt.includes("integration/server.js"));
  assert.ok(/1\. integration\/server\.js/.test(prompt));
});

test("blast-radius synthesis includes CI rollout guidance when workflows present", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: {
      file: "fastify.js",
      directDependents: ["lib/plugin.js"],
      ciWorkflows: [{ path: ".github/workflows/ci.yml", matchedPath: "fastify.js" }],
      ownersByFile: [{ file: "lib/plugin.js", owner: "team-a", source: "codeowners" }]
    },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("rollout/verification"));
  assert.ok(prompt.includes("Top risk surfaces"));
  assert.ok(prompt.includes("CODEOWNERS"));
});

console.log(`\nblastRadiusSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

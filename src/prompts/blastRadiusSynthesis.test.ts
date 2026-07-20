import assert from "node:assert/strict";
import {
  BLAST_RADIUS_EVIDENCE_SYSTEM,
  buildBlastRadiusSynthesisUserPrompt
} from "./blastRadiusSynthesis";

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
  assert.ok(prompt.includes("## Blast brevity (required)"));
  assert.ok(prompt.includes("not found in the index"));
  assert.ok(prompt.includes("Do not invent dependents"));
  assert.ok(prompt.includes("omit **Testing surfaces** entirely"));
  assert.equal(prompt.includes("## Evidence enrichment"), false);
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

test("blast-radius synthesis keeps CI/CODEOWNERS guidance short when present", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: {
      file: "fastify.js",
      directDependents: ["lib/plugin.js"],
      ciWorkflows: [{ path: ".github/workflows/ci.yml", matchedPath: "fastify.js" }],
      ownersByFile: [{ file: "lib/plugin.js", owner: "team-a", source: "codeowners" }],
      testFiles: [{ path: "test/plugin.test.js", source: "heuristic" }]
    },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("## Blast brevity (required)"));
  assert.ok(prompt.includes("≤3 short bullets under **Operational risk**"));
  assert.ok(prompt.includes("No deploy essays"));
  assert.ok(prompt.includes("notify owners of **Top risk surfaces**"));
  assert.ok(prompt.includes("list ≤5 under **Testing surfaces**"));
  assert.ok(prompt.includes("Hard omit empty sections"));
  assert.equal(prompt.includes("## Evidence enrichment"), false);
});

test("blast-radius synthesis system string hard-omits empty impact sections", () => {
  assert.ok(BLAST_RADIUS_EVIDENCE_SYSTEM.includes("Hard omit"));
  assert.ok(BLAST_RADIUS_EVIDENCE_SYSTEM.includes("Never invent dependents"));
  assert.ok(BLAST_RADIUS_EVIDENCE_SYSTEM.includes("not found in the index"));
  assert.ok(BLAST_RADIUS_EVIDENCE_SYSTEM.includes("short and scannable"));
});

test("blast-radius synthesis leads Summary with partial index caveat when graph is partial", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: {
      file: "src/server/githubAppApi.ts",
      directDependents: ["src/server/routes.ts"],
      graphMeta: { edgeCount: 12, lightningEnabled: false, source: "zoekt" },
      completeness: "partial"
    },
    file: "src/server/githubAppApi.ts",
    owner: "raneyja",
    repo: "Coop-AI"
  });
  assert.ok(prompt.includes("## Summary guidance"));
  assert.ok(prompt.includes("partial index coverage caveat"));
  assert.ok(prompt.includes("Index coverage is partial"));
  const checklistStart = prompt.indexOf("## Required **Sources** bullets");
  const checklistEnd = prompt.indexOf("## Evidence quality", checklistStart);
  const checklistSection = prompt.slice(checklistStart, checklistEnd);
  assert.equal(
    (checklistSection.match(/\[Sources: Dependency graph\]/g) ?? []).length,
    1,
    "expected one Dependency graph checklist bullet"
  );
});

test("blast-radius synthesis requires attached documentation titles", () => {
  const prompt = buildBlastRadiusSynthesisUserPrompt({
    evidence: {
      file: "fastify.js",
      directDependents: ["lib/plugin.js"],
      confluenceSearch: {
        pages: [{ id: "1", title: "Fastify rollout runbook", updated: "2026-01-01", htmlUrl: "https://wiki/1" }]
      },
      notionSearch: {
        pages: [{ id: "2", title: "Fastify architecture notes", updated: "2026-01-02", url: "https://notion/2" }]
      }
    },
    file: "fastify.js"
  });
  assert.ok(prompt.includes("## Attached documentation (required in response)"));
  assert.ok(prompt.includes("APIs & integrations"));
  assert.ok(prompt.includes("Fastify rollout runbook"));
  assert.ok(prompt.includes("Fastify architecture notes"));
});

console.log(`\nblastRadiusSynthesis: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import {
  blastRadiusFromBundle,
  knowledgeGapsFromBundle,
  repoSummaryFromBundle
} from "./contextBundleEvidence";

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

test("knowledgeGapsFromBundle returns undefined for empty bundle", () => {
  assert.equal(knowledgeGapsFromBundle([]), undefined);
});

test("knowledgeGapsFromBundle merges job scan and ownership from bundle entries", () => {
  const evidence = knowledgeGapsFromBundle([
    {
      type: "knowledge_gaps",
      data: {
        file: "src/server/githubAppApi.ts",
        jobScan: { foundGaps: 2, gaps: [{ type: "docs", summary: "Missing README section" }] }
      }
    },
    {
      type: "ownership",
      data: {
        report: {
          path: "src/server/githubAppApi.ts",
          scores: [{ owner: "alex", score: 42, tier: "primary" }],
          risk: {},
          teamGraph: { escalationPath: "Eng manager", members: [] },
          completeness: "full"
        }
      }
    },
    {
      type: "dependencies",
      data: {
        directDependents: ["src/routes/auth.ts"],
        graphMeta: { edgeCount: 12, source: "lightning" }
      }
    }
  ]);

  assert.ok(evidence);
  assert.equal(evidence!.file, "src/server/githubAppApi.ts");
  assert.equal(evidence!.jobScan?.foundGaps, 2);
  assert.equal(evidence!.ownershipReport?.scores[0]?.owner, "alex");
  assert.deepEqual(evidence!.dependencyGraph?.directDependents, ["src/routes/auth.ts"]);
  assert.equal(evidence!.dependencyGraph?.edgeCount, 12);
});

test("blastRadiusFromBundle filters job dependents to target file", () => {
  const evidence = blastRadiusFromBundle([
    {
      type: "dependencies",
      data: {
        file: "fastify.js",
        directDependents: [],
        jobScan: {
          source: "dependency-graph-job",
          edgeCount: 42,
          dependentsSample: [
            { from: "test/app.test.js", to: "fastify.js" },
            { from: "lib/other.js", to: "lib/unrelated.js" }
          ]
        }
      }
    }
  ]);

  assert.ok(evidence);
  assert.deepEqual(evidence!.directDependents, ["test/app.test.js"]);
  assert.equal(evidence!.graphMeta?.edgeCount, 42);
});

test("blastRadiusFromBundle merges integration searches from bundle entries", () => {
  const evidence = blastRadiusFromBundle([
    {
      type: "dependencies",
      data: {
        file: "fastify.js",
        directDependents: ["test/app.test.js"],
        notionSearch: { pages: [], error: undefined },
        googleDocsSearch: { documents: [] },
        teamsSearch: { messages: [] }
      }
    }
  ]);

  assert.ok(evidence?.notionSearch);
  assert.ok(evidence?.googleDocsSearch);
  assert.ok(evidence?.teamsSearch);
});

test("repoSummaryFromBundle merges all integration searches", () => {
  const summary = repoSummaryFromBundle([
    {
      type: "file_metadata",
      data: {
        manifest: { fileCount: 10 },
        entryFiles: [{ path: "README.md" }],
        confluenceSearch: { pages: [] },
        jiraSearch: { issues: [] },
        slackSearch: { messages: [] },
        teamsSearch: { messages: [] },
        notionSearch: { pages: [] },
        googleDocsSearch: { documents: [] }
      }
    }
  ]);

  assert.ok(summary?.confluence);
  assert.ok(summary?.jira);
  assert.ok(summary?.slack);
  assert.ok(summary?.teams);
  assert.ok(summary?.notion);
  assert.ok(summary?.googleDocs);
});

const total = passed + failed;
console.log(`\ncontextBundleEvidence: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

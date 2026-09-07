import assert from "node:assert/strict";
import {
  blastRadiusFromBundle,
  contextBundleHasRepoFactEvidence,
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

test("blastRadiusFromBundle never promotes unfiltered remote job edges", () => {
  const evidence = blastRadiusFromBundle([
    {
      type: "dependencies",
      data: {
        file: "src/config/responseDeadline.ts",
        jobScan: {
          source: "dependency-graph-job",
          edgeCount: 10,
          dependentsSample: [
            { from: "admin/src/lib/activeGrantRepoIds.ts", to: "admin/src/lib/other.ts" },
            { from: "src/api/dataSanitization.ts", to: "src/api/unrelated.ts" }
          ]
        }
      }
    }
  ]);
  assert.ok(evidence);
  assert.equal(evidence!.directDependents?.length ?? 0, 0);
  assert.ok((evidence!.warnings ?? []).some((w) => /ignored unfiltered/i.test(w)));
});

test("blastRadiusFromBundle does not let heuristic overwrite zoekt callers", () => {
  const evidence = blastRadiusFromBundle([
    {
      type: "dependencies",
      data: {
        file: "src/config/responseDeadline.ts",
        directDependents: ["src/chat/CoopChatSession.ts", "src/jobs/JobApiClient.ts"],
        dependentDetails: [
          { path: "src/chat/CoopChatSession.ts", depth: 1, source: "zoekt" },
          { path: "src/jobs/JobApiClient.ts", depth: 1, source: "zoekt" }
        ],
        graphMeta: { source: "zoekt" }
      }
    },
    {
      type: "dependencies",
      data: {
        file: "src/config/responseDeadline.ts",
        directDependents: [
          "admin/src/components/IndexingQueueList.tsx",
          "src/context/requestPrioritizer.ts"
        ],
        dependentDetails: [
          { path: "admin/src/components/IndexingQueueList.tsx", depth: 1, source: "heuristic" },
          { path: "src/context/requestPrioritizer.ts", depth: 1, source: "heuristic" }
        ],
        graphMeta: { source: "heuristic" }
      }
    }
  ]);
  assert.ok(evidence);
  assert.deepEqual(evidence!.directDependents, [
    "src/chat/CoopChatSession.ts",
    "src/jobs/JobApiClient.ts"
  ]);
  assert.equal(evidence!.graphMeta?.source, "zoekt");
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

test("contextBundleHasRepoFactEvidence detects packageStructure and tree", () => {
  assert.equal(contextBundleHasRepoFactEvidence([]), false);
  assert.equal(
    contextBundleHasRepoFactEvidence([
      {
        type: "chat_context",
        data: {
          packageStructure: { packages: ["apps/web"], parents: ["apps"] }
        }
      }
    ]),
    true
  );
  assert.equal(
    contextBundleHasRepoFactEvidence([
      {
        type: "chat_context",
        data: { treeOverview: { topLevelDirs: ["apps"], topLevelFiles: ["package.json"] } }
      }
    ]),
    true
  );
  assert.equal(
    contextBundleHasRepoFactEvidence([
      { type: "chat_context", data: { localFiles: { files: [{ path: "package.json" }] } } }
    ]),
    false
  );
  assert.equal(
    contextBundleHasRepoFactEvidence([
      {
        type: "chat_context",
        data: {
          repoSemanticSearch: {
            files: [{ path: "src/server/authMiddleware.ts", content: "export function extractBearerToken() {}" }]
          }
        }
      }
    ]),
    true
  );
});

test("blastRadiusFromBundle does not promote job-scan importers for a named-function blast", () => {
  const evidence = blastRadiusFromBundle([
    {
      type: "dependencies",
      data: {
        file: "src/server/authMiddleware.ts",
        namedAskSymbols: ["requireAuth"],
        directDependents: [],
        jobScan: {
          source: "dependency-graph-job",
          edgeCount: 25,
          dependentsSample: [
            { from: "src/api/adminOrgApi.ts", to: "src/server/authMiddleware.ts" },
            { from: "src/api/atlassianAppApi.ts", to: "src/server/authMiddleware.ts" },
            { from: "src/api/jobsApi.ts", to: "src/server/authMiddleware.ts" }
          ]
        }
      }
    }
  ]);
  assert.ok(evidence);
  assert.equal(evidence!.directDependents?.length ?? 0, 0);
  assert.ok((evidence!.warnings ?? []).some((w) => /named function blast/i.test(w)));
});

const total = passed + failed;
console.log(`\ncontextBundleEvidence: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

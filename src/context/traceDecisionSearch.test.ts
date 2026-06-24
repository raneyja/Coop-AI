import assert from "node:assert/strict";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  buildTraceDecisionSearchSeeds,
  collectDecisionJiraKeys,
  filePathSearchTerms,
  mergeTraceDecisionIntegrationEvidence
} from "./traceDecisionSearch";

const baseTimeline: DecisionTimeline = {
  file: "src/server/githubAppApi.ts",
  completeness: "minimal",
  originalCommit: {
    sha: "1fdbe89abc1234567890abcdef1234567890abcd",
    author: "@dev",
    date: "2026-06-01",
    message: "Add GitHub App API helpers"
  },
  alternatives: [],
  chronology: [],
  warnings: []
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

test("filePathSearchTerms derives basename and camelCase tokens", () => {
  const terms = filePathSearchTerms("src/server/githubAppApi.ts");
  assert.ok(terms.includes("githubAppApi"));
  assert.ok(terms.includes("githubAppApi.ts"));
});

test("collectDecisionJiraKeys reads keys from file content and patch excerpt", () => {
  const keys = collectDecisionJiraKeys(
    {
      ...baseTimeline,
      codeSnippet: "// Coop validation: COOP-101 trace test",
      introducingDiffSummary: {
        filesChanged: 1,
        summary: "1 file changed",
        patchExcerpt: "+ // COOP-202 follow-up"
      }
    },
    "src/server/githubAppApi.ts"
  );
  assert.deepEqual(keys.sort(), ["COOP-101", "COOP-202"].sort());
});

test("buildTraceDecisionSearchSeeds combines file terms and jira keys", () => {
  const seeds = buildTraceDecisionSearchSeeds(
    {
      ...baseTimeline,
      codeSnippet: "// COOP-101 trace test in githubAppApi"
    },
    "src/server/githubAppApi.ts"
  );
  assert.ok(seeds.jiraKeys.includes("COOP-101"));
  assert.ok(seeds.searchTerms.includes("githubAppApi"));
  assert.match(seeds.queryText, /COOP-101/);
});

test("mergeTraceDecisionIntegrationEvidence attaches bundle search results", () => {
  const merged = mergeTraceDecisionIntegrationEvidence(baseTimeline, [
    {
      type: "decision_history",
      data: { timeline: baseTimeline }
    },
    {
      type: "chat_context",
      data: {
        jiraSearch: {
          issues: [{ key: "COOP-101", summary: "Trace validation", status: "Done", htmlUrl: "https://jira/COOP-101" }]
        },
        confluenceSearch: {
          pages: [
            {
              id: "1",
              title: "ADR: GitHub App API",
              excerpt: "Decision to centralize app auth",
              htmlUrl: "https://confluence/1"
            }
          ]
        }
      }
    }
  ], buildTraceDecisionSearchSeeds(baseTimeline, baseTimeline.file));

  assert.ok(merged.integrationSearch?.jira?.issues.length === 1);
  assert.ok(merged.integrationSearch?.confluence?.pages.length === 1);
  assert.ok(merged.integrationSearch?.seedSearchTerms?.includes("githubAppApi"));
});

const total = passed + failed;
console.log(`\ntraceDecisionSearch: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}

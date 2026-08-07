import assert from "node:assert/strict";
import {
  buildImportSearchPatterns,
  buildTestSearchPatterns,
  filterJobDependentsForFile,
  normalizeGraphRepoId
} from "./blastRadiusDependentsFallback";
import { BlastRadiusAnalysisEngine } from "./blastRadiusAnalysis";
import { assessCompletenessFromSignals } from "./blastRadiusAnalysis.testHelpers";
import {
  MAX_USER_FACING_RESPONSE_MS,
  remainingContextGatherBudgetMs,
  RESERVED_SYNTHESIS_MS
} from "../config/responseDeadline";
import type { IndexBackend } from "../indexing/indexBackend";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";

assert.equal(normalizeGraphRepoId("coop-demo-lab/fastify"), "github:coop-demo-lab/fastify");
assert.equal(normalizeGraphRepoId("github:coop-demo-lab/fastify"), "github:coop-demo-lab/fastify");

const patterns = buildImportSearchPatterns("fastify.js");
assert.ok(patterns.some((pattern) => pattern.includes("fastify.js")));
assert.ok(patterns.some((pattern) => pattern.includes("require(")));

const testPatterns = buildTestSearchPatterns("lib/server.js");
assert.deepEqual(testPatterns, ["server.js", "server", "lib/server.js"]);

const filtered = filterJobDependentsForFile(
  [
    { from: "test/routes.test.js", to: "fastify.js" },
    { from: "lib/plugin.js", to: "lib/core.js" }
  ],
  "fastify.js"
);
assert.deepEqual(filtered, ["test/routes.test.js"]);

const unfilteredTarget = filterJobDependentsForFile(
  [{ from: "lib/plugin.js", to: "lib/core.js" }],
  "fastify.js"
);
assert.deepEqual(unfilteredTarget, []);

assert.equal(assessCompletenessFromSignals(["a.ts"], [], undefined), "partial");
assert.equal(assessCompletenessFromSignals(["a.ts"], [{ number: 1 } as never], { messages: [{}] }), "full");
assert.equal(assessCompletenessFromSignals([], [], undefined), "minimal");

assert.equal(remainingContextGatherBudgetMs(Date.now()), MAX_USER_FACING_RESPONSE_MS - RESERVED_SYNTHESIS_MS);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockIndexBackend(options: {
  dependentsDelayMs?: number;
  dependents?: string[];
  searchHits?: Array<{ fileName: string }>;
}): IndexBackend {
  const dependents = options.dependents ?? ["src/app/Caller.tsx", "Foo.stories.tsx"];
  const searchHits = options.searchHits ?? dependents.map((fileName) => ({ fileName }));
  return {
    kind: "local",
    async isEnabledForRepo() {
      return true;
    },
    async enableRepo() {
      return { repoId: "github:acme/plane", enabled: true, status: "ready" };
    },
    async disableRepo() {
      return;
    },
    async refreshRepo() {
      return { repoId: "github:acme/plane", enabled: true, status: "ready" };
    },
    async getRepoStatus() {
      return { repoId: "github:acme/plane", enabled: true, status: "ready" };
    },
    async listRepoStatuses() {
      return [];
    },
    async search() {
      return {
        source: "zoekt",
        hits: searchHits.map((hit, index) => ({
          fileName: hit.fileName,
          lineNumber: index + 1,
          content: `from './state-group'`,
          score: 1
        })),
        symbols: [],
        stale: false
      };
    },
    async dependents() {
      if (options.dependentsDelayMs) {
        await delay(options.dependentsDelayMs);
      }
      return { dependents, source: "scip", file: "packages/ui/src/state-group.tsx" };
    },
    async summarize() {
      return { enabledRepos: 1, totalDiskBytes: 1, readyRepos: 1, indexingRepos: 0 };
    }
  };
}

function mockCodeHostRouter(): CodeHostRouter {
  return {
    async resolveCoordinates(coords) {
      return coords;
    },
    // Unused in this soft-budget path once secondary enrichment is skipped.
  } as unknown as CodeHostRouter;
}

async function softBudgetStillSynthesizesPartialReport(): Promise<void> {
  // gatherStartedAt far in the past → remainingContextGatherBudgetMs === 0 after core graph.
  // Soft gather only (responseDeadline.ts): still return dependents for synthesis; do not hang.
  const gatherStartedAt = Date.now() - MAX_USER_FACING_RESPONSE_MS - 1_000;
  const engine = new BlastRadiusAnalysisEngine({
    codeHostRouter: mockCodeHostRouter(),
    integrationSecrets: {} as IntegrationSecrets,
    indexBackend: mockIndexBackend({
      dependents: [
        "apps/web/components/StateGroupSelect.tsx",
        "apps/web/components/StateGroup.stories.tsx",
        "e2e/state-group.spec.ts"
      ]
    })
  });

  const started = Date.now();
  const report = await engine.analyzeImpact({
    owner: "acme",
    repo: "plane",
    file: "packages/ui/src/state-group.tsx",
    gatherStartedAt
  });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 3_000, `expected soft-budget path to finish quickly, took ${elapsed}ms`);
  assert.ok(report.dependentDetails.length > 0, "expected verified import-search dependents for synthesis");
  assert.equal(report.dependentDetails[0]?.path, "apps/web/components/StateGroupSelect.tsx");
  assert.equal(report.graphMeta?.source, "zoekt");
  assert.ok(
    !report.warnings.some((warning) => /soft gather budget exhausted/i.test(warning)),
    "soft gather must not leak latency jargon into user-facing warnings"
  );
  // Secondary enrichment skipped when budget exhausted.
  assert.equal(report.testFiles.length, 0);
  assert.equal(report.openPullRequests.length, 0);
}

softBudgetStillSynthesizesPartialReport()
  .then(() => {
    console.log("blastRadiusAnalysis: ok");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

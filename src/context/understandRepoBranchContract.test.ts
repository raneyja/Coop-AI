/**
 * Regression contract (Step 5): prefs/defaultBranch `main` must not beat the
 * indexed / Use-repo branch (`preview`). Identity-only must not count as
 * Understand Repo success.
 */
import assert from "node:assert/strict";
import { branchForEditorContext } from "./branchForEditorContext";
import { hasRepoSummaryEvidence } from "./buildRepoSummaryContext";
import {
  hasUnderstandRepoEntryBodies,
  understandRepoEmptyEvidenceMessage
} from "./indexedRepoContextEnrichment";
import { resolveRepoBranchForTarget } from "./resolveRepoBranch";
import { listRepoSummarySourceLabels } from "../prompts/repoSummarySourceLabels";
import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { RepoSummaryEvidence } from "./contextBundleEvidence";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  await test("prefs main loses to sticky Use-repo preview", () => {
    assert.equal(
      branchForEditorContext({ branch: "preview" }, { branch: "main" }),
      "preview"
    );
  });

  await test("indexed preview wins over prefs/session main for file fetches", async () => {
    const router = {
      getRepositoryTree: async (_path: string, coords: { branch?: string }) => ({
        // Hostile echo: pretend the host wants main even when we asked for preview.
        branch: "main",
        entries: [],
        requested: coords.branch
      })
    } as unknown as CodeHostRouter;

    const branch = await resolveRepoBranchForTarget(
      {
        repoId: "github:CoopAI-Corp/plane",
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "main",
        provider: "github"
      },
      {
        codeHostRouter: router,
        resolveIndexedBranch: async () => "preview",
        resolveWorkspaceBranch: async () => "main"
      }
    );
    assert.equal(branch, "preview");
  });

  await test("identity-only is not Understand Repo success", () => {
    const identityOnly = {
      repoId: "github:CoopAI-Corp/plane",
      resolvedBranch: "preview",
      indexedWorkspaceAttached: true
    };
    assert.equal(hasRepoSummaryEvidence(identityOnly), false);
    assert.equal(hasUnderstandRepoEntryBodies(identityOnly), false);
    assert.match(
      understandRepoEmptyEvidenceMessage({
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "preview"
      }),
      /0\.1\.0/
    );
  });

  await test("inventory+tree without file bodies is not synthesis-ready", () => {
    const partial = {
      repoInventory: { fileCount: 4616, branch: "preview" },
      treeOverview: { topLevelDirs: ["apps"], topLevelFiles: ["README.md"] },
      entryFiles: [{ path: "README.md" }]
    };
    assert.equal(hasRepoSummaryEvidence(partial), true);
    assert.equal(hasUnderstandRepoEntryBodies(partial), false);
  });

  await test("full evidence surfaces inventory, tree, and anchor Sources labels", () => {
    const summary: RepoSummaryEvidence = {
      repoInventory: { fileCount: 4616, branch: "preview" },
      treeOverview: { topLevelDirs: ["apps"], topLevelFiles: ["README.md"] },
      entryFiles: [{ path: "README.md", content: "# Plane" }],
      manifest: { fileCount: 4616 }
    };
    const labels = listRepoSummarySourceLabels(summary);
    assert.ok(labels.some((label) => /inventory/i.test(label)));
    assert.ok(labels.some((label) => /tree/i.test(label)));
    assert.ok(labels.some((label) => /anchor files/i.test(label)));
    assert.equal(hasUnderstandRepoEntryBodies(summary as Record<string, unknown>), true);
  });

  const total = passed + failed;
  console.log(`\nunderstandRepoBranchContract: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();

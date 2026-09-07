import assert from "node:assert/strict";
import { hasRepoSummaryEvidence, pickEntryPaths, resolveRepoSummaryCoords, summarizeManifest } from "./buildRepoSummaryContext";
import type { ManifestFileEntry } from "../manifest/types";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  test("resolveRepoSummaryCoords parses owner/repo repoId", () => {
    const coords = resolveRepoSummaryCoords({
      repoId: "raneyja/Coop-AI",
      branch: "main"
    });
    assert.ok(coords);
    assert.equal(coords?.owner, "raneyja");
    assert.equal(coords?.repo, "Coop-AI");
    assert.equal(coords?.branch, "main");
    assert.equal(coords?.repoId, "github:raneyja/Coop-AI");
  });

  test("hasRepoSummaryEvidence detects entry files and manifest", () => {
    assert.equal(hasRepoSummaryEvidence(undefined), false);
    assert.equal(hasRepoSummaryEvidence({ repoId: "github:acme/app" }), false);
    assert.equal(hasRepoSummaryEvidence({ repository: { description: "x" } }), false);
    assert.equal(hasRepoSummaryEvidence({ entryFiles: [{ path: "README.md" }] }), false);
    assert.equal(
      hasRepoSummaryEvidence({ entryFiles: [{ path: "README.md", content: "# App" }] }),
      true
    );
    assert.equal(hasRepoSummaryEvidence({ manifest: { fileCount: 42 } }), true);
  });

  test("pickEntryPaths prefers canonical entry points", () => {
    const manifest: ManifestFileEntry[] = [
      { filePath: "package.json", symbols: [] },
      { filePath: "src/extension.ts", symbols: [{ name: "activate", kind: "function" }] },
      { filePath: "src/server/githubAppApi.ts", symbols: [] }
    ];
    const paths = pickEntryPaths({
      manifest,
      treeOverview: { topLevelDirs: ["src", "docs"], topLevelFiles: ["package.json", "README.md"] },
      activeFile: "src/server/githubAppApi.ts"
    });
    assert.ok(paths.includes("package.json"));
    assert.ok(paths.includes("src/extension.ts"));
    assert.ok(paths.includes("src/server/githubAppApi.ts"));
  });

  test("pickEntryPaths tries blind entry candidates when tree and manifest are empty", () => {
    const paths = pickEntryPaths({
      manifest: [],
      treeOverview: { topLevelDirs: [], topLevelFiles: [] },
      activeFile: "lingui.config.ts"
    });
    assert.ok(paths.includes("package.json"));
    assert.ok(paths.includes("README.md"));
    assert.ok(paths.includes("lingui.config.ts"));
  });

  test("pickEntryPaths injects focus-ranked manifest paths", () => {
    const manifest: ManifestFileEntry[] = [
      { filePath: "package.json", symbols: [] },
      { filePath: "README.md", symbols: [] },
      { filePath: "apps/api/issue/views.py", symbols: [{ name: "IssueViewSet", kind: "class" }] },
      { filePath: "apps/web/components/Board.tsx", symbols: [{ name: "Board", kind: "function" }] },
      { filePath: "apps/api/serializers/issue.py", symbols: [{ name: "IssueSerializer", kind: "class" }] }
    ];
    const paths = pickEntryPaths({
      manifest,
      treeOverview: { topLevelDirs: ["apps"], topLevelFiles: ["package.json", "README.md"] },
      userFocus: "work item create to board flow"
    });
    assert.ok(paths.includes("package.json") || paths.includes("README.md"));
    assert.ok(
      paths.some((path) => /issue|board/i.test(path)),
      `expected focus path among ${paths.join(", ")}`
    );
    assert.ok(
      paths.filter((path) => /issue|board/i.test(path)).length >= 1
    );
  });

  test("pickEntryPaths with onboarding focus prefers domain files over compose/package.json", () => {
    const manifest: ManifestFileEntry[] = [
      { filePath: "package.json", symbols: [] },
      { filePath: "README.md", symbols: [] },
      { filePath: "docker-compose.yml", symbols: [] },
      {
        filePath: "apps/api/plane/api/middleware/api_authentication.py",
        symbols: [{ name: "APIKeyAuthentication", kind: "class" }]
      },
      { filePath: "apps/api/plane/db/models/issue.py", symbols: [{ name: "Issue", kind: "class" }] },
      { filePath: "apps/api/plane/db/models/state.py", symbols: [{ name: "State", kind: "class" }] }
    ];
    const paths = pickEntryPaths({
      manifest,
      treeOverview: { topLevelDirs: ["apps"], topLevelFiles: ["package.json", "README.md"] },
      userFocus:
        "I'm new to this service and I don't have it cloned. Where does API auth live, how do work items and states flow, and what are the 5 files I should read first?"
    });
    assert.ok(
      paths.some((path) => /api_authentication|issue\.py|state\.py/i.test(path)),
      `expected domain path among ${paths.join(", ")}`
    );
    assert.ok(!paths.includes("docker-compose.yml"));
  });

  test("pickEntryPaths ranks auth/issue/state models over OpenAPI, seed JSON, and i18n", () => {
    const manifest: ManifestFileEntry[] = [
      { filePath: "package.json", symbols: [] },
      { filePath: "README.md", symbols: [] },
      { filePath: "apps/api/plane/settings/openapi.py", symbols: [{ name: "OpenAPI", kind: "class" }] },
      { filePath: "apps/api/plane/seeds/data/issues.json", symbols: [] },
      {
        filePath: "apps/api/plane/bgtasks/workspace_seed_task.py",
        symbols: [{ name: "workspace_seed_task", kind: "function" }]
      },
      { filePath: "packages/i18n/src/locales/en/workspace.json", symbols: [] },
      {
        filePath: "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/states/page.tsx",
        symbols: [{ name: "StatesPage", kind: "function" }]
      },
      {
        filePath: "apps/api/plane/api/middleware/api_authentication.py",
        symbols: [{ name: "APIKeyAuthentication", kind: "class" }]
      },
      {
        filePath: "apps/api/plane/app/middleware/api_authentication.py",
        symbols: [{ name: "APIKeyAuthentication", kind: "class" }]
      },
      {
        filePath: "apps/admin/components/authentication/authentication-method-card.tsx",
        symbols: [{ name: "AuthenticationMethodCard", kind: "function" }]
      },
      {
        filePath: "apps/api/plane/tests/contract/app/test_authentication.py",
        symbols: [{ name: "test_authentication", kind: "function" }]
      },
      {
        filePath: "apps/api/plane/db/migrations/0112_auto_20251124_0603.py",
        symbols: [{ name: "Migration", kind: "class" }]
      },
      { filePath: "apps/api/plane/db/models/issue.py", symbols: [{ name: "Issue", kind: "class" }] },
      { filePath: "apps/api/plane/db/models/state.py", symbols: [{ name: "State", kind: "class" }] }
    ];
    const paths = pickEntryPaths({
      manifest,
      treeOverview: { topLevelDirs: ["apps"], topLevelFiles: ["package.json", "README.md"] },
      userFocus:
        "I'm new to this service and I don't have it cloned. Where does API auth live, how do work items and states flow, and what are the 5 files I should read first?"
    });
    assert.ok(
      paths.some((path) => path.includes("api_authentication.py")),
      `expected api_authentication.py in ${paths.join(", ")}`
    );
    assert.ok(
      paths.some((path) => path.endsWith("issue.py")),
      `expected issue.py in ${paths.join(", ")}`
    );
    assert.ok(
      paths.some((path) => path.endsWith("state.py")),
      `expected state.py in ${paths.join(", ")}`
    );
    assert.ok(!paths.some((path) => /openapi\.py|seeds\/|seed_task|locales\/|i18n\//.test(path)));
    assert.ok(!paths.some((path) => /\/tests?\/|\/migrations?\//.test(path)));
  });

  test("summarizeManifest counts extensions and symbols", () => {
    const stats = summarizeManifest([
      { filePath: "src/a.ts", symbols: [{ name: "foo", kind: "function" }] },
      { filePath: "src/b.ts", symbols: [{ name: "Bar", kind: "class" }] },
      { filePath: "README.md", symbols: [] }
    ]);
    assert.equal(stats.fileCount, 3);
    assert.equal(stats.extensionBreakdown[".ts"], 2);
    assert.equal(stats.extensionBreakdown[".md"], 1);
    assert.ok(stats.topSymbols.length >= 2);
  });

  const total = passed + failed;
  console.log(`\nbuildRepoSummaryContext: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();

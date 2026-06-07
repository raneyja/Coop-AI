import assert from "node:assert/strict";
import { pickEntryPaths, resolveRepoSummaryCoords, summarizeManifest } from "./buildRepoSummaryContext";
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

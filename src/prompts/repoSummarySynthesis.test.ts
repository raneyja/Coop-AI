import assert from "node:assert/strict";
import { buildRepoSummarySynthesisUserPrompt, formatRepoSummaryForPrompt } from "./repoSummarySynthesis";

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

  test("formatRepoSummaryForPrompt includes tree and entry files", () => {
    const text = formatRepoSummaryForPrompt({
      treeOverview: { topLevelDirs: ["src", "docs"], topLevelFiles: ["package.json"] },
      entryFiles: [{ path: "package.json" }, { path: "src/extension.ts" }]
    });
    assert.ok(text.includes("src, docs"));
    assert.ok(text.includes("package.json"));
    assert.ok(text.includes("src/extension.ts"));
  });

  test("buildRepoSummarySynthesisUserPrompt steers away from active file only", () => {
    const prompt = buildRepoSummarySynthesisUserPrompt({
      owner: "raneyja",
      repo: "Coop-AI",
      branch: "main",
      activeFile: "src/server/githubAppApi.ts",
      summary: { entryFiles: [{ path: "package.json" }] },
      userQuestion: "Understand this repository quickly."
    });
    assert.ok(prompt.includes("repository-wide"));
    assert.ok(prompt.includes("not the whole repo"));
    assert.ok(prompt.includes("Do **not** write a deep dive on only the active editor file"));
  });

  const total = passed + failed;
  console.log(`\nrepoSummarySynthesis: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();

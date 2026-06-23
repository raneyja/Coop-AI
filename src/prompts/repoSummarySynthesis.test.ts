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

  test("buildRepoSummarySynthesisUserPrompt requires user callout for out-of-scope @ files", () => {
    const prompt = buildRepoSummarySynthesisUserPrompt({
      owner: "coop-demo-lab",
      repo: "fastify",
      branch: "main",
      activeFile: "fastify.js",
      summary: {
        treeOverview: {
          topLevelDirs: ["lib/", "test/", "docs/"],
          topLevelFiles: ["fastify.js", "package.json"]
        },
        entryFiles: [{ path: "package.json" }, { path: "fastify.js" }]
      },
      mentionedFiles: [
        { path: "src/chat/CoopChatSession.ts", repoId: "github:coop-demo-lab/fastify" },
        { path: "lib/plugin.js", repoId: "github:coop-demo-lab/fastify" }
      ],
      activeRepoId: "github:coop-demo-lab/fastify"
    });
    assert.ok(prompt.includes("Out-of-scope @ attachments"));
    assert.ok(prompt.includes("chat/CoopChatSession.ts"));
    assert.ok(prompt.includes("Required in your response"));
  });

  test("buildRepoSummarySynthesisUserPrompt forbids out-of-scope section when all @ files are in-repo", () => {
    const prompt = buildRepoSummarySynthesisUserPrompt({
      owner: "coop-demo-lab",
      repo: "fastify",
      summary: {
        treeOverview: {
          topLevelDirs: ["lib/", "test/", "docs/"],
          topLevelFiles: ["fastify.js", "package.json"]
        },
        entryFiles: [{ path: "package.json" }, { path: "fastify.js" }]
      },
      mentionedFiles: [{ path: "lib/plugin-utils.js", repoId: "github:coop-demo-lab/fastify" }],
      activeRepoId: "github:coop-demo-lab/fastify"
    });
    assert.ok(prompt.includes("lib/plugin-utils.js"));
    assert.ok(prompt.includes("**Do not** include an **Out-of-scope @ attachments** section"));
    assert.ok(!prompt.includes("Required in your response"));
  });

  test("buildRepoSummarySynthesisUserPrompt includes enterprise onboarding and quick-action links", () => {
    const prompt = buildRepoSummarySynthesisUserPrompt({
      owner: "raneyja",
      repo: "Coop-AI",
      summary: { entryFiles: [{ path: "package.json" }] }
    });
    assert.ok(prompt.includes("enterprise onboarding"));
    assert.ok(prompt.includes("deploy/CI"));
    assert.ok(prompt.includes("**Find Owner**"));
    assert.ok(prompt.includes("**Blast Radius**"));
  });

  const total = passed + failed;
  console.log(`\nrepoSummarySynthesis: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();

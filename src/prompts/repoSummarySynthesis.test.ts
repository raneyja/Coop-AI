import assert from "node:assert/strict";
import {
  buildRepoSummarySynthesisUserPrompt,
  formatActiveFileContextForPrompt,
  formatRepoSummaryForPrompt
} from "./repoSummarySynthesis";

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

  test("buildRepoSummarySynthesisUserPrompt includes active file section when file is open", () => {
    const prompt = buildRepoSummarySynthesisUserPrompt({
      owner: "raneyja",
      repo: "Coop-AI",
      branch: "main",
      activeFile: "src/server/githubAppApi.ts",
      summary: {
        entryFiles: [
          {
            path: "src/server/githubAppApi.ts",
            content: "import { FastifyInstance } from 'fastify';\nexport function registerGithubAppRoutes(app: FastifyInstance) {}"
          }
        ],
        dependencyGraph: {
          entryFile: "src/server/githubAppApi.ts",
          directDependents: ["src/server/index.ts"],
          edgeCount: 12,
          source: "scip"
        },
        relatedOwnership: { owner: "alice", path: "src/server/githubAppApi.ts", completeness: "full" }
      },
      userQuestion: "Understand this repository quickly."
    });
    assert.ok(prompt.includes("repository-wide"));
    assert.ok(prompt.includes("**How the open file fits**"));
    assert.ok(prompt.includes("## Active file context"));
    assert.ok(prompt.includes("Direct dependents"));
    assert.ok(prompt.includes("src/server/index.ts"));
    assert.ok(prompt.includes("Primary: alice"));
    assert.ok(prompt.includes("import { FastifyInstance }"));
    assert.ok(!prompt.includes("Do **not** include **How the open file fits**"));
  });

  test("buildRepoSummarySynthesisUserPrompt omits active file section when repo-wide", () => {
    const prompt = buildRepoSummarySynthesisUserPrompt({
      owner: "raneyja",
      repo: "Coop-AI",
      summary: { entryFiles: [{ path: "package.json" }] }
    });
    assert.ok(prompt.includes("repository-wide"));
    assert.ok(prompt.includes("Do **not** include **How the open file fits**"));
    assert.ok(!prompt.includes("## Active file context"));
  });

  test("formatActiveFileContextForPrompt warns when dependency graph targets another file", () => {
    const text = formatActiveFileContextForPrompt("src/server/githubAppApi.ts", {
      dependencyGraph: {
        entryFile: "package.json",
        directDependents: ["src/extension.ts"]
      }
    });
    assert.ok(text.includes("dependency graph entry is `package.json`"));
    assert.ok(!text.includes("Direct dependents"));
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

  test("buildRepoSummarySynthesisUserPrompt requires attached doc titles and guards supplementary citations", () => {
    const prompt = buildRepoSummarySynthesisUserPrompt({
      owner: "raneyja",
      repo: "Coop-AI",
      summary: {
        entryFiles: [{ path: "package.json" }],
        notion: {
          pages: [{ id: "1", title: "Coop AI — Architecture Overview", url: "https://notion.example/1" }]
        },
        relatedOwnership: { owner: "alice", path: "package.json" },
        dependencyGraph: { edgeCount: 10 }
      }
    });
    assert.ok(prompt.includes("## Attached documentation (required in response)"));
    assert.ok(prompt.includes("Coop AI — Architecture Overview"));
    assert.ok(prompt.includes("## Narrative citation rules"));
    assert.ok(prompt.includes("## Citation guardrails"));
    assert.ok(prompt.includes("[Sources: Ownership signals]"));
    assert.ok(prompt.includes("[Sources: Dependency graph]"));
  });

  const total = passed + failed;
  console.log(`\nrepoSummarySynthesis: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();

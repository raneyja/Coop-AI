import assert from "node:assert/strict";
import type { RepoSummaryEvidence } from "../context/contextBundleEvidence";
import {
  allMentionsOutOfScopeForActiveRepo,
  appendMentionScopePromptSection,
  mentionDisplayPath,
  mentionAttachmentLabel,
  partitionMentionsForOwnership,
  partitionMentionsForQuickAction,
  partitionMentionsForRepoSummary,
  partitionMentionsForTraceDecision,
  pathLikelyInTargetRepo,
  plainChatHistoryContent,
  plainChatRefersToAttachedFile
} from "./mentionScope";

const fastifyTree: RepoSummaryEvidence = {
  treeOverview: {
    topLevelDirs: [".github/", "build/", "docs/", "lib/", "test/", "types/"],
    topLevelFiles: ["fastify.js", "package.json", "README.md"]
  },
  entryFiles: [{ path: "package.json" }, { path: "README.md" }, { path: "fastify.js" }]
};

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

test("pathLikelyInTargetRepo accepts paths under known top-level dirs", () => {
  assert.equal(pathLikelyInTargetRepo("lib/handler.js", fastifyTree), true);
  assert.equal(pathLikelyInTargetRepo("fastify.js", fastifyTree), true);
});

test("pathLikelyInTargetRepo rejects foreign workspace paths", () => {
  assert.equal(pathLikelyInTargetRepo("src/chat/CoopChatSession.ts", fastifyTree), false);
  assert.equal(pathLikelyInTargetRepo("src/prompts/quickActionPrompts.ts", fastifyTree), false);
});

test("partitionMentionsForRepoSummary splits in-repo vs out-of-repo attachments", () => {
  const scope = partitionMentionsForRepoSummary(
    [
      { path: "lib/plugin.js", repoId: "github:coop-demo-lab/fastify" },
      { path: "src/chat/CoopChatSession.ts", repoId: "github:coop-demo-lab/fastify" }
    ],
    fastifyTree,
    "github:coop-demo-lab/fastify"
  );
  assert.equal(scope.inRepo.length, 1);
  assert.equal(scope.outOfRepo.length, 1);
  assert.equal(scope.inRepo[0]?.path, "lib/plugin.js");
  assert.equal(scope.outOfRepo[0]?.path, "src/chat/CoopChatSession.ts");
});

test("pathLikelyInTargetRepo rejects paths when tree overview is missing", () => {
  const summaryWithoutTree: RepoSummaryEvidence = {
    entryFiles: [{ path: "package.json" }]
  };
  assert.equal(pathLikelyInTargetRepo("lib/handler.js", summaryWithoutTree), false);
  assert.equal(pathLikelyInTargetRepo("package.json", summaryWithoutTree), true);
});

test("partitionMentionsForOwnership treats local workspace as out of repo", () => {
  const scope = partitionMentionsForOwnership(
    [
      { path: "src/util.ts", repoId: "github:acme/widgets" },
      { path: "src/webview/CoopChatPanel.tsx", repoId: "workspace:local", source: "local" }
    ],
    { owner: "acme", repo: "widgets" },
    "github:acme/widgets"
  );
  assert.equal(scope.inRepo.length, 1);
  assert.equal(scope.outOfRepo.length, 1);
  assert.equal(scope.outOfRepo[0]?.path, "src/webview/CoopChatPanel.tsx");
});

test("partitionMentionsForOwnership splits by repo id", () => {
  const scope = partitionMentionsForOwnership(
    [
      { path: "src/util.ts", repoId: "github:acme/widgets" },
      { path: "lib/other.ts", repoId: "github:other/project" }
    ],
    { owner: "acme", repo: "widgets" },
    "github:acme/widgets"
  );
  assert.equal(scope.inRepo.length, 1);
  assert.equal(scope.outOfRepo.length, 1);
  assert.equal(scope.inRepo[0]?.path, "src/util.ts");
});

test("partitionMentionsForTraceDecision treats local workspace as out of repo", () => {
  const scope = partitionMentionsForTraceDecision(
    [
      { path: "lib/logger-factory.js", repoId: "github:coop-demo-lab/fastify" },
      {
        path: "src/webview/CoopChatPanel.tsx",
        repoId: "workspace:local",
        source: "local"
      }
    ],
    "github:coop-demo-lab/fastify"
  );
  assert.equal(scope.inRepo.length, 1);
  assert.equal(scope.outOfRepo.length, 1);
  assert.equal(scope.inRepo[0]?.path, "lib/logger-factory.js");
  assert.equal(scope.outOfRepo[0]?.path, "src/webview/CoopChatPanel.tsx");
});

test("mentionDisplayPath keeps parent directory for clarity", () => {
  assert.equal(mentionDisplayPath("src/chat/CoopChatSession.ts"), "chat/CoopChatSession.ts");
});

test("appendMentionScopePromptSection forbids out-of-scope section when all mentions in-repo", () => {
  const lines: string[] = [];
  appendMentionScopePromptSection(lines, {
    targetLabel: "coop-demo-lab/fastify",
    scope: {
      inRepo: [{ path: "lib/plugin-utils.js" }],
      outOfRepo: []
    },
    inScopeInstruction: "may weight these paths",
    excludeFromLabel: "Architecture",
    alternateActionLabel: "Understand Repo"
  });
  const text = lines.join("\n");
  assert.ok(text.includes("**Do not** include an **Out-of-scope @ attachments** section"));
  assert.ok(!text.includes("Required in your response"));
});

test("partitionMentionsForQuickAction routes blast-radius through file-scoped rules", () => {
  const scope = partitionMentionsForQuickAction(
    "blast-radius",
    [
      { path: "lib/logger-factory.js", repoId: "github:coop-demo-lab/fastify" },
      { path: "src/webview/CoopChatPanel.tsx", repoId: "workspace:local", source: "local" }
    ],
    { activeRepoId: "github:coop-demo-lab/fastify" }
  );
  assert.equal(scope.inRepo.length, 1);
  assert.equal(scope.outOfRepo.length, 1);
});

test("partitionMentionsForQuickAction routes understand-repo through tree rules", () => {
  const scope = partitionMentionsForQuickAction(
    "understand-repo",
    [
      { path: "lib/plugin.js", repoId: "github:coop-demo-lab/fastify" },
      { path: "src/chat/CoopChatSession.ts", repoId: "github:coop-demo-lab/fastify" }
    ],
    {
      activeRepoId: "github:coop-demo-lab/fastify",
      repoSummary: fastifyTree
    }
  );
  assert.equal(scope.inRepo.length, 1);
  assert.equal(scope.outOfRepo.length, 1);
});

test("mentionAttachmentLabel marks local workspace files", () => {
  assert.equal(
    mentionAttachmentLabel({
      path: "src/webview/CoopChatPanel.tsx",
      repoId: "workspace:local",
      source: "local"
    }),
    "webview/CoopChatPanel.tsx (local workspace)"
  );
  assert.equal(
    mentionAttachmentLabel({ path: "lib/plugin.js", repoId: "github:coop-demo-lab/fastify" }),
    "lib/plugin.js"
  );
});

test("allMentionsOutOfScopeForActiveRepo is true when every attachment is foreign", () => {
  assert.equal(
    allMentionsOutOfScopeForActiveRepo(
      [{ path: ".dockerignore", repoId: "workspace:local", source: "local" }],
      "github:raneyja/Coop-AI"
    ),
    true
  );
  assert.equal(
    allMentionsOutOfScopeForActiveRepo(
      [
        { path: "src/a.ts", repoId: "github:raneyja/Coop-AI" },
        { path: ".dockerignore", repoId: "workspace:local", source: "local" }
      ],
      "github:raneyja/Coop-AI"
    ),
    false
  );
});

test("plainChatRefersToAttachedFile detects deictic file questions", () => {
  assert.equal(plainChatRefersToAttachedFile("What does this file do in the repo?"), true);
  assert.equal(plainChatRefersToAttachedFile("How is auth handled in this repo?"), false);
});

test("plainChatHistoryContent preserves @ attachments in bubble text", () => {
  const history = plainChatHistoryContent("What does this file do in the repo?", [
    { path: ".dockerignore", repoId: "workspace:local", source: "local" }
  ]);
  assert.ok(history.includes("attached: .dockerignore (local workspace)"));
});

console.log(`\nmentionScope: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

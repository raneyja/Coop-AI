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
  plainChatContextChips,
  plainChatHistoryContent,
  plainChatRefersToAttachedFile,
  historyContentHasScopeChips,
  withContextChipLine
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

test("plainChatHistoryContent adds file/repo/branch chips when includeContextChips is set", () => {
  const history = plainChatHistoryContent(
    "Can you summarize this repo for me in 4 sentences or fewer?",
    [],
    {
      includeContextChips: true,
      context: { owner: "raneyja", repo: "Coop-AI", branch: "main", file: "AGENTS.md" }
    }
  );
  assert.ok(history.startsWith("Can you summarize this repo for me in 4 sentences or fewer?\n"));
  assert.ok(history.includes("file: AGENTS.md"));
  assert.ok(history.includes("repo: raneyja/Coop-AI"));
  assert.ok(history.includes("branch: main"));
});

test("plainChatHistoryContent stamps selection lines next to the file", () => {
  const history = plainChatHistoryContent(
    "/edit rewrite the highlighted lines to be more efficient",
    [],
    {
      includeContextChips: true,
      context: {
        file: "apps/api/plane/api/middleware/api_authentication.py",
        selectedLines: [45, 52],
        owner: "CoopAI-Corp",
        repo: "plane"
      }
    }
  );
  assert.ok(history.includes("selection: L45–52"));
  assert.ok(history.includes("file: apps/api/plane/api/middleware/api_authentication.py"));
  assert.ok(history.includes("repo: CoopAI-Corp/plane"));
});

test("withContextChipLine upgrades a bare /edit history line with selection", () => {
  const stamped = withContextChipLine(
    "/edit rewrite the highlighted lines to be more efficient",
    {
      file: "api_authentication.py",
      selectedLines: [45, 52],
      owner: "CoopAI-Corp",
      repo: "plane"
    }
  );
  assert.equal(
    stamped,
    "/edit rewrite the highlighted lines to be more efficient\nfile: api_authentication.py · selection: L45–52 · repo: CoopAI-Corp/plane"
  );
});

test("withContextChipLine stamps /edit comment ask with L56–61 on state.py", () => {
  const stamped = withContextChipLine(
    "/edit add a one-line comment above the selected function.",
    {
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [56, 61],
      owner: "coop-ai",
      repo: "plane",
      branch: "preview"
    }
  );
  assert.equal(
    stamped,
    "/edit add a one-line comment above the selected function.\nfile: apps/api/plane/db/models/state.py · selection: L56–61 · repo: coop-ai/plane · branch: preview"
  );
});

test("plainChatHistoryContent can omit chips when includeContextChips is false", () => {
  const history = plainChatHistoryContent("Tell me more", [], {
    includeContextChips: false,
    context: { owner: "raneyja", repo: "Coop-AI", branch: "main" }
  });
  assert.equal(history, "Tell me more");
});

test("plainChatHistoryContent stamps repo/branch chips on follow-up messages", () => {
  const history = plainChatHistoryContent("Tell me more", [], {
    includeContextChips: true,
    context: { owner: "CoopAI-Corp", repo: "documenso", branch: "main" }
  });
  assert.equal(
    history,
    "Tell me more\nrepo: CoopAI-Corp/documenso · branch: main"
  );
});

test("withContextChipLine stamps scope onto bare slash history lines", () => {
  const stamped = withContextChipLine("/slack who decided redis", {
    owner: "CoopAI-Corp",
    repo: "plane",
    branch: "preview"
  });
  assert.equal(
    stamped,
    "/slack who decided redis\nrepo: CoopAI-Corp/plane · branch: preview"
  );
});

test("historyContentHasScopeChips detects repo/file footers and ignores attached-only", () => {
  assert.equal(
    historyContentHasScopeChips(
      "How many files?\nrepo: CoopAI-Corp/plane · branch: preview"
    ),
    true
  );
  assert.equal(historyContentHasScopeChips("Tell me more\nattached: AGENTS.md"), false);
  assert.equal(historyContentHasScopeChips("/slack who decided redis"), false);
});

test("plainChatContextChips skips missing file and keeps repo scope", () => {
  const chips = plainChatContextChips({ owner: "raneyja", repo: "Coop-AI", branch: "main" });
  assert.deepEqual(chips, [
    { key: "repo", value: "raneyja/Coop-AI" },
    { key: "branch", value: "main" }
  ]);
});

console.log(`\nmentionScope: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

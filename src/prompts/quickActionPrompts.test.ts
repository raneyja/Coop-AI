import assert from "node:assert/strict";
import {
  appendQuickActionMentionScope,
  formatQuickActionHistoryContent,
  quickActionDisplayText,
  quickActionHistoryContent,
  quickActionModelPrompt,
  quickActionPromptParts
} from "./quickActionPrompts";
import type { RepoContext } from "../chat/types";

const ctx: RepoContext = {
  owner: "acme",
  repo: "widgets",
  branch: "main",
  file: "Dockerfile",
  languageId: "dockerfile",
  provider: "github"
};

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

  test("display text omits format instructions for knowledge-gaps", () => {
    const display = quickActionDisplayText("knowledge-gaps", ctx);
    assert.ok(!display.includes("Open question"));
    assert.ok(!display.includes("subsection"));
    assert.ok(display.includes("Audit documentation"));
    assert.ok(display.includes("file: Dockerfile"));
  });

  test("model prompt includes evidence sources for knowledge-gaps", () => {
    const model = quickActionModelPrompt("knowledge-gaps", ctx);
    assert.ok(model.includes("knowledge_gap_scan"));
    assert.ok(model.includes("Confluence"));
    assert.ok(!model.includes("subsection **Title**"));
  });

  test("history content uses chip line separator", () => {
    const history = formatQuickActionHistoryContent("knowledge-gaps", ctx);
    assert.match(history, /Audit documentation.+\nfile: Dockerfile · branch: main/);
  });

  test("quickActionHistoryContent uses knowledge-gaps tag prefix", () => {
    const history = quickActionHistoryContent("knowledge-gaps", ctx);
    assert.ok(history.startsWith("[knowledge-gaps] "));
    assert.ok(history.includes("Audit documentation"));
  });

  test("quickActionHistoryContent preserves slash args and mentions for knowledge-gaps", () => {
    const history = quickActionHistoryContent("knowledge-gaps", ctx, "focus on auth", [
      { path: "auth/middleware.ts" }
    ]);
    assert.equal(history, "[knowledge-gaps] focus on auth\nattached: auth/middleware.ts");
  });

  test("knowledge-gaps model prompt supports repo-wide scope without file", () => {
    const repoCtx: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      scope: "repo"
    };
    const model = quickActionModelPrompt("knowledge-gaps", repoCtx);
    const display = quickActionDisplayText("knowledge-gaps", repoCtx);
    assert.ok(model.includes("acme/widgets"));
    assert.ok(model.includes("repo-wide blind spots"));
    assert.ok(!model.includes("file none"));
    assert.ok(display.includes("across this repository"));
    assert.ok(display.includes("repo: acme/widgets"));
  });

  test("find-owner model prompt supports repo-wide scope without file", () => {
    const repoCtx: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      scope: "repo"
    };
    const model = quickActionModelPrompt("find-owner", repoCtx);
    const display = quickActionDisplayText("find-owner", repoCtx);
    assert.ok(model.includes("repository-wide ownership"));
    assert.ok(display.includes("Map repository ownership"));
    assert.ok(display.includes("repo: acme/widgets"));
    assert.ok(!display.includes("file:"));
  });

  test("understand-repo model prompt supports repo-wide scope without file", () => {
    const repoCtx: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      scope: "repo"
    };
    const model = quickActionModelPrompt("understand-repo", repoCtx);
    assert.ok(model.includes("acme/widgets"));
    assert.ok(!model.includes("active file none"));
    assert.ok(!/Context:.*active file/.test(model));
  });

  test("understand-repo model prompt steers repo-wide", () => {
    const model = quickActionModelPrompt("understand-repo", ctx);
    assert.ok(model.includes("repo-wide"));
    assert.ok(model.includes("acme/widgets"));
  });

  test("trace-decision model prompt references integration evidence", () => {
    const model = quickActionModelPrompt("trace-decision", {
      ...ctx,
      selectedLines: [10, 20]
    });
    assert.ok(model.includes("Slack"));
    assert.ok(model.includes("Teams"));
    assert.ok(model.includes("lines 10-20"));
  });

  test("trace-decision history content uses unified bubble format", () => {
    const history = quickActionHistoryContent("trace-decision", {
      ...ctx,
      selectedLines: [10, 20]
    });
    assert.ok(history.startsWith("[trace-decision] "));
    assert.ok(history.includes("Trace the engineering decision"));
    assert.ok(history.includes("file: Dockerfile"));
    assert.ok(history.includes("lines: 10-20"));
  });

  test("trace-decision slash args preserved in history bubble", () => {
    assert.equal(
      quickActionHistoryContent("trace-decision", ctx, "why was retry added"),
      "[trace-decision] why was retry added"
    );
  });

  test("trace-decision model prompt handles out-of-scope @ attachments", () => {
    const model = quickActionModelPrompt("trace-decision", ctx, [
      { path: "src/webview/CoopChatPanel.tsx", repoId: "workspace:local", source: "local" }
    ]);
    assert.ok(model.includes("primary open file"));
    assert.ok(model.includes("local workspace"));
    assert.ok(model.includes("Do NOT attribute timeline commits"));
  });

  test("find-owner model prompt references identity links", () => {
    const model = quickActionModelPrompt("find-owner", ctx);
    assert.ok(model.includes("identity links"));
  });

  test("find-owner history content matches grid button format", () => {
    const history = quickActionHistoryContent("find-owner", ctx);
    assert.ok(history.startsWith("[find-owner] "));
    assert.ok(history.includes("Find who owns this area"));
    assert.ok(history.includes("file: Dockerfile"));
  });

  test("find-owner model prompt handles out-of-scope @ attachments", () => {
    const model = quickActionModelPrompt("find-owner", ctx, [{ path: "other/repo/file.ts" }]);
    assert.ok(model.includes("<mentioned_files>"));
    assert.ok(model.includes("do NOT attribute"));
  });

  test("blast-radius model prompt prioritizes top ranked risk surfaces", () => {
    const model = quickActionModelPrompt("blast-radius", ctx);
    assert.ok(model.includes("top 5 ranked risk surfaces"));
    assert.ok(model.includes("do not enumerate every dependent"));
    assert.ok(model.includes("dependency graph"));
    assert.ok(model.includes("operational risk"));
  });

  test("understand-repo repo-wide model prompt defers cross-action pointer to the synthesis closer", () => {
    const repoCtx: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      scope: "repo"
    };
    const model = quickActionModelPrompt("understand-repo", repoCtx);
    // The cross-action pointer is owned once by the repo-summary synthesis closer, not duplicated here.
    assert.ok(!model.includes("Trace Decision for decision history"));
  });

  test("find-owner repo-wide model prompt suggests cross-actions", () => {
    const repoCtx: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      scope: "repo"
    };
    const model = quickActionModelPrompt("find-owner", repoCtx);
    assert.ok(model.includes("Trace Decision"));
    assert.ok(model.includes("Understand Repo"));
    assert.ok(model.includes("Blast Radius"));
  });

  test("blast-radius history includes branch chip", () => {
    const history = quickActionHistoryContent("blast-radius", ctx);
    assert.ok(history.includes("branch: main"));
  });

  test("appendQuickActionMentionScope adds blast-radius guidance", () => {
    const text = appendQuickActionMentionScope("blast-radius", "include API clients", ctx, [
      { path: "api/client.ts" }
    ]);
    assert.ok(text.startsWith("include API clients"));
    assert.ok(text.includes("blast surfaces"));
    assert.ok(text.includes("client.ts"));
  });

  test("quickActionHistoryContent matches grid button format", () => {
    const history = quickActionHistoryContent("understand-repo", ctx);
    assert.ok(history.startsWith("[understand-repo] "));
    assert.ok(history.includes("Understand this repository"));
    assert.ok(history.includes("repo: acme/widgets"));
  });

  test("quickActionHistoryContent preserves user args after slash command", () => {
    assert.equal(
      quickActionHistoryContent("understand-repo", ctx, "focus on plugins"),
      "[understand-repo] focus on plugins"
    );
  });

  test("quickActionHistoryContent shows attached files in bubble chips", () => {
    const history = quickActionHistoryContent("blast-radius", ctx, undefined, [
      { path: "src/risk/policy.yaml" },
      { path: "pkg/handler.go" }
    ]);
    assert.ok(history.includes("attached: risk/policy.yaml, pkg/handler.go"));
  });

  test("quickActionHistoryContent shows attached files with slash args", () => {
    const history = quickActionHistoryContent("understand-repo", ctx, "focus on plugins", [
      { path: "lib/plugins/index.js" }
    ]);
    assert.equal(history, "[understand-repo] focus on plugins\nattached: plugins/index.js");
  });

  test("quickActionHistoryContent labels local workspace attachments", () => {
    const history = quickActionHistoryContent("understand-repo", ctx, undefined, [
      { path: "test/plugin.1.test.js", repoId: "github:coop-demo-lab/fastify" },
      { path: "src/webview/CoopChatPanel.tsx", repoId: "workspace:local", source: "local" }
    ]);
    assert.ok(history.includes("attached:"));
    assert.ok(history.includes("plugin.1.test.js"));
    assert.ok(history.includes("CoopChatPanel.tsx (local workspace)"));
  });

  test("understand-repo model prompt excludes foreign paths from target repo architecture", () => {
    const model = quickActionModelPrompt("understand-repo", ctx, [{ path: "lib/plugins/index.js" }]);
    assert.ok(model.includes("<mentioned_files>"));
    assert.ok(model.includes("plugins/index.js"));
    assert.ok(model.includes("do NOT describe it under Architecture"));
  });

  test("appendQuickActionMentionScope adds guidance to slash args", () => {
    const text = appendQuickActionMentionScope("knowledge-gaps", "focus on auth", ctx, [
      { path: "auth/middleware.ts" }
    ]);
    assert.ok(text.startsWith("focus on auth"));
    assert.ok(text.includes("<mentioned_files>"));
    assert.ok(text.includes("middleware.ts"));
  });

  test("display and model differ for all actions", () => {
    const actions = [
      "understand-repo",
      "trace-decision",
      "find-owner",
      "blast-radius",
      "knowledge-gaps"
    ] as const;
    for (const actionId of actions) {
      const parts = quickActionPromptParts(actionId, ctx);
      assert.notEqual(parts.display, parts.model);
      assert.ok(parts.chips.length > 0);
    }
  });

  const total = passed + failed;
  console.log(`\nquickActionPrompts: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();

import assert from "node:assert/strict";
import {
  formatQuickActionHistoryContent,
  quickActionDisplayText,
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

  test("find-owner model prompt references identity links", () => {
    const model = quickActionModelPrompt("find-owner", ctx);
    assert.ok(model.includes("identity links"));
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

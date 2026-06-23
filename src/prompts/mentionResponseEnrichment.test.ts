import assert from "node:assert/strict";
import {
  buildOutOfScopeMentionOnlyResponse,
  enrichOutOfScopeMentionsInResponse,
  resolveOutOfScopeMentionLabels
} from "./mentionResponseEnrichment";

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

test("resolveOutOfScopeMentionLabels flags foreign repo for plain chat", () => {
  const labels = resolveOutOfScopeMentionLabels(
    undefined,
    [
      { path: "lib/plugin.js", repoId: "github:coop-demo-lab/fastify" },
      { path: "src/other.ts", repoId: "github:other/project" }
    ],
    { activeRepoId: "github:coop-demo-lab/fastify" }
  );
  assert.deepEqual(labels, ["src/other.ts"]);
});

test("resolveOutOfScopeMentionLabels flags local workspace for trace-decision", () => {
  const labels = resolveOutOfScopeMentionLabels(
    "trace-decision",
    [{ path: "src/webview/CoopChatPanel.tsx", repoId: "workspace:local", source: "local" }],
    { activeRepoId: "github:coop-demo-lab/fastify" }
  );
  assert.deepEqual(labels, ["webview/CoopChatPanel.tsx (local workspace)"]);
});

test("enrichOutOfScopeMentionsInResponse inserts section before Sources", () => {
  const input = [
    "**Summary**",
    "Trace for fastify.js.",
    "",
    "**Gaps**",
    "Thin evidence.",
    "",
    "**Sources**",
    "- [Sources: GitHub commit dd2bb73] — commit details"
  ].join("\n");

  const enriched = enrichOutOfScopeMentionsInResponse(input, {
    action: "trace-decision",
    outOfScopePaths: ["src/CoopChatPanel.ts (local workspace)"],
    targetLabel: "coop-demo-lab/fastify"
  });

  assert.ok(enriched.includes("**Out-of-scope @ attachments**"));
  assert.ok(enriched.includes("src/CoopChatPanel.ts (local workspace)"));
  assert.ok(enriched.includes("outside coop-demo-lab/fastify"));
  assert.ok(enriched.indexOf("**Out-of-scope @ attachments**") < enriched.indexOf("**Sources**"));
});

test("enrichOutOfScopeMentionsInResponse is idempotent when section exists", () => {
  const input = "**Out-of-scope @ attachments**\n- already there\n\n**Sources**\n- item";
  const enriched = enrichOutOfScopeMentionsInResponse(input, {
    action: "trace-decision",
    outOfScopePaths: ["other.ts (local workspace)"],
    targetLabel: "coop-demo-lab/fastify"
  });
  assert.equal(enriched, input);
});

test("buildOutOfScopeMentionOnlyResponse explains foreign attachments without analyzing active file", () => {
  const response = buildOutOfScopeMentionOnlyResponse({
    outOfScopePaths: [".dockerignore (local workspace)"],
    targetLabel: "raneyja/Coop-AI"
  });
  assert.ok(response.includes("outside the active repository"));
  assert.ok(response.includes(".dockerignore (local workspace)"));
  assert.ok(!response.includes("CoopSettingsPanel"));
});

console.log(`\nmentionResponseEnrichment: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

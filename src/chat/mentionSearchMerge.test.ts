import assert from "node:assert/strict";
import {
  WORKSPACE_LOCAL_REPO_ID,
  dedupeHybridMentionResults,
  localPathsToMentionResults,
  mergeHybridMentionSearchResults,
  preferMentionFileContent,
  resolveMentionFileContent,
  rankMentionSearchResults
} from "./mentionSearchMerge";
import type { MentionSearchResult } from "./types";

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

test("dedupeHybridMentionResults prefers local over indexed for the same path", () => {
  const items: MentionSearchResult[] = [
    { repoId: "github:coop-demo-lab/fastify", path: "lib/plugin.js", source: "indexed", score: 90 },
    { repoId: WORKSPACE_LOCAL_REPO_ID, path: "lib/plugin.js", source: "local" }
  ];
  const deduped = dedupeHybridMentionResults(items);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.repoId, WORKSPACE_LOCAL_REPO_ID);
  assert.equal(deduped[0]?.source, "local");
});

test("dedupeHybridMentionResults prefers active repo indexed over local when preferRepoId set", () => {
  const preferRepoId = "github:raneyja/Coop-AI";
  const items: MentionSearchResult[] = [
    { repoId: WORKSPACE_LOCAL_REPO_ID, path: ".dockerignore", source: "local" },
    { repoId: preferRepoId, path: ".dockerignore", source: "indexed", score: 40 }
  ];
  const deduped = dedupeHybridMentionResults(items, { preferRepoId });
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.repoId, preferRepoId);
  assert.equal(deduped[0]?.source, "indexed");
});

test("localPathsToMentionResults tags active repo when preferRepoId is set", () => {
  const items = localPathsToMentionResults([".dockerignore"], {
    preferRepoId: "github:raneyja/Coop-AI"
  });
  assert.equal(items[0]?.repoId, "github:raneyja/Coop-AI");
  assert.equal(items[0]?.source, "indexed");
});

test("mergeHybridMentionSearchResults combines graph and local hits then caps at 12", () => {
  const graphItems: MentionSearchResult[] = Array.from({ length: 10 }, (_, index) => ({
    repoId: "github:coop-demo-lab/fastify",
    path: `lib/plugin-${index}.js`,
    source: "indexed" as const,
    score: 50
  }));
  const localItems: MentionSearchResult[] = Array.from({ length: 10 }, (_, index) => ({
    repoId: WORKSPACE_LOCAL_REPO_ID,
    path: `src/chat/File-${index}.ts`,
    source: "local" as const
  }));
  const merged = mergeHybridMentionSearchResults(graphItems, localItems, "plugin");
  assert.equal(merged.length, 12);
  assert.ok(merged.some((item) => item.source === "indexed"));
  assert.ok(merged.some((item) => item.source === "local"));
});

test("rankMentionSearchResults surfaces exact basename matches", () => {
  const items: MentionSearchResult[] = [
    { repoId: WORKSPACE_LOCAL_REPO_ID, path: "src/chat/CoopChatSession.ts", source: "local" },
    { repoId: "github:coop-demo-lab/fastify", path: "lib/other.ts", source: "indexed" }
  ];
  const ranked = rankMentionSearchResults(items, "CoopChatSession");
  assert.equal(ranked[0]?.path, "src/chat/CoopChatSession.ts");
});

test("preferMentionFileContent keeps local-first for legacy callers", () => {
  assert.equal(
    preferMentionFileContent("local wip", "indexed remote", "snippet"),
    "local wip"
  );
  assert.equal(preferMentionFileContent(undefined, "indexed remote", "snippet"), "snippet");
  assert.equal(preferMentionFileContent(undefined, undefined, "snippet"), "snippet");
  assert.equal(preferMentionFileContent("", "", ""), "");
});

test("resolveMentionFileContent never mixes local clone into remote mentions", () => {
  assert.equal(
    resolveMentionFileContent({
      prefer: "remote",
      localContent: "local clone wip",
      remoteContent: "codehost content",
      existingSnippet: "snip"
    }),
    "codehost content"
  );
  assert.equal(
    resolveMentionFileContent({
      prefer: "remote",
      localContent: "local clone wip",
      remoteContent: undefined,
      existingSnippet: "snip"
    }),
    "snip"
  );
  assert.equal(
    resolveMentionFileContent({
      prefer: "local",
      localContent: "disk",
      remoteContent: "codehost",
      existingSnippet: "snip"
    }),
    "disk"
  );
  assert.equal(
    resolveMentionFileContent({
      prefer: "local",
      localContent: undefined,
      remoteContent: "codehost",
      existingSnippet: "snip"
    }),
    "snip"
  );
});

console.log(`\nmentionSearchMerge: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import {
  mentionKey,
  reconcileMentionsAfterEditorSnap,
  shortMentionSourceLabel
} from "./activeFileMention";

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

test("shortMentionSourceLabel distinguishes local vs remote", () => {
  assert.equal(
    shortMentionSourceLabel({
      path: "src/a.ts",
      repoId: "workspace:local",
      source: "local"
    }),
    "Local Workspace"
  );
  assert.equal(
    shortMentionSourceLabel({
      path: "src/a.ts",
      repoId: "github:raneyja/Coop-AI",
      source: "indexed"
    }),
    "raneyja/Coop-AI"
  );
});

test("reconcileMentionsAfterEditorSnap drops previous file without seeding live file", () => {
  const stale = {
    path: "src/CoopSettingsPanel.ts",
    repoId: "github:raneyja/Coop-AI",
    source: "indexed" as const
  };
  const extra = {
    path: "src/other.ts",
    repoId: "github:raneyja/Coop-AI",
    source: "indexed" as const
  };
  const reconciled = reconcileMentionsAfterEditorSnap(
    [stale, extra],
    "src/CoopSettingsPanel.ts",
    {
      file: "src/CoopSidebarProvider.ts",
      fileSource: "remote",
      owner: "raneyja",
      repo: "Coop-AI",
      provider: "github"
    }
  );
  assert.ok(reconciled);
  assert.deepEqual(reconciled!.map(mentionKey), [mentionKey(extra)]);
  assert.ok(!reconciled!.some((entry) => entry.path === "src/CoopSidebarProvider.ts"));
});

test("reconcileMentionsAfterEditorSnap keeps mentions when editor file unchanged", () => {
  const mention = {
    path: "src/a.ts",
    repoId: "workspace:local",
    source: "local" as const
  };
  const reconciled = reconcileMentionsAfterEditorSnap([mention], "src/a.ts", {
    file: "src/a.ts",
    fileSource: "workspace"
  });
  assert.deepEqual(reconciled, [mention]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

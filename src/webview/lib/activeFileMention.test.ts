import assert from "node:assert/strict";
import {
  mentionFromActiveFile,
  mentionKey,
  shortMentionSourceLabel,
  syncActiveFileMention
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

test("mentionFromActiveFile builds indexed remote mention", () => {
  const mention = mentionFromActiveFile({
    file: "src/CoopSettingsPanel.ts",
    fileSource: "remote",
    owner: "raneyja",
    repo: "Coop-AI",
    provider: "github"
  });
  assert.deepEqual(mention, {
    path: "src/CoopSettingsPanel.ts",
    repoId: "github:raneyja/Coop-AI",
    source: "indexed"
  });
  assert.equal(shortMentionSourceLabel(mention!), "raneyja/Coop-AI");
});

test("mentionFromActiveFile builds local mention when not remote", () => {
  const mention = mentionFromActiveFile({
    file: "src/a.ts",
    fileSource: "workspace"
  });
  assert.equal(mention?.source, "local");
  assert.equal(mention?.repoId, "workspace:local");
  assert.equal(shortMentionSourceLabel(mention!), "Local Workspace");
});

test("mentionFromActiveFile skips external", () => {
  assert.equal(
    mentionFromActiveFile({ file: "a.ts", fileSource: "external" }),
    undefined
  );
});

test("syncActiveFileMention replaces previous auto and same-path local dupes", () => {
  const previous = {
    path: "src/old.ts",
    repoId: "workspace:local",
    source: "local" as const
  };
  const auto = {
    path: "src/CoopSettingsPanel.ts",
    repoId: "github:raneyja/Coop-AI",
    source: "indexed" as const
  };
  const user = {
    path: "src/other.ts",
    repoId: "github:raneyja/Coop-AI",
    source: "indexed" as const
  };
  const localDupe = {
    path: "src/CoopSettingsPanel.ts",
    repoId: "workspace:local",
    source: "local" as const
  };

  const synced = syncActiveFileMention(
    [previous, localDupe, user],
    auto,
    mentionKey(previous)
  );
  assert.deepEqual(synced.map(mentionKey), [mentionKey(auto), mentionKey(user)]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

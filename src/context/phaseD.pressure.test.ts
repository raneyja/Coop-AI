import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  INSTRUCTION_TRUNCATE_NOTE,
  MAX_INSTRUCTION_FILE_CHARS,
  PROJECT_INSTRUCTIONS_SILENCE_NOTE
} from "./projectInstructionsLoader";
import { clearProjectInstructionsCache } from "./projectInstructionsCache";
import { buildProjectInstructionsPromptBlock } from "./projectInstructionsPrompt";
import { createVisibleMemoryFact, formatVisibleMemoryBlock, sourcedMemoryFacts } from "./visibleMemory";

let passed = 0;
let failed = 0;
const queue: Array<() => Promise<void>> = [];

function test(name: string, fn: () => void | Promise<void>): void {
  queue.push(async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  });
}

test("D-P1 missing AGENTS.md — chat still works, no fake instructions", async () => {
  clearProjectInstructionsCache();
  const block = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main", version: "missing" },
    remainingGatherMs: 2_000,
    readRemoteFile: async () => undefined
  });
  assert.equal(block, undefined);
});

test("D-P2 huge AGENTS.md is truncated with an internal note", async () => {
  clearProjectInstructionsCache();
  const block = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main", version: "huge" },
    remainingGatherMs: 2_000,
    readRemoteFile: async () => "Z".repeat(MAX_INSTRUCTION_FILE_CHARS + 4_000)
  });
  assert.ok(block?.includes(INSTRUCTION_TRUNCATE_NOTE));
  assert.ok((block?.length ?? 0) < MAX_INSTRUCTION_FILE_CHARS + 2_000);
  assert.equal(/please wait|loading AGENTS/i.test(block ?? ""), false);
});

test("D-P3 switching Use-repo drops the previous repo instructions", async () => {
  clearProjectInstructionsCache();
  const files: Record<string, string> = {
    "github:acme/plane": "Plane agents only.",
    "github:acme/other": "Other repo agents."
  };
  const plane = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main", version: "main" },
    remainingGatherMs: 2_000,
    readRemoteFile: async () => files["github:acme/plane"]
  });
  const other = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/other", branch: "main", version: "main" },
    remainingGatherMs: 2_000,
    readRemoteFile: async () => files["github:acme/other"]
  });
  assert.ok(plane?.includes("Plane agents only."));
  assert.ok(other?.includes("Other repo agents."));
  assert.equal(other?.includes("Plane agents only."), false);
});

test("D-P4 Coop-AI local AGENTS.md is not injected when Use-repo is other", async () => {
  clearProjectInstructionsCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-phase-d-"));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "AGENTS.md"), "Coop-AI local folder rules — do not leak.");
    const block = await buildProjectInstructionsPromptBlock({
      enabled: true,
      useRepo: { repoId: "github:acme/plane", branch: "preview", version: "preview" },
      localGitRoot: root,
      remainingGatherMs: 2_000,
      readRemoteFile: async () => "Plane remote AGENTS.md"
    });
    assert.ok(block?.includes("Plane remote AGENTS.md"));
    assert.equal(block?.includes("Coop-AI local folder rules"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("D-P5 unsourced memory is not injected", () => {
  const unsourced = {
    id: "x",
    text: "Black-box guess",
    source: "",
    createdAt: 1
  };
  const otherRepo = createVisibleMemoryFact({
    text: "Other repo fact",
    source: "wiki",
    repoId: "github:acme/other"
  });
  assert.ok(otherRepo);
  const injected = sourcedMemoryFacts([unsourced, otherRepo], "github:acme/plane");
  assert.deepEqual(injected, []);
  assert.equal(formatVisibleMemoryBlock(injected), "");
});

test("D-P6 ordinary plain chat with AGENTS.md has no new banner/chip/activity row", async () => {
  clearProjectInstructionsCache();
  const block = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main", version: "ux" },
    remainingGatherMs: 2_000,
    readRemoteFile: async () => "Be concise."
  });
  assert.ok(block?.includes("Be concise."));
  assert.ok(block?.includes(PROJECT_INSTRUCTIONS_SILENCE_NOTE));
  const userFacing = (block ?? "")
    .split("\n")
    .filter((line) => !line.includes("INTERNAL:"))
    .join("\n");
  assert.equal(/Sources chip|activity row|chat banner/i.test(userFacing), false);
  const chatPanel = fs.readFileSync(path.join(__dirname, "../webview/ChatPanel.tsx"), "utf8");
  assert.equal(/visibleMemory|Saved facts|memory chip/i.test(chatPanel), false);
});

test("D-P gather miss with no budget does not invent instructions", async () => {
  clearProjectInstructionsCache();
  let reads = 0;
  const block = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/fresh", branch: "main", version: "fresh" },
    remainingGatherMs: 0,
    readRemoteFile: async () => {
      reads += 1;
      return "Should not fetch.";
    }
  });
  assert.equal(block, undefined);
  assert.equal(reads, 0);
});

test("D-P7 no Use-repo does not inject open-folder AGENTS.md", async () => {
  clearProjectInstructionsCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-phase-d-local-"));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "AGENTS.md"), "Coop-AI local folder rules — do not leak.");
    const block = await buildProjectInstructionsPromptBlock({
      enabled: true,
      localGitRoot: root,
      remainingGatherMs: 2_000
    });
    assert.equal(block, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("D-P8 no Use-repo injects only a user-attached AGENTS.md", async () => {
  clearProjectInstructionsCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-phase-d-attach-"));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "AGENTS.md"), "Coop-AI local folder rules — do not leak.");
    const attached = path.join(root, "my-guide.md");
    fs.writeFileSync(attached, "My starter AGENTS.md for this account.");
    const block = await buildProjectInstructionsPromptBlock({
      enabled: true,
      localGitRoot: root,
      attachedAgentsMdPath: attached,
      remainingGatherMs: 2_000
    });
    assert.ok(block?.includes("My starter AGENTS.md for this account."));
    assert.equal(block?.includes("Coop-AI local folder rules"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("D-P9 Use-repo does not fall back to another account's attached AGENTS.md", async () => {
  clearProjectInstructionsCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-phase-d-account-"));
  try {
    fs.mkdirSync(path.join(root, ".git"));
    const attached = path.join(root, "other-user.md");
    fs.writeFileSync(attached, "Previous account leftover — do not leak.");
    const block = await buildProjectInstructionsPromptBlock({
      enabled: true,
      useRepo: { repoId: "github:acme/plane", branch: "main", version: "main" },
      localGitRoot: root,
      attachedAgentsMdPath: attached,
      remainingGatherMs: 2_000,
      readRemoteFile: async () => undefined
    });
    assert.equal(block, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

void (async () => {
  for (const item of queue) {
    await item();
  }
  console.log(`\nphaseD.pressure: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
})();

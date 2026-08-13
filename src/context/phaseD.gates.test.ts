import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_USER_FACING_RESPONSE_MS, remainingContextGatherBudgetMs } from "../config/responseDeadline";
import {
  INSTRUCTION_TRUNCATE_NOTE,
  MAX_INSTRUCTION_FILE_CHARS,
  PROJECT_INSTRUCTIONS_INJECTION_MODE,
  PROJECT_INSTRUCTIONS_SILENCE_NOTE,
  REMOTE_TEAM_INSTRUCTION_PATHS,
  capInstructionContent
} from "./projectInstructionsLoader";
import { clearProjectInstructionsCache } from "./projectInstructionsCache";
import { buildProjectInstructionsPromptBlock } from "./projectInstructionsPrompt";
import { createVisibleMemoryFact, sourcedMemoryFacts } from "./visibleMemory";

let passed = 0;
let failed = 0;

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

const queue: Array<() => Promise<void>> = [];

function looksLikeChatChrome(text: string): boolean {
  return /sources chip|activity row|loaded AGENTS\.md/i.test(text) && !text.includes("INTERNAL:");
}

test("D-G1 remote Use-repo without clone injects root AGENTS.md", async () => {
  clearProjectInstructionsCache();
  let readPaths: string[] = [];
  const block = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main", version: "main" },
    localGitRoot: "/Users/jonraney/Coop-AI",
    remainingGatherMs: 4_000,
    readRemoteFile: async (filePath) => {
      readPaths.push(filePath);
      if (filePath === "AGENTS.md") {
        return "Use-repo: prefer indexed APIs.";
      }
      return undefined;
    }
  });
  assert.ok(block?.includes("Use-repo: prefer indexed APIs."));
  assert.ok(block?.includes("<project_instructions>"));
  assert.deepEqual(readPaths, ["AGENTS.md"]);
  assert.ok(REMOTE_TEAM_INSTRUCTION_PATHS.includes("AGENTS.md"));
});

test("D-G2 token cap truncates in the prompt, not a banner", () => {
  const huge = "A".repeat(MAX_INSTRUCTION_FILE_CHARS + 800);
  const capped = capInstructionContent(huge);
  assert.equal(capped.truncated, true);
  assert.ok(capped.content.length < huge.length);
  assert.ok(capped.content.includes(INSTRUCTION_TRUNCATE_NOTE));
  assert.equal(looksLikeChatChrome(capped.content), false);
  assert.equal(MAX_INSTRUCTION_FILE_CHARS, 12_000);
});

test("D-G3 memory facts are sourced and Settings-clearable, not chat chrome", () => {
  const sourced = createVisibleMemoryFact({
    text: "Payments live in apps/api",
    source: "AGENTS.md",
    repoId: "github:acme/plane"
  });
  const unsourced = createVisibleMemoryFact({ text: "Secret guess", source: "   " });
  assert.ok(sourced);
  assert.equal(unsourced, undefined);
  const injected = sourcedMemoryFacts([sourced], "github:acme/plane");
  assert.equal(injected.length, 1);
  const settingsUi = fs.readFileSync(
    path.join(__dirname, "../webview/components/settings/SettingsDetailViews.tsx"),
    "utf8"
  );
  assert.match(settingsUi, /Saved facts/);
  assert.match(settingsUi, /onClearVisibleMemory/);
  assert.match(settingsUi, /never appear as a chat banner/);
});

test("D-G4 cache or remaining gather budget — no extra 15s fetch", async () => {
  clearProjectInstructionsCache();
  let reads = 0;
  const readRemoteFile = async (): Promise<string> => {
    reads += 1;
    return "Cached agents rules.";
  };
  const first = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main", version: "main" },
    remainingGatherMs: 3_000,
    readRemoteFile
  });
  const second = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main", version: "main" },
    remainingGatherMs: 0,
    readRemoteFile
  });
  assert.ok(first?.includes("Cached agents rules."));
  assert.ok(second?.includes("Cached agents rules."));
  assert.equal(reads, 1);
  assert.ok(remainingContextGatherBudgetMs(Date.now()) <= MAX_USER_FACING_RESPONSE_MS);
  assert.ok(MAX_USER_FACING_RESPONSE_MS === 15_000);
});

test("D-G6 UX-G6 prompt is silent — no AGENTS.md chip/banner/activity", async () => {
  clearProjectInstructionsCache();
  const block = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: { repoId: "github:acme/plane", branch: "main" },
    remainingGatherMs: 2_000,
    readRemoteFile: async () => "Follow repo conventions.",
    memoryFacts: [
      {
        id: "1",
        text: "API owns auth",
        source: "team handbook",
        repoId: "github:acme/plane",
        createdAt: 1
      }
    ]
  });
  assert.ok(block?.includes(PROJECT_INSTRUCTIONS_SILENCE_NOTE));
  const userFacing = (block ?? "")
    .split("\n")
    .filter((line) => !line.includes("INTERNAL:"))
    .join("\n");
  assert.equal(/Sources chip|activity row|chat banner/i.test(userFacing), false);
  const activity = fs.readFileSync(path.join(__dirname, "../webview/agentActivity.ts"), "utf8");
  assert.equal(/AGENTS\.md/.test(activity), false);
  assert.equal(PROJECT_INSTRUCTIONS_INJECTION_MODE, "always-on");
  const promptLibrary = fs.readFileSync(path.join(__dirname, "../prompts/workspacePromptLibrary.ts"), "utf8");
  assert.match(promptLibrary, /PROMPT_LIBRARY_INJECTION_MODE = "opt-in"/);
});

void (async () => {
  for (const item of queue) {
    await item();
  }
  console.log(`\nphaseD.gates: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
})();

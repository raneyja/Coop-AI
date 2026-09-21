import assert from "node:assert/strict";
import { buildProjectInstructionsPromptBlock } from "./projectInstructionsPrompt";
import { clearProjectInstructionsCache } from "./projectInstructionsCache";
import { shouldPromptForAgentsMd } from "../webview/lib/agentsMdStatus";
import {
  applyFileAssistantIntentPlan,
  autocompleteAllowsGraph,
  completionRequestsGraphContext,
  contextAfterRemoteProvenance,
  decideExplicitEditorChip,
  documentIsFileAssistant,
  isFileAssistantSession,
  projectInstructionsSourcesForTurn,
  sessionModeForContext
} from "./sessionMode";
import { emptyChatIntentPlan } from "../chat/intentPlanner/types";
import type { ChatIntentPlan } from "../chat/intentPlanner/types";
import type { RepoContext } from "../chat/types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };
  queue.push(run);
}

const queue: Array<() => Promise<void>> = [];

const SQL = "migrations/010_users_identity_audit.sql";

test("detector table: Explorer, Ctrl+O git, external, untitled, R, same-path clone, Use-repo", () => {
  const cases: Array<{ name: string; ctx: RepoContext; assistant: boolean }> = [
    { name: "explorer", ctx: { file: SQL, fileSource: "workspace", scope: "file" }, assistant: true },
    { name: "git", ctx: { file: "src/foo.ts", fileSource: "git", scope: "file" }, assistant: true },
    {
      name: "external",
      ctx: { file: "/Users/jonraney/Downloads/notes.sql", fileSource: "external" },
      assistant: true
    },
    { name: "untitled", ctx: { file: "Untitled-1", fileSource: "external" }, assistant: true },
    { name: "remote", ctx: { file: "src/foo.ts", fileSource: "remote", scope: "file" }, assistant: false },
    {
      name: "use-repo-no-file",
      ctx: { owner: "acme", repo: "plane", scope: "repo" },
      assistant: false
    }
  ];
  for (const entry of cases) {
    assert.equal(isFileAssistantSession(entry.ctx), entry.assistant, entry.name);
    assert.equal(
      sessionModeForContext(entry.ctx),
      entry.assistant ? "file-assistant" : "indexed-repo",
      entry.name
    );
  }

  const kept = contextAfterRemoteProvenance(
    { file: "src/foo.ts", fileSource: "remote" },
    { file: "src/foo.ts", fileSource: "workspace" }
  );
  assert.equal(kept.fileSource, "remote");
  assert.equal(isFileAssistantSession(kept), false);

  const switched = contextAfterRemoteProvenance(
    { file: "src/foo.ts", fileSource: "remote" },
    { file: SQL, fileSource: "workspace" }
  );
  assert.equal(switched.fileSource, "workspace");
  assert.equal(isFileAssistantSession(switched), true);
});

test("Hard rule A: explicit focus after New Chat chips; init with snap off does not", () => {
  assert.equal(
    decideExplicitEditorChip({
      userActivatedEditor: true,
      incomingFile: SQL,
      incomingFileSource: "workspace",
      currentFile: undefined,
      currentIsRemote: false
    }),
    "chip-local"
  );
  assert.equal(
    decideExplicitEditorChip({
      userActivatedEditor: false,
      incomingFile: SQL,
      incomingFileSource: "workspace",
      currentFile: undefined,
      currentIsRemote: false
    }),
    "ignore"
  );
  assert.equal(
    decideExplicitEditorChip({
      userActivatedEditor: true,
      incomingFile: SQL,
      incomingFileSource: "git",
      currentFile: "src/foo.ts",
      currentIsRemote: true
    }),
    "chip-local"
  );
});

test("Hard rule B: same-path clone stays R and can use graph; a different local file does not", () => {
  assert.equal(
    decideExplicitEditorChip({
      userActivatedEditor: true,
      incomingFile: "src/foo.ts",
      incomingFileSource: "workspace",
      currentFile: "src/foo.ts",
      currentIsRemote: true
    }),
    "keep-remote"
  );
  assert.equal(
    documentIsFileAssistant({
      file: "src/foo.ts",
      fileSource: "workspace",
      remotePinFile: "src/foo.ts"
    }),
    false
  );
  assert.equal(
    autocompleteAllowsGraph({
      file: "src/foo.ts",
      fileSource: "workspace",
      remotePinFile: "src/foo.ts"
    }),
    true
  );
  assert.equal(
    documentIsFileAssistant({
      file: SQL,
      fileSource: "workspace",
      remotePinFile: "src/foo.ts"
    }),
    true
  );
  assert.equal(
    autocompleteAllowsGraph({
      file: SQL,
      fileSource: "workspace",
      remotePinFile: "src/foo.ts"
    }),
    false
  );
  assert.equal(
    autocompleteAllowsGraph({ file: "src/foo.ts", fileSource: "remote" }),
    true
  );
  assert.equal(completionRequestsGraphContext({ allowGraphContext: false, effectiveUseGraph: true }), false);
  assert.equal(completionRequestsGraphContext({ allowGraphContext: true, effectiveUseGraph: true }), true);
  assert.equal(completionRequestsGraphContext({ effectiveUseGraph: true }), true);
});

test("Hard rule C: L hides repo AGENTS.md and does not prompt Create", async () => {
  const sources = projectInstructionsSourcesForTurn({
    fileAssistant: true,
    useRepoId: "github:acme/plane",
    attachedAgentsMdPath: undefined
  });
  assert.equal(sources.useRepoId, undefined);
  assert.equal(
    shouldPromptForAgentsMd({
      status: "missing",
      source: "attached",
      hasAgentsMd: false,
      canMutate: false
    }),
    false
  );

  clearProjectInstructionsCache();
  let remoteReads = 0;
  const block = await buildProjectInstructionsPromptBlock({
    enabled: true,
    useRepo: sources.useRepoId ? { repoId: sources.useRepoId } : undefined,
    attachedAgentsMdPath: sources.attachedAgentsMdPath,
    remainingGatherMs: 1_000,
    readRemoteFile: async () => {
      remoteReads += 1;
      return "plane AGENTS.md guide";
    }
  });
  assert.equal(remoteReads, 0);
  assert.equal(block?.includes("plane AGENTS.md guide") ?? false, false);

  const personal = projectInstructionsSourcesForTurn({
    fileAssistant: true,
    useRepoId: "github:acme/plane",
    attachedAgentsMdPath: "/tmp/AGENTS.md"
  });
  assert.equal(personal.useRepoId, undefined);
  assert.equal(personal.attachedAgentsMdPath, "/tmp/AGENTS.md");
  assert.equal(
    shouldPromptForAgentsMd({
      status: "loaded",
      source: "attached",
      hasAgentsMd: true,
      canMutate: true
    }),
    false
  );

  const repo = projectInstructionsSourcesForTurn({
    fileAssistant: false,
    useRepoId: "github:acme/plane",
    attachedAgentsMdPath: "/tmp/AGENTS.md"
  });
  assert.equal(repo.useRepoId, "github:acme/plane");
  assert.equal(repo.attachedAgentsMdPath, undefined);
});

test("planner: L drops workflow and keeps a named tool; R plan is not rewritten here", () => {
  const withWorkflow: ChatIntentPlan = {
    ...emptyChatIntentPlan("check Slack"),
    mode: "run-workflow",
    workflow: "trace-decision",
    execution: "silent",
    tools: ["slack"],
    codeIntent: { action: "locate", confidence: "high", reason: "hunt" }
  };
  const next = applyFileAssistantIntentPlan(withWorkflow);
  assert.equal(next.workflow, undefined);
  assert.equal(next.execution, "none");
  assert.equal(next.mode, "tools-only");
  assert.deepEqual(next.tools, ["slack"]);
  assert.equal(next.codeIntent?.action, "none");

  const remote = emptyChatIntentPlan("trace this");
  remote.workflow = "trace-decision";
  remote.mode = "run-workflow";
  remote.execution = "silent";
  assert.equal(remote.workflow, "trace-decision");
});

async function main(): Promise<void> {
  for (const run of queue) {
    await run();
  }
  const total = passed + failed;
  console.log(`\nsessionMode: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

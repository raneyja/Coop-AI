import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { handlePatchComplete } from "./handlePatchComplete";
import { listPatchCards, resetPatchSessionForTests } from "./patchSession";
import { clearRemotePatchBuffersForTests } from "./patchTarget";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  resetPatchSessionForTests();
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const SAMPLE_PATCH = [
  "File: `src/foo.ts`",
  "",
  "```patch",
  "<<<<<<< SEARCH",
  "const x = 1;",
  "=======",
  "const x = 2;",
  ">>>>>>> REPLACE",
  "```"
].join("\n");

async function main(): Promise<void> {
  await test("ignoreParseFailure leaves session untouched when no patches", async () => {
    const published: unknown[] = [];
    const result = await handlePatchComplete("**Answer**\nJust advice, no edits.", {
      messageTimestamp: 42,
      ignoreParseFailure: true,
      publish: (state) => {
        published.push(state);
      }
    });
    assert.equal(result, undefined);
    assert.equal(published.length, 0);
    assert.equal(listPatchCards().length, 0);
  });

  await test("ignoreParseFailure still elevates valid ask-mode patches", async () => {
    const content = ["**Answer**", "Apply this mapping change.", "", SAMPLE_PATCH].join("\n");
    const published: Array<{ cards: unknown[] }> = [];
    const result = await handlePatchComplete(content, {
      messageTimestamp: 99,
      ignoreParseFailure: true,
      publish: (state) => {
        published.push(state);
      }
    });
    assert.ok(result);
    assert.equal(result?.status, "pending");
    assert.equal(result?.messageTimestamp, 99);
    assert.equal(listPatchCards().length, 1);
    assert.equal(published.length, 1);
  });

  await test("edit-mode parse failure still publishes failed suppression path", async () => {
    const published: Array<{ suppressedMessageTimestamps?: number[] }> = [];
    const result = await handlePatchComplete("no patches here", {
      messageTimestamp: 7,
      publish: (state) => {
        published.push(state);
      }
    });
    assert.ok(result);
    assert.equal(result?.status, "failed");
    assert.equal(published.length, 1);
    assert.deepEqual(published[0]?.suppressedMessageTimestamps, [7]);
  });

  await test("snaps paraphrased SEARCH onto highlighted lines using attached file bytes", async () => {
    const fileBody = [
      "class State:",
      "    id = 1",
      "",
      "    def __str__(self):",
      "        return self.name",
      "    x = 2"
    ].join("\n");
    const content = [
      "File: `apps/api/plane/db/models/state.py`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },",
      "=======",
      "    # Represents the In Progress state",
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },",
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 813,
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [4, 5],
      fileContents: { "apps/api/plane/db/models/state.py": fileBody },
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    const hunk = result?.files[0]?.hunks[0];
    assert.equal(hunk?.matchStatus, "matched");
    const joined = (hunk?.lines ?? []).map((line) => line.text).join("\n");
    assert.ok(joined.includes("def __str__(self):"));
    assert.equal(joined.includes('"name": "In Progress"'), false);
  });

  await test("preview matches when highlight IS the SEARCH block and file bytes use a path alias", async () => {
    const fileBody = [
      "DEFAULT_STATES = [",
      "    {",
      '        "name": "Backlog",',
      "    },",
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },",
      "]"
    ].join("\n");
    const search = [
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },"
    ].join("\n");
    const content = [
      "File: `apps/api/plane/db/models/state.py`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      search,
      "=======",
      "    # State representing an ongoing task",
      search,
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 820,
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [5, 10],
      fileContents: { "plane/apps/api/plane/db/models/state.py": fileBody },
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    const hunk = result?.files[0]?.hunks[0];
    assert.equal(hunk?.matchStatus, "matched");
    const joined = (hunk?.lines ?? []).map((line) => line.text).join("\n");
    assert.ok(joined.includes('"name": "In Progress"'));
    assert.ok(joined.includes("# State representing an ongoing task"));
  });

  await test("expanding Backlog REPLACE does not duplicate the selected dict", async () => {
    const fileBody = [
      "DEFAULT_STATES = [",
      "    {",
      '        "name": "Backlog",',
      '        "color": "#60646C",',
      "        \"sequence\": 15000,",
      "        \"group\": StateGroup.BACKLOG.value,",
      "        \"default\": True,",
      "    },",
      "]"
    ].join("\n");
    const selection = [
      "    {",
      '        "name": "Backlog",',
      '        "color": "#60646C",',
      "        \"sequence\": 15000,",
      "        \"group\": StateGroup.BACKLOG.value,",
      "        \"default\": True,",
      "    },"
    ].join("\n");
    const content = [
      "File: `apps/api/plane/db/models/state.py`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      '        "name": "Backlog",',
      "=======",
      "        # Represents the default state for the backlog",
      selection,
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 921,
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [2, 8],
      fileContents: { "apps/api/plane/db/models/state.py": fileBody },
      commentOnly: true,
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    const lines = result?.files[0]?.hunks[0]?.lines ?? [];
    const joined = lines.map((line) => line.text).join("\n");
    const addText = lines
      .filter((line) => line.kind === "add")
      .map((line) => line.text)
      .join("\n");
    assert.equal(joined.split('"name": "Backlog"').length - 1, 1);
    assert.ok(addText.includes("Represents the default state"));
    assert.equal(addText.split('"name": "Backlog"').length - 1, 0);
  });

  await test("duplicate requireAuth signature snaps to one JSDoc above the function", async () => {
    const fileBody = [
      "export function requireAuth(",
      "  auth: AuthContext | undefined,",
      "  requireInProduction: boolean",
      "): auth is AuthContext {",
      "  if (auth) {",
      "    return true;",
      "  }",
      "  return !requireInProduction;",
      "}"
    ].join("\n");
    const content = [
      "File: `src/server/authMiddleware.ts`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      "export function requireAuth(",
      "=======",
      "export function requireAuth(",
      "/** Returns true when auth is present or when production auth is not required. */",
      "export function requireAuth(",
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 922,
      file: "src/server/authMiddleware.ts",
      selectedLines: [1, 4],
      fileContents: { "src/server/authMiddleware.ts": fileBody },
      commentOnly: true,
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    const lines = result?.files[0]?.hunks[0]?.lines ?? [];
    const joined = lines.map((line) => line.text).join("\n");
    const addText = lines
      .filter((line) => line.kind === "add")
      .map((line) => line.text)
      .join("\n");
    assert.equal(joined.split("export function requireAuth(").length - 1, 1);
    assert.ok(addText.includes("Returns true when auth is present"));
    assert.equal(addText.split("export function requireAuth(").length - 1, 0);
  });

  await test("comment-only ask rejects a constructor rewrite with no comment", async () => {
    const fileBody = [
      "export class CoopSidebarProvider {",
      "  public readonly session: CoopChatSession;",
      "",
      "  public constructor(",
      "    private readonly extensionUri: vscode.Uri,",
      "    private readonly extensionContext: vscode.ExtensionContext,",
      "    api: SecureApiClient,",
      "    services: CoopRuntimeServices",
      "  ) {",
      "    this.session = new CoopChatSession({",
      "      extensionUri",
      "    });",
      "  }",
      "}"
    ].join("\n");
    const content = [
      "File: `src/CoopSidebarProvider.ts`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      "  public constructor(",
      "    private readonly extensionUri: vscode.Uri,",
      "    private readonly extensionContext: vscode.ExtensionContext,",
      "    api: SecureApiClient,",
      "    services: CoopRuntimeServices",
      "  )",
      "=======",
      "  public constructor(",
      "    private readonly extensionUri: vscode.Uri,",
      "    private readonly extensionContext: vscode.ExtensionContext,",
      "    private readonly api: SecureApiClient,",
      "    private readonly services: CoopRuntimeServices",
      "  ) {",
      "    this.session = new CoopChatSession({",
      "      extensionUri,",
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 114,
      file: "src/CoopSidebarProvider.ts",
      selectedLines: [4, 9],
      fileContents: { "src/CoopSidebarProvider.ts": fileBody },
      commentOnly: true,
      publish: () => undefined
    });
    assert.equal(result?.status, "failed");
    assert.match(result?.error ?? "", /comment only/i);
  });

  await test("preview matches highlighted StateGroup in an untitled Bitbucket tab", async () => {
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    clearRemotePatchBuffersForTests();
    const classBody = [
      "class StateGroup(models.TextChoices):",
      '    BACKLOG = "backlog", "Backlog"',
      '    UNSTARTED = "unstarted", "Unstarted"',
      '    STARTED = "started", "Started"',
      '    COMPLETED = "completed", "Completed"',
      '    CANCELLED = "cancelled", "Cancelled"',
      '    TRIAGE = "triage", "Triage"'
    ].join("\n");
    const fileBody = `from django.db import models\n\n${classBody}\n`;
    const untitled = {
      uri: vscode.Uri.parse("untitled:Untitled-1"),
      getText: () => fileBody,
      lineCount: fileBody.split("\n").length,
      lineAt: (n: number) => ({ text: fileBody.split("\n")[n] ?? "" })
    } as unknown as vscode.TextDocument;
    (vscode.workspace.textDocuments as unknown as vscode.TextDocument[]).push(untitled);
    const content = [
      "File: `apps/api/plane/db/models/state.py`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      classBody,
      "=======",
      "class StateGroup(models.TextChoices):",
      '    """Workflow state choices, not US state definitions."""',
      '    BACKLOG = "backlog", "Backlog"',
      '    UNSTARTED = "unstarted", "Unstarted"',
      '    STARTED = "started", "Started"',
      '    COMPLETED = "completed", "Completed"',
      '    CANCELLED = "cancelled", "Cancelled"',
      '    TRIAGE = "triage", "Triage"',
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 148,
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [3, 9],
      selectionText: classBody,
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    assert.equal(result?.files[0]?.hunks[0]?.matchStatus, "matched");
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    clearRemotePatchBuffersForTests();
  });

  await test("comment-only In Progress duplicate snaps onto get_queryset, not DEFAULT_STATES", async () => {
    const fileBody = [
      "DEFAULT_STATES = [",
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },",
      "]",
      "",
      "class StateManager(SoftDeletionManager):",
      '    """Default manager"""',
      "",
      "    def get_queryset(self):",
      "        return super().get_queryset().exclude(group=StateGroup.TRIAGE.value)"
    ].join("\n");
    const dict = [
      "    {",
      '        "name": "In Progress",',
      '        "color": "#F59E0B",',
      "        \"sequence\": 35000,",
      "        \"group\": StateGroup.STARTED.value,",
      "    },"
    ].join("\n");
    const content = [
      "File: `apps/api/plane/db/models/state.py`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      dict,
      "=======",
      dict,
      "    # Represents the state of an item that is currently in progress.",
      dict,
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const result = await handlePatchComplete(content, {
      messageTimestamp: 1013,
      file: "apps/api/plane/db/models/state.py",
      selectedLines: [13, 14],
      fileContents: { "apps/api/plane/db/models/state.py": fileBody },
      commentOnly: true,
      publish: () => undefined
    });
    assert.equal(result?.status, "pending");
    const lines = result?.files[0]?.hunks[0]?.lines ?? [];
    const joined = lines.map((line) => line.text).join("\n");
    const addText = lines
      .filter((line) => line.kind === "add")
      .map((line) => line.text)
      .join("\n");
    assert.ok(joined.includes("def get_queryset"));
    assert.equal(joined.split('"name": "In Progress"').length - 1, 0);
    assert.equal(joined.split("def get_queryset").length - 1, 1);
    assert.equal(addText.split("def get_queryset").length - 1, 0);
    assert.ok(addText.includes("currently in progress"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

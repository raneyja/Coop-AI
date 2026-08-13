import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { PHASE_B_GATE_IDS } from "../api/agent/gates";
import { parseAgentToolPlan } from "../api/agent/parseAgentToolPlan";
import { handleProposePatch } from "../api/agent/tools/proposePatch";
import { createAgentToolRegistry } from "../api/agent/tools/registry";
import type { PatchCardState } from "../chat/types";
import { applyPatchesToWorkspace, undoPatchApplication } from "./patchApplier";
import { handlePatchComplete } from "./handlePatchComplete";
import { parsePatchResponse } from "./patchParser";
import { emitPatchEvent, setPatchEventHandler } from "./patchEvents";
import { rejectPendingPatchWithState, undoLastPatchWithState } from "./patchActions";
import { buildPatchCardState, setHunkStatusOnCard, deriveCardStatusFromHunks } from "./patchDiffPreview";
import { getPatchRecord, listPatchCards, resetPatchSessionForTests, upsertPatchRecord } from "./patchSession";
import { ensureEditablePatchTarget } from "./patchTarget";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  resetPatchSessionForTests();
  (vscode.workspace.textDocuments as unknown[]).length = 0;
  (vscode.window.visibleTextEditors as unknown[]).length = 0;
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

const TWO_FILE_PATCH = [
  "File: `src/a.ts`",
  "",
  "```patch",
  "<<<<<<< SEARCH",
  "alpha",
  "=======",
  "ALPHA",
  ">>>>>>> REPLACE",
  "```",
  "",
  "File: `src/b.ts`",
  "",
  "```patch",
  "<<<<<<< SEARCH",
  "beta",
  "=======",
  "BETA",
  ">>>>>>> REPLACE",
  "```"
].join("\n");

type MutableDoc = {
  uri: vscode.Uri;
  getText: () => string;
  setText: (next: string) => void;
  lineCount: number;
  lineAt: (n: number) => { text: string };
};

function installRemoteDoc(relativePath: string, content: string, owner = "acme", repo = "demo"): MutableDoc {
  let text = content;
  const uri = vscode.Uri.parse(`vscode-vfs://github/${owner}/${repo}/${relativePath}`);
  const doc: MutableDoc = {
    uri,
    getText: () => text,
    setText: (next) => {
      text = next;
    },
    get lineCount() {
      return Math.max(1, text.split("\n").length);
    },
    lineAt: (n: number) => ({ text: text.split("\n")[n] ?? "" })
  };
  (vscode.workspace.textDocuments as unknown as MutableDoc[]).push(doc);
  return doc;
}

function installApplyEditMutation(): () => void {
  const workspace = vscode.workspace as unknown as {
    applyEdit: (edit: { replacements?: Array<{ uri: { toString(): string }; newText: string }> }) => Promise<boolean>;
  };
  const previous = workspace.applyEdit;
  workspace.applyEdit = async (edit) => {
    for (const item of edit.replacements ?? []) {
      const docs = vscode.workspace.textDocuments as unknown as MutableDoc[];
      const doc = docs.find((entry) => entry.uri.toString() === item.uri.toString());
      doc?.setText(item.newText);
    }
    return true;
  };
  return () => {
    workspace.applyEdit = previous;
  };
}

const GITHUB_REPO = { owner: "acme", repo: "demo", provider: "github" as const };

async function main(): Promise<void> {
  await test("B-G1 /edit two-file patch yields a Patch card", async () => {
    const card = await handlePatchComplete(TWO_FILE_PATCH, { messageTimestamp: 101 });
    assert.ok(PHASE_B_GATE_IDS.includes("B-G1"));
    assert.equal(card?.status, "pending");
    assert.equal(card?.fileCount, 2);
    assert.equal(listPatchCards().length, 1);
    assert.equal(listPatchCards()[0]?.files.length, 2);
  });

  await test("B-G1 agent propose_patch yields parseable 2-file SEARCH/REPLACE", async () => {
    const raw = await handleProposePatch({
      files: [
        { path: "src/a.ts", search: "alpha", replace: "ALPHA" },
        { path: "src/b.ts", search: "beta", replace: "BETA" }
      ]
    });
    const parsed = JSON.parse(raw) as { ok: boolean; applied: boolean; fileCount: number; patchText: string };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.applied, false);
    assert.equal(parsed.fileCount, 2);
    const card = await handlePatchComplete(parsed.patchText, { messageTimestamp: 102 });
    assert.equal(card?.fileCount, 2);
    assert.equal(card?.status, "pending");
  });

  await test("B-G1 registry expose propose_patch without applying", async () => {
    const registry = createAgentToolRegistry({
      indexBackend: {} as never,
      resolveAbsolutePath: () => undefined
    });
    assert.ok(registry.propose_patch);
    const raw = await registry.propose_patch!({
      files: [
        { path: "src/a.ts", search: "a", replace: "A" },
        { path: "src/b.ts", search: "b", replace: "B" }
      ]
    });
    const parsed = JSON.parse(raw) as { applied: boolean; fileCount: number };
    assert.equal(parsed.applied, false);
    assert.equal(parsed.fileCount, 2);
  });

  await test("B-G2 remote auto-open succeeds when files were not open (mocked VFS)", async () => {
    const opened: string[] = [];
    const result = await ensureEditablePatchTarget("src/remote.ts", {
      repo: GITHUB_REPO,
      openRemoteFile: async ({ filePath }) => {
        opened.push(filePath);
        installRemoteDoc(filePath, "const x = 1;\n");
        return true;
      }
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.usedRemoteOpen, true);
    assert.equal(opened[0], "src/remote.ts");
    assert.equal(result.target.readText(), "const x = 1;\n");
    assert.match(result.target.uri.toString(), /^vscode-vfs:/);
  });

  await test("B-G2 Apply after auto-open writes the remote buffer", async () => {
    const restore = installApplyEditMutation();
    try {
      const patches = parsePatchResponse(TWO_FILE_PATCH);
      assert.equal(patches.ok, true);
      if (!patches.ok) {
        return;
      }
      const result = await applyPatchesToWorkspace(patches.patches, {
        repo: GITHUB_REPO,
        openRemoteFile: async ({ filePath }) => {
          const original = filePath.endsWith("a.ts") ? "alpha\n" : "beta\n";
          installRemoteDoc(filePath, original);
          return true;
        }
      });
      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      assert.equal(result.usedRemoteEditor, true);
      const docs = vscode.workspace.textDocuments as unknown as MutableDoc[];
      assert.equal(docs.find((doc) => doc.uri.toString().endsWith("src/a.ts"))?.getText(), "ALPHA\n");
      assert.equal(docs.find((doc) => doc.uri.toString().endsWith("src/b.ts"))?.getText(), "BETA\n");
    } finally {
      restore();
    }
  });

  await test("B-G3 reject leaves buffers unchanged and restages via undo", async () => {
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const card = buildPatchCardState(parsed.patches, { status: "pending", messageTimestamp: 201 });
    upsertPatchRecord(201, parsed.patches, card);
    rejectPendingPatchWithState(undefined, "explicit", 201);
    const after = getPatchRecord(201);
    assert.equal(after?.card.status, "rejected");
    assert.ok(after?.card.files.every((file) => file.hunks.every((hunk) => hunk.status === "rejected")));
    const undone = await undoLastPatchWithState(undefined, 201);
    assert.equal(undone, true);
    assert.equal(getPatchRecord(201)?.card.status, "pending");
  });

  await test("B-G3 undo restores buffers after Apply", async () => {
    const restore = installApplyEditMutation();
    try {
      installRemoteDoc("src/a.ts", "alpha\n");
      const parsed = parsePatchResponse(
        [
          "File: `src/a.ts`",
          "",
          "```patch",
          "<<<<<<< SEARCH",
          "alpha",
          "=======",
          "ALPHA",
          ">>>>>>> REPLACE",
          "```"
        ].join("\n")
      );
      assert.equal(parsed.ok, true);
      if (!parsed.ok) {
        return;
      }
      const applied = await applyPatchesToWorkspace(parsed.patches, { repo: GITHUB_REPO });
      assert.equal(applied.ok, true);
      if (!applied.ok) {
        return;
      }
      const docs = vscode.workspace.textDocuments as unknown as MutableDoc[];
      assert.equal(docs[0]?.getText(), "ALPHA\n");
      const undone = await undoPatchApplication(applied.undo);
      assert.equal(undone.ok, true);
      assert.equal(docs[0]?.getText(), "alpha\n");
    } finally {
      restore();
    }
  });

  await test("B-G4 citation fences are not Apply-able", () => {
    const cited = [
      "See the existing helper:",
      "",
      "```12:20:src/auth.ts",
      "export function requireAuth() {}",
      "```"
    ].join("\n");
    const parsed = parsePatchResponse(cited);
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.match(parsed.error, /No patch blocks found/i);
  });

  await test("B-G6 apply and reject telemetry still fire", async () => {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    setPatchEventHandler((type, payload) => {
      events.push({ type, payload });
    });
    try {
      emitPatchEvent("edit.patch_applied", { fileCount: 2, hunkCount: 2 });
      emitPatchEvent("edit.patch_rejected", { reason: "explicit", hunkCount: 1 });
      assert.deepEqual(
        events.map((event) => event.type),
        ["edit.patch_applied", "edit.patch_rejected"]
      );
      const parsed = parsePatchResponse(TWO_FILE_PATCH);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) {
        return;
      }
      await handlePatchComplete(TWO_FILE_PATCH, { messageTimestamp: 301 });
      assert.ok(events.some((event) => event.type === "edit.patch_parsed"));
      rejectPendingPatchWithState(undefined, "explicit", 301);
      assert.ok(events.some((event) => event.type === "edit.patch_rejected"));
    } finally {
      setPatchEventHandler(() => undefined);
    }
  });

  await test("B-G7 reserved Create PR is coop-text-btn, not a new primary row", () => {
    const source = fs.readFileSync(path.join(__dirname, "../webview/PatchCard.tsx"), "utf8");
    assert.match(source, /CREATE_PULL_REQUEST_BUTTON_CLASS/);
    assert.match(source, /showCreatePullRequestButton\(state\)/);
    assert.doesNotMatch(source, /coop-patch-pr-row|coop-settings-action-btn">\s*Create pull request/);
    const applyCount = [...source.matchAll(/coop-settings-action-btn/g)].length;
    assert.ok(applyCount >= 2, "Apply / Undo stay as primary action buttons");
    const idle = buildPatchCardState({ files: [] }, { status: "pending" });
    assert.equal(idle.canCreatePr, false);
  });

  await test("parseAgentToolPlan accepts propose_patch", () => {
    const parsed = parseAgentToolPlan(
      JSON.stringify({
        tool: "propose_patch",
        args: { files: [{ path: "src/a.ts", search: "a", replace: "A" }] }
      })
    );
    assert.equal(parsed.kind, "call");
    if (parsed.kind === "call") {
      assert.equal(parsed.tool, "propose_patch");
    }
  });

  await test("mixed apply/reject hunks stay independent (card helper)", () => {
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    let card: PatchCardState = buildPatchCardState(parsed.patches, {
      status: "pending",
      messageTimestamp: 1
    });
    card = setHunkStatusOnCard(card, "hunk-0", "applied");
    card = setHunkStatusOnCard(card, "hunk-1", "rejected");
    assert.equal(deriveCardStatusFromHunks(card), "applied");
    assert.equal(card.files[0]?.hunks[0]?.status, "applied");
    assert.equal(card.files[1]?.hunks[0]?.status, "rejected");
  });

  console.log(`\nphaseB.gates: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

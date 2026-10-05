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
import { applyPendingPatch, applyPendingPatchHunk, collectAppliedPrFiles, rejectPendingPatchWithState, undoLastPatchWithState } from "./patchActions";
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
    const raw = await handleProposePatch(
      { indexBackend: {} as never, resolveAbsolutePath: () => undefined },
      {
        files: [
          { path: "src/a.ts", search: "alpha", replace: "ALPHA" },
          { path: "src/b.ts", search: "beta", replace: "BETA" }
        ]
      }
    );
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

  await test("B-G2 Apply uses captured bytes when GitHub Repositories is missing", async () => {
    const restore = installApplyEditMutation();
    try {
      const patches = parsePatchResponse(TWO_FILE_PATCH);
      assert.equal(patches.ok, true);
      if (!patches.ok) {
        return;
      }
      const result = await applyPatchesToWorkspace(patches.patches, {
        repo: GITHUB_REPO,
        openRemoteFile: async () => false,
        fileContents: {
          "src/a.ts": "alpha\n",
          "src/b.ts": "beta\n"
        }
      });
      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      assert.equal(result.filesChanged, 2);
      assert.equal(result.appliedFiles.length, 2);
      assert.equal(result.appliedFiles.find((file) => file.path === "src/a.ts")?.content, "ALPHA\n");
      const docs = vscode.workspace.textDocuments as unknown as MutableDoc[];
      assert.equal(docs.some((doc) => doc.getText() === "ALPHA\n"), true);
      assert.equal(docs.some((doc) => doc.getText() === "BETA\n"), true);
    } finally {
      restore();
    }
  });

  await test("Apply preserves a cleared live buffer instead of restoring stale captured bytes", async () => {
    const restore = installApplyEditMutation();
    try {
      const parsed = parsePatchResponse(TWO_FILE_PATCH);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;
      for (const cleared of ["", " \n\t"]) {
        (vscode.workspace.textDocuments as unknown[]).length = 0;
        const first = installRemoteDoc("src/a.ts", cleared);
        const second = installRemoteDoc("src/b.ts", "beta\n");
        const result = await applyPatchesToWorkspace(parsed.patches, {
          repo: GITHUB_REPO,
          fileContents: { "src/a.ts": "alpha\n", "src/b.ts": "beta\n" }
        });
        assert.equal(result.ok, false);
        assert.equal(first.getText(), cleared);
        assert.equal(second.getText(), "beta\n");
      }
    } finally {
      restore();
    }
  });

  await test("concurrent Apply dispatches one edit and cannot overwrite later user text", async () => {
    const doc = installRemoteDoc("src/a.ts", "alpha\n");
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.ok(parsed.ok);
    const patches = { files: [parsed.patches.files[0]] };
    upsertPatchRecord(910, patches, buildPatchCardState(patches, { status: "pending", messageTimestamp: 910 }));
    const workspace = vscode.workspace as unknown as { applyEdit: (edit: { replacements?: Array<{ newText: string }> }) => Promise<boolean> };
    const previous = workspace.applyEdit;
    let writes = 0;
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    workspace.applyEdit = async (edit) => {
      writes++;
      started();
      await gate;
      doc.setText(edit.replacements?.[0]?.newText ?? doc.getText());
      return true;
    };
    try {
      const first = applyPendingPatch(undefined, 910);
      await dispatched;
      const second = applyPendingPatch(undefined, 910);
      release();
      assert.equal(await first, true);
      assert.equal(await second, false);
      doc.setText(`${doc.getText()}// user edit after completed workspace transaction\n`);
      assert.equal(writes, 1);
      assert.equal(getPatchRecord(910)?.card.status, "applied");
      assert.ok(doc.getText().includes("user edit"));
      assert.equal(await applyPendingPatchHunk(undefined, 910, "hunk-0"), false);
      assert.equal(writes, 1);
    } finally {
      release();
      workspace.applyEdit = previous;
    }
  });

  await test("failed Apply releases the per-record guard so an explicit retry can succeed", async () => {
    const doc = installRemoteDoc("src/a.ts", "alpha\n");
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.ok(parsed.ok);
    const patches = { files: [parsed.patches.files[0]] };
    upsertPatchRecord(911, patches, buildPatchCardState(patches, { status: "pending", messageTimestamp: 911 }));
    const workspace = vscode.workspace as unknown as { applyEdit: (edit: { replacements?: Array<{ newText: string }> }) => Promise<boolean> };
    const previous = workspace.applyEdit;
    let calls = 0;
    workspace.applyEdit = async (edit) => {
      if (++calls === 1) return false;
      doc.setText(edit.replacements?.[0]?.newText ?? doc.getText());
      return true;
    };
    try {
      assert.equal(await applyPendingPatch(undefined, 911), false);
      assert.equal(await applyPendingPatch(undefined, 911), true);
      assert.equal(calls, 2);
      assert.equal(doc.getText(), "ALPHA\n");
    } finally {
      workspace.applyEdit = previous;
    }
  });

  for (const operation of ["Apply", "Undo"] as const) {
    await test(`in-flight ${operation} serializes Reject and Undo/Apply for a partially applied record`, async () => {
      const firstDoc = installRemoteDoc("src/a.ts", "alpha\n");
      const secondDoc = installRemoteDoc("src/b.ts", "beta\n");
      const parsed = parsePatchResponse(TWO_FILE_PATCH);
      assert.ok(parsed.ok);
      upsertPatchRecord(912, parsed.patches, buildPatchCardState(parsed.patches, { status: "pending", messageTimestamp: 912 }));
      const restoreInitial = installApplyEditMutation();
      assert.equal(await applyPendingPatchHunk(undefined, 912, "hunk-0"), true);
      restoreInitial();
      const workspace = vscode.workspace as unknown as { applyEdit: (edit: { replacements?: Array<{ uri: { toString(): string }; newText: string }> }) => Promise<boolean> };
      const previous = workspace.applyEdit;
      let release: () => void = () => undefined;
      let started: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const dispatched = new Promise<void>((resolve) => { started = resolve; });
      let writes = 0;
      workspace.applyEdit = async (edit) => {
        writes++;
        started();
        await gate;
        for (const replacement of edit.replacements ?? []) {
          const doc = [firstDoc, secondDoc].find((entry) => entry.uri.toString() === replacement.uri.toString());
          doc?.setText(replacement.newText);
        }
        return true;
      };
      let inFlight: Promise<boolean> | undefined;
      try {
        inFlight = operation === "Apply" ? applyPendingPatchHunk(undefined, 912, "hunk-1") : undoLastPatchWithState(undefined, 912);
        await dispatched;
        const before = getPatchRecord(912)?.card;
        rejectPendingPatchWithState(undefined, "explicit", 912);
        assert.deepEqual(getPatchRecord(912)?.card, before);
        assert.equal(await undoLastPatchWithState(undefined, 912), false);
        assert.equal(await applyPendingPatchHunk(undefined, 912, "hunk-1"), false);
        assert.equal(writes, 1);
        release();
        assert.equal(await inFlight, true);
        assert.equal(firstDoc.getText(), operation === "Apply" ? "ALPHA\n" : "alpha\n");
        assert.equal(secondDoc.getText(), operation === "Apply" ? "BETA\n" : "beta\n");
        assert.equal(getPatchRecord(912)?.card.status, operation === "Apply" ? "applied" : "pending");
      } finally {
        release();
        await inFlight?.catch(() => undefined);
        workspace.applyEdit = previous;
      }
    });
  }

  await test("two-file Apply-all dispatches one atomic edit under concurrent Apply and Undo", async () => {
    const firstDoc = installRemoteDoc("src/a.ts", "alpha\n");
    const secondDoc = installRemoteDoc("src/b.ts", "beta\n");
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.ok(parsed.ok);
    upsertPatchRecord(913, parsed.patches, buildPatchCardState(parsed.patches, { status: "pending", messageTimestamp: 913 }));
    const workspace = vscode.workspace as unknown as { applyEdit: (edit: { replacements?: Array<{ uri: { toString(): string }; newText: string }> }) => Promise<boolean> };
    const previous = workspace.applyEdit;
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    let writes = 0;
    workspace.applyEdit = async (edit) => {
      writes++;
      assert.equal(edit.replacements?.length, 2);
      started();
      await gate;
      for (const replacement of edit.replacements ?? []) {
        const doc = [firstDoc, secondDoc].find((entry) => entry.uri.toString() === replacement.uri.toString());
        doc?.setText(replacement.newText);
      }
      return true;
    };
    let inFlight: Promise<boolean> | undefined;
    try {
      inFlight = applyPendingPatch(undefined, 913);
      await dispatched;
      assert.equal(await applyPendingPatch(undefined, 913), false);
      assert.equal(await undoLastPatchWithState(undefined, 913), false);
      assert.equal(writes, 1);
      assert.equal(firstDoc.getText(), "alpha\n");
      assert.equal(secondDoc.getText(), "beta\n");
      release();
      assert.equal(await inFlight, true);
      assert.equal(firstDoc.getText(), "ALPHA\n");
      assert.equal(secondDoc.getText(), "BETA\n");
      assert.equal(getPatchRecord(913)?.undo?.length, 2);
      assert.equal(getPatchRecord(913)?.card.status, "applied");
    } finally {
      release();
      await inFlight?.catch(() => undefined);
      workspace.applyEdit = previous;
    }
  });

  await test("second-file stale SEARCH refuses the entire two-file Apply without changing either buffer", async () => {
    const firstDoc = installRemoteDoc("src/a.ts", "alpha\n");
    const secondDoc = installRemoteDoc("src/b.ts", "beta\n");
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.ok(parsed.ok);
    upsertPatchRecord(914, parsed.patches, buildPatchCardState(parsed.patches, { status: "pending", messageTimestamp: 914 }));
    secondDoc.setText("user-revised-content\n");
    const restore = installApplyEditMutation();
    try {
      assert.equal(await applyPendingPatch(undefined, 914), false);
      assert.equal(firstDoc.getText(), "alpha\n");
      assert.equal(secondDoc.getText(), "user-revised-content\n");
      assert.equal(getPatchRecord(914)?.undo?.length ?? 0, 0);
      assert.equal(getPatchRecord(914)?.card.status, "failed");
    } finally {
      restore();
    }
  });

  for (const changedBy of ["user", "another patch card"] as const) {
    await test(`two-file Undo preserves both buffers after intervening ${changedBy} edits`, async () => {
      const firstDoc = installRemoteDoc("src/a.ts", "alpha\n");
      const secondDoc = installRemoteDoc("src/b.ts", "beta\n");
      const parsed = parsePatchResponse(TWO_FILE_PATCH);
      assert.ok(parsed.ok);
      upsertPatchRecord(915, parsed.patches, buildPatchCardState(parsed.patches, { status: "pending", messageTimestamp: 915 }));
      const restore = installApplyEditMutation();
      try {
        assert.equal(await applyPendingPatch(undefined, 915), true);
        if (changedBy === "user") firstDoc.setText("USER_WORK\n");
        else {
          const other = parsePatchResponse("File: `src/a.ts`\n```patch\n<<<<<<< SEARCH\nALPHA\n=======\nOTHER_CARD\n>>>>>>> REPLACE\n```");
          assert.ok(other.ok);
          upsertPatchRecord(916, other.patches, buildPatchCardState(other.patches, { status: "pending", messageTimestamp: 916 }));
          assert.equal(await applyPendingPatch(undefined, 916), true);
        }
        assert.equal(await undoLastPatchWithState(undefined, 915), false);
        assert.equal(firstDoc.getText(), changedBy === "user" ? "USER_WORK\n" : "OTHER_CARD\n");
        assert.equal(secondDoc.getText(), "BETA\n");
        assert.equal(getPatchRecord(915)?.card.status, "applied");
        assert.equal(getPatchRecord(915)?.undo?.length, 2);
      } finally { restore(); }
    });
  }

  for (const interveningEdit of [false, true]) {
    await test(`same-file incremental hunks ${interveningEdit ? "refuse unsafe" : "retain safe"} whole-file Undo`, async () => {
      const doc = installRemoteDoc("src/a.ts", "alpha\nbeta\n");
      const parsed = parsePatchResponse("File: `src/a.ts`\n```patch\n<<<<<<< SEARCH\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nbeta\n=======\nBETA\n>>>>>>> REPLACE\n```");
      assert.ok(parsed.ok);
      upsertPatchRecord(917, parsed.patches, buildPatchCardState(parsed.patches, { status: "pending", messageTimestamp: 917 }));
      const restore = installApplyEditMutation();
      try {
        assert.equal(await applyPendingPatchHunk(undefined, 917, "hunk-0"), true);
        if (interveningEdit) doc.setText("ALPHA\nUSER_WORK\nbeta\n");
        assert.equal(await applyPendingPatchHunk(undefined, 917, "hunk-1"), true);
        assert.equal(await undoLastPatchWithState(undefined, 917), !interveningEdit);
        assert.equal(doc.getText(), interveningEdit ? "ALPHA\nUSER_WORK\nBETA\n" : "alpha\nbeta\n");
      } finally { restore(); }
    });
  }

  await test("Undo rechecks earlier buffers after waiting for later targets to open", async () => {
    const firstDoc = installRemoteDoc("src/a.ts", "alpha\n");
    const secondDoc = installRemoteDoc("src/b.ts", "beta\n");
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.ok(parsed.ok);
    const restore = installApplyEditMutation();
    const workspace = vscode.workspace;
    const previousOpen = workspace.openTextDocument;
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dispatched = new Promise<void>((resolve) => { started = resolve; });
    let inFlight: ReturnType<typeof undoPatchApplication> | undefined;
    try {
      const applied = await applyPatchesToWorkspace(parsed.patches);
      assert.ok(applied.ok);
      // Force the second target through the asynchronous open path.
      (vscode.workspace.textDocuments as unknown as MutableDoc[]).splice(1, 1);
      workspace.openTextDocument = (async () => { started(); await gate; return secondDoc; }) as typeof workspace.openTextDocument;
      inFlight = undoPatchApplication(applied.undo);
      await dispatched;
      firstDoc.setText("USER_WORK_DURING_OPEN\n");
      release();
      assert.equal((await inFlight).ok, false);
      assert.equal(firstDoc.getText(), "USER_WORK_DURING_OPEN\n");
      assert.equal(secondDoc.getText(), "BETA\n");
    } finally {
      release();
      await inFlight?.catch(() => undefined);
      workspace.openTextDocument = previousOpen;
      restore();
    }
  });

  await test("Create PR files come from captured bytes when the Apply buffer has no repo path", async () => {
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    const parsed = parsePatchResponse(TWO_FILE_PATCH);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const fileContents = { "src/a.ts": "alpha\n", "src/b.ts": "beta\n" };
    let card: PatchCardState = buildPatchCardState(parsed.patches, {
      status: "pending",
      messageTimestamp: 902,
      fileContents
    });
    card = setHunkStatusOnCard(card, "hunk-0", "applied");
    card = setHunkStatusOnCard(card, "hunk-1", "applied");
    upsertPatchRecord(902, parsed.patches, { ...card, status: "applied" }, { fileContents });
    const files = collectAppliedPrFiles({ ...card, status: "applied", messageTimestamp: 902 });
    assert.equal(files.length, 2);
    assert.equal(files.find((file) => file.path === "src/a.ts")?.content, "ALPHA\n");
    assert.equal(files.find((file) => file.path === "src/b.ts")?.content, "BETA\n");
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

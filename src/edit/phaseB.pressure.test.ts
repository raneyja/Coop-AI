import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { PHASE_B_PRESSURE_IDS } from "../api/agent/gates";
import { handleProposePatch } from "../api/agent/tools/proposePatch";
import type { PatchCardState } from "../chat/types";
import { applyPatchesToWorkspace, undoPatchApplication } from "./patchApplier";
import { handlePatchComplete } from "./handlePatchComplete";
import { parsePatchResponse, PATCH_SESSION_MAX_FILES, patchFileCapError } from "./patchParser";
import {
  rejectPendingPatchHunk,
  rejectPendingPatchWithState
} from "./patchActions";
import {
  buildPatchCardState,
  deriveCardStatusFromHunks,
  setHunkStatusOnCard
} from "./patchDiffPreview";
import { getPatchRecord, resetPatchSessionForTests, upsertPatchRecord } from "./patchSession";
import {
  githubRemoteOpenFailedMessage,
  remoteOpenUnsupportedMessage
} from "./patchSessionContract";
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

type MutableDoc = {
  uri: vscode.Uri;
  getText: () => string;
  setText: (next: string) => void;
  lineCount: number;
  lineAt: (n: number) => { text: string };
};

function installRemoteDoc(relativePath: string, content: string): MutableDoc {
  let text = content;
  const uri = vscode.Uri.parse(`vscode-vfs://github/acme/demo/${relativePath}`);
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

function filePatch(relativePath: string, search: string, replace: string): string {
  return [
    `File: \`${relativePath}\``,
    "",
    "```patch",
    "<<<<<<< SEARCH",
    search,
    "=======",
    replace,
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
}

async function main(): Promise<void> {
  await test("B-P1 malformed SEARCH/REPLACE errors with no silent write", async () => {
    assert.ok(PHASE_B_PRESSURE_IDS.includes("B-P1"));
    const malformed = [
      "File: `src/a.ts`",
      "",
      "```patch",
      "<<<<<<< SEARCH",
      "alpha",
      ">>>>>>> REPLACE",
      "```"
    ].join("\n");
    const parsed = parsePatchResponse(malformed);
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.match(parsed.error, /Malformed SEARCH\/REPLACE/);

    const tool = JSON.parse(
      await handleProposePatch({ files: [{ path: "src/a.ts", search: "alpha" }] })
    ) as { ok: boolean; applied: boolean; error: string };
    assert.equal(tool.ok, false);
    assert.equal(tool.applied, false);
    assert.match(tool.error, /Malformed SEARCH\/REPLACE/);
    assert.equal((vscode.workspace.textDocuments as unknown[]).length, 0);
  });

  await test("B-P2 GitLab/Bitbucket honest degrade — no fake VFS", async () => {
    let vfsCalls = 0;
    for (const provider of ["gitlab", "bitbucket"] as const) {
      const result = await ensureEditablePatchTarget("src/a.ts", {
        repo: { owner: "acme", repo: "demo", provider },
        openRemoteFile: async () => {
          vfsCalls += 1;
          return true;
        }
      });
      assert.equal(result.ok, false);
      if (result.ok) {
        continue;
      }
      assert.equal(result.error, remoteOpenUnsupportedMessage("src/a.ts", provider));
      assert.match(result.error, /GitHub only/);
      assert.doesNotMatch(result.error, /opened/i);
    }
    assert.equal(vfsCalls, 0);
    assert.equal(
      githubRemoteOpenFailedMessage("src/a.ts").includes("GitHub Repositories"),
      true
    );
  });

  await test("B-P3 Apply then Undo then Apply again", async () => {
    const restore = installApplyEditMutation();
    try {
      const doc = installRemoteDoc("src/a.ts", "alpha\n");
      const parsed = parsePatchResponse(filePatch("src/a.ts", "alpha", "ALPHA"));
      assert.equal(parsed.ok, true);
      if (!parsed.ok) {
        return;
      }
      const first = await applyPatchesToWorkspace(parsed.patches, { repo: GITHUB_REPO });
      assert.equal(first.ok, true);
      if (!first.ok) {
        return;
      }
      assert.equal(doc.getText(), "ALPHA\n");
      const undone = await undoPatchApplication(first.undo);
      assert.equal(undone.ok, true);
      assert.equal(doc.getText(), "alpha\n");
      const second = await applyPatchesToWorkspace(parsed.patches, { repo: GITHUB_REPO });
      assert.equal(second.ok, true);
      if (!second.ok) {
        return;
      }
      assert.equal(doc.getText(), "ALPHA\n");
    } finally {
      restore();
    }
  });

  await test("B-P4 one file Apply, one Reject in the same session", () => {
    const parsed = parsePatchResponse(
      [filePatch("src/a.ts", "alpha", "ALPHA"), filePatch("src/b.ts", "beta", "BETA")].join("\n\n")
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    let card: PatchCardState = buildPatchCardState(parsed.patches, {
      status: "pending",
      messageTimestamp: 40
    });
    upsertPatchRecord(40, parsed.patches, card);
    card = setHunkStatusOnCard(card, "hunk-0", "applied");
    rejectPendingPatchHunk(undefined, 40, "hunk-1");
    const record = getPatchRecord(40);
    assert.equal(record?.card.files[1]?.hunks[0]?.status, "rejected");
    const mixed = setHunkStatusOnCard(record!.card, "hunk-0", "applied");
    assert.equal(mixed.files[0]?.hunks[0]?.status, "applied");
    assert.equal(mixed.files[1]?.hunks[0]?.status, "rejected");
    assert.equal(deriveCardStatusFromHunks(mixed), "applied");
  });

  await test("B-P5 5-file cap with a clear error", async () => {
    assert.equal(PATCH_SESSION_MAX_FILES, 5);
    const files = ["a", "b", "c", "d", "e", "f"].map((name) =>
      filePatch(`src/${name}.ts`, name, name.toUpperCase())
    );
    const parsed = parsePatchResponse(files.join("\n\n"));
    assert.equal(parsed.ok, false);
    if (parsed.ok) {
      return;
    }
    assert.equal(parsed.error, patchFileCapError(6));

    const tool = JSON.parse(
      await handleProposePatch({
        files: files.map((_, index) => ({
          path: `src/${["a", "b", "c", "d", "e", "f"][index]}.ts`,
          search: "x",
          replace: "y"
        }))
      })
    ) as { ok: boolean; error: string };
    assert.equal(tool.ok, false);
    assert.match(tool.error, /5-file maximum/);
  });

  await test("B-P6 cite fence beside a patch — only the patch is Apply-able", async () => {
    const mixed = [
      "Auth lives here:",
      "",
      "```10:18:src/auth.ts",
      "export function requireAuth() {",
      "  return true;",
      "}",
      "```",
      "",
      filePatch("src/b.ts", "beta", "BETA")
    ].join("\n");
    const parsed = parsePatchResponse(mixed);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.patches.files.length, 1);
    assert.equal(parsed.patches.files[0]?.relativePath, "src/b.ts");
    const card = await handlePatchComplete(mixed, { messageTimestamp: 60, ignoreParseFailure: true });
    assert.equal(card?.fileCount, 1);
    assert.equal(card?.files[0]?.relativePath, "src/b.ts");
  });

  await test("reject does not invent an apply when nothing was written", () => {
    const parsed = parsePatchResponse(filePatch("src/a.ts", "alpha", "ALPHA"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const card = buildPatchCardState(parsed.patches, { status: "pending", messageTimestamp: 70 });
    upsertPatchRecord(70, parsed.patches, card);
    rejectPendingPatchWithState(undefined, "explicit", 70);
    assert.equal((vscode.workspace.textDocuments as unknown[]).length, 0);
    assert.equal(getPatchRecord(70)?.card.status, "rejected");
  });

  console.log(`\nphaseB.pressure: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

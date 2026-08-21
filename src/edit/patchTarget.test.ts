import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  clearRemotePatchBuffersForTests,
  collectOpenPatchFileBytes,
  documentMatchesPatchPath,
  ensureEditablePatchTarget,
  findOpenDocumentForPatchFile,
  rememberRemotePatchBuffer,
  undoSnapshotPathForUri,
  uriFromUndoSnapshotPath
} from "./patchTarget";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

function fakeDoc(uriString: string, text = "content"): vscode.TextDocument {
  const uri = vscode.Uri.parse(uriString);
  return {
    uri,
    getText: () => text,
    lineCount: Math.max(1, text.split("\n").length),
    lineAt: () => ({ text })
  } as unknown as vscode.TextDocument;
}

async function main(): Promise<void> {
  await test("documentMatchesPatchPath matches github vfs URIs", () => {
    const doc = fakeDoc(
      "vscode-vfs://github/CoopAI-Corp/plane/apps/api/plane/app/serializers/project.py"
    );
    assert.equal(
      documentMatchesPatchPath(doc, "apps/api/plane/app/serializers/project.py"),
      true
    );
    assert.equal(documentMatchesPatchPath(doc, "apps/api/plane/other.py"), false);
  });

  await test("documentMatchesPatchPath matches github vfs URIs with ref query", () => {
    const doc = fakeDoc(
      "vscode-vfs://github/coop-ai/plane/apps/api/plane/db/models/state.py?ref=preview"
    );
    assert.equal(
      documentMatchesPatchPath(doc, "apps/api/plane/db/models/state.py"),
      true
    );
  });

  await test("undo snapshot round-trips remote URIs", () => {
    const uri = vscode.Uri.parse(
      "vscode-vfs://github/CoopAI-Corp/plane/apps/api/plane/app/serializers/project.py"
    );
    const stored = undoSnapshotPathForUri(uri);
    assert.match(stored, /^vscode-vfs:/);
    assert.equal(uriFromUndoSnapshotPath(stored).toString(), uri.toString());
  });

  await test("undo snapshot keeps local fs paths", () => {
    const uri = vscode.Uri.file("/Users/me/proj/src/foo.ts");
    const stored = undoSnapshotPathForUri(uri);
    assert.equal(stored, uri.fsPath);
    assert.equal(uriFromUndoSnapshotPath(stored).fsPath, uri.fsPath);
  });

  await test("undo snapshot round-trips untitled API buffers", () => {
    const uri = vscode.Uri.parse("untitled:Untitled-1");
    const stored = undoSnapshotPathForUri(uri);
    assert.match(stored, /^untitled:/);
    const restored = uriFromUndoSnapshotPath(stored);
    assert.equal(restored.scheme, "untitled");
    assert.notEqual(restored.scheme, "file");
    assert.equal(restored.toString().includes("file:"), false);
  });

  await test("findOpenDocumentForPatchFile matches untitled API buffers by captured bytes", () => {
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    const body = '    {\n        "name": "In Progress",\n    },';
    const untitled = fakeDoc("untitled:Untitled-1", body);
    (vscode.workspace.textDocuments as unknown as vscode.TextDocument[]).push(untitled);
    const found = findOpenDocumentForPatchFile("apps/api/plane/db/models/state.py", {
      capturedContent: body
    });
    assert.equal(found?.uri.toString(), "untitled:Untitled-1");
  });

  await test("ensureEditablePatchTarget applies from captured bytes when GitHub VFS is unavailable", async () => {
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    const body = "const x = 1;\n";
    const result = await ensureEditablePatchTarget("src/foo.ts", {
      repo: { owner: "acme", repo: "demo", provider: "github" },
      openRemoteFile: async () => false,
      fileContents: { "src/foo.ts": body }
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.target.readText(), body);
    assert.equal(result.target.uri.scheme, "untitled");
  });

  await test("collectOpenPatchFileBytes reads a remembered untitled API buffer", () => {
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    clearRemotePatchBuffersForTests();
    const body = [
      "class StateGroup(models.TextChoices):",
      '    BACKLOG = "backlog", "Backlog"',
      '    TRIAGE = "triage", "Triage"'
    ].join("\n");
    const untitled = fakeDoc("untitled:Untitled-2", body);
    (vscode.workspace.textDocuments as unknown as vscode.TextDocument[]).push(untitled);
    rememberRemotePatchBuffer("apps/api/plane/db/models/state.py", untitled.uri, body);
    assert.equal(
      collectOpenPatchFileBytes("apps/api/plane/db/models/state.py"),
      body
    );
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    clearRemotePatchBuffersForTests();
  });

  await test("collectOpenPatchFileBytes finds an untitled tab by unique SEARCH", () => {
    (vscode.workspace.textDocuments as unknown[]).length = 0;
    clearRemotePatchBuffersForTests();
    const body = "class StateGroup(models.TextChoices):\n    BACKLOG = \"backlog\", \"Backlog\"\n";
    const untitled = fakeDoc("untitled:Untitled-3", body);
    (vscode.workspace.textDocuments as unknown as vscode.TextDocument[]).push(untitled);
    assert.equal(
      collectOpenPatchFileBytes("apps/api/plane/db/models/state.py", {
        search: "class StateGroup(models.TextChoices):"
      }),
      body
    );
    (vscode.workspace.textDocuments as unknown[]).length = 0;
  });

  console.log(`\npatchTarget: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  documentMatchesPatchPath,
  undoSnapshotPathForUri,
  uriFromUndoSnapshotPath
} from "./patchTarget";

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

function fakeDoc(uriString: string): vscode.TextDocument {
  const uri = vscode.Uri.parse(uriString);
  return {
    uri,
    getText: () => "content",
    lineCount: 1,
    lineAt: () => ({ text: "content" })
  } as unknown as vscode.TextDocument;
}

test("documentMatchesPatchPath matches github vfs URIs", () => {
  const doc = fakeDoc(
    "vscode-vfs://github/CoopAI-Corp/plane/apps/api/plane/app/serializers/project.py"
  );
  assert.equal(
    documentMatchesPatchPath(doc, "apps/api/plane/app/serializers/project.py"),
    true
  );
  assert.equal(documentMatchesPatchPath(doc, "apps/api/plane/other.py"), false);
});

test("documentMatchesPatchPath matches github vfs URIs with ref query", () => {
  const doc = fakeDoc(
    "vscode-vfs://github/coop-ai/plane/apps/api/plane/db/models/state.py?ref=preview"
  );
  assert.equal(
    documentMatchesPatchPath(doc, "apps/api/plane/db/models/state.py"),
    true
  );
});

test("undo snapshot round-trips remote URIs", () => {
  const uri = vscode.Uri.parse(
    "vscode-vfs://github/CoopAI-Corp/plane/apps/api/plane/app/serializers/project.py"
  );
  const stored = undoSnapshotPathForUri(uri);
  assert.match(stored, /^vscode-vfs:/);
  assert.equal(uriFromUndoSnapshotPath(stored).toString(), uri.toString());
});

test("undo snapshot keeps local fs paths", () => {
  const uri = vscode.Uri.file("/Users/me/proj/src/foo.ts");
  const stored = undoSnapshotPathForUri(uri);
  assert.equal(stored, uri.fsPath);
  assert.equal(uriFromUndoSnapshotPath(stored).fsPath, uri.fsPath);
});

console.log(`\npatchTarget: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

import assert from "node:assert/strict";
import * as vscode from "vscode";
import { applyPatchesToWorkspace, findOpenDocumentForPatchPath } from "./patchApplier";

type MutableVscode = {
  workspace: {
    textDocuments: vscode.TextDocument[];
    workspaceFolders: Array<{ uri: { fsPath: string } }>;
    asRelativePath: (uri: vscode.Uri, includeWorkspaceFolder?: boolean) => string;
    getWorkspaceFolder: (uri: vscode.Uri) => { uri: { fsPath: string } } | undefined;
    applyEdit: (edit: vscode.WorkspaceEdit) => Thenable<boolean>;
  };
  window: {
    activeTextEditor?: vscode.TextEditor;
    visibleTextEditors: vscode.TextEditor[];
    tabGroups: { all: Array<{ tabs: Array<{ input: unknown }> }> };
  };
};

const api = vscode as unknown as MutableVscode;

function document(uri: {
  scheme: string;
  value: string;
  fsPath?: string;
  content?: string;
}): vscode.TextDocument {
  return {
    isUntitled: false,
    getText: () => uri.content ?? "",
    uri: {
      scheme: uri.scheme,
      fsPath: uri.fsPath ?? "",
      toString: () => uri.value
    }
  } as vscode.TextDocument;
}

const workspaceLocal = document({
  scheme: "file",
  value: "file:///Users/jon/Desktop/Coop%20AI/src/example.ts",
  fsPath: "/Users/jon/Desktop/Coop AI/src/example.ts",
  content: "const value = 1;\n"
});
const homeClone = document({
  scheme: "file",
  value: "file:///Users/jon/Coop-AI/src/example.ts",
  fsPath: "/Users/jon/Coop-AI/src/example.ts",
  content: "const value = 9;\n"
});
const remote = document({
  scheme: "vscode-vfs",
  value: "vscode-vfs://github/acme/app/src/example.ts",
  content: "const value = 1;\n"
});

api.workspace.workspaceFolders = [{ uri: { fsPath: "/Users/jon/Desktop/Coop AI" } }];
api.workspace.textDocuments = [workspaceLocal, homeClone, remote];
api.workspace.asRelativePath = (uri) => {
  if (uri.toString() === workspaceLocal.uri.toString()) {
    return "src/example.ts";
  }
  if (uri.toString() === homeClone.uri.toString()) {
    return "../Coop-AI/src/example.ts";
  }
  return uri.toString();
};
api.workspace.getWorkspaceFolder = (uri) => {
  if (uri.toString() === workspaceLocal.uri.toString()) {
    return api.workspace.workspaceFolders[0];
  }
  return undefined;
};
api.window.tabGroups = { all: [] };
api.window.activeTextEditor = { document: homeClone } as vscode.TextEditor;
api.window.visibleTextEditors = [
  { document: homeClone } as vscode.TextEditor,
  { document: remote } as vscode.TextEditor
];

assert.equal(
  findOpenDocumentForPatchPath("src/example.ts", remote.uri.toString())?.uri.toString(),
  remote.uri.toString(),
  "the exact remote tab captured at /edit submission must beat a same-path local clone"
);

assert.equal(
  findOpenDocumentForPatchPath("src/example.ts", undefined, "remote")?.uri.toString(),
  remote.uri.toString(),
  "remote provenance must never capture a same-path local clone"
);

assert.equal(
  findOpenDocumentForPatchPath("src/example.ts", undefined, "local")?.uri.toString(),
  workspaceLocal.uri.toString(),
  "workspace folder tab must beat a same-path home clone"
);

assert.equal(
  findOpenDocumentForPatchPath("src/example.ts", workspaceLocal.uri.toString())?.uri.toString(),
  workspaceLocal.uri.toString(),
  "preferred URI short-circuits without relative re-check"
);

api.window.activeTextEditor = { document: remote } as vscode.TextEditor;
api.window.visibleTextEditors = [{ document: remote } as vscode.TextEditor];
assert.equal(
  findOpenDocumentForPatchPath("src/example.ts")?.uri.toString(),
  remote.uri.toString(),
  "an active vscode-vfs editor must be a valid patch target"
);

async function testApplyUsesRemoteUriWithoutOpeningLocalDocument(): Promise<void> {
  const replacements: Array<{ uri: vscode.Uri; text: string }> = [];
  api.workspace.applyEdit = async (edit) => {
    const recorded = edit as unknown as {
      replacements: Array<{ uri: vscode.Uri; text: string }>;
    };
    replacements.push(...recorded.replacements);
    return true;
  };

  const result = await applyPatchesToWorkspace(
    {
      files: [
        {
          relativePath: "src/example.ts",
          hunks: [{ search: "const value = 1;", replace: "const value = 2;" }]
        }
      ]
    },
    remote.uri.toString()
  );

  assert.equal(result.ok, true);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0]?.uri.toString(), remote.uri.toString());
  assert.equal(replacements[0]?.text, "const value = 2;\n");
}

async function testApplyRefusesClosedPreferredLocalTab(): Promise<void> {
  api.workspace.textDocuments = [homeClone];
  const result = await applyPatchesToWorkspace(
    {
      files: [
        {
          relativePath: "src/example.ts",
          hunks: [{ search: "const value = 9;", replace: "const value = 3;" }]
        }
      ]
    },
    workspaceLocal.uri.toString()
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /no longer open/i);
  }
}

void testApplyUsesRemoteUriWithoutOpeningLocalDocument()
  .then(() => testApplyRefusesClosedPreferredLocalTab())
  .then(() => console.log("patchTarget.test.ts: ok"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

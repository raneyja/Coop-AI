import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import { createRequire } from "node:module";
import { clearRemotePatchBuffersForTests, remoteIdentityForUntitledUri } from "../context/remoteViewBuffer";

type ReviewHarness = {
  currentContext: { provider: string; owner: string; repo: string; branch: string; scope: string };
  intentDebouncer: { cancelAll(): void };
  isWorkingOnRemoteProvenance(): boolean;
  openRemoteFileFromApi(path: string, line: number, options: { preserveFocus: boolean; reviewOpen: boolean; endLine?: number }): Promise<boolean>;
  openRepoFileForReview(path: string, line: number, endLine?: number): Promise<void>;
};

async function run(): Promise<void> {
  for (const provider of ["github", "gitlab", "bitbucket"]) {
    for (const available of [true, false]) {
      const session = Object.create(CoopChatSession.prototype) as ReviewHarness;
      session.currentContext = { provider, owner: "org", repo: "repo", branch: "preview", scope: "repo" };
      session.intentDebouncer = { cancelAll() {} };
      session.isWorkingOnRemoteProvenance = () => true;
      let reads = 0;
      session.openRemoteFileFromApi = async (path, line, options) => {
        reads++;
        assert.equal(path, "src/handler.ts");
        assert.equal(line, 234);
        assert.equal(session.currentContext.branch, "preview");
        assert.deepEqual(options, { preserveFocus: true, reviewOpen: true, endLine: 240 });
        return available;
      };
      // The VS Code stub has no VFS provider: a fallback after API failure throws.
      await session.openRepoFileForReview("src/handler.ts", 234, 240);
      assert.equal(reads, 1);
      assert.equal(session.currentContext.scope, "repo");
    }
  }
  const session = Object.create(CoopChatSession.prototype) as any;
  const editor = {
    document: { lineCount: 264, lineAt: (line: number) => ({range: {end: {line, character: 5}}}) },
    selection: undefined as any,
    revealRange() {}
  };
  session.revealLineInEditor(editor, 203, 208);
  assert.equal(editor.selection.start.line, 202);
  assert.equal(editor.selection.end.line, 207);
  session.revealLineInEditor(editor, 203, 208);
  assert.equal(editor.selection.end.line, 207, "repeated citation opens retain the exact range");
  session.revealLineInEditor(editor, 203, 531);
  assert.equal(editor.selection.end.line, 263, "revealed ranges cannot exceed the actual document");
  const vscode = createRequire(import.meta.url)("vscode");
  const originalWorkspace = {...vscode.workspace};
  const originalWindow = {...vscode.window};
  clearRemotePatchBuffersForTests();
  try {
    const documents: any[] = [];
    const columns: number[] = [];
    const branches: string[] = [];
    vscode.workspace.textDocuments = documents;
    vscode.window.visibleTextEditors = [];
    vscode.workspace.openTextDocument = async ({content}: {content: string}) => {
      const doc = { uri: {toString: () => `untitled:test-${documents.length}`},
        getText: () => content, isClosed: false, lineCount: 3,
        lineAt: (line: number) => ({range: {end: {line, character: 1}}}) };
      documents.push(doc); return doc;
    };
    vscode.window.showTextDocument = async (document: any, options: {viewColumn: number}) => {
      columns.push(options.viewColumn);
      const editor = {document, viewColumn: 4, revealRange() {}, selection: undefined};
      vscode.window.visibleTextEditors = [editor]; return editor;
    };
    const apiSession = Object.assign(Object.create(CoopChatSession.prototype), {
      currentContext: {provider: "gitlab", owner: "org", repo: "repo", branch: "preview"},
      preferences: {defaultCodeHost: "github"},
      options: {codeHostRouter: {getFileContent: async (_path: string, target: any) => {
        assert.equal(target.provider, "gitlab"); branches.push(target.branch);
        return {content: "a\nb\nc", lines: []};
      }}}
    });
    assert.equal(await apiSession.openRemoteFileFromApi("src/auth.ts", 2, {reviewOpen: true, endLine: 3}), true);
    assert.equal(await apiSession.openRemoteFileFromApi("src/auth.ts", 2, {reviewOpen: true, endLine: 3}), true);
    assert.equal(documents.length, 1, "repeat opens reuse exact verified file bytes");
    assert.equal(columns[1], 4, "repeat opens reuse the visible editor group");
    assert.equal(remoteIdentityForUntitledUri(documents[0].uri.toString())?.branch, "preview");
    apiSession.currentContext.branch = "main";
    assert.equal(await apiSession.openRemoteFileFromApi("src/auth.ts", 2, {reviewOpen: true}), true);
    assert.equal(documents.length, 2, "a different ref gets a separate viewing buffer even if bytes match");
    assert.deepEqual(branches, ["preview", "preview", "main"]);
  } finally {
    Object.assign(vscode.workspace, originalWorkspace);
    Object.assign(vscode.window, originalWindow);
    clearRemotePatchBuffersForTests();
  }
  console.log("remote citation review uses selected-ref API and fails closed across providers");
}

void run().catch((error) => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import * as vscode from "vscode";
import { rememberRemotePatchBuffer } from "../context/remoteViewBuffer";
import { emptyChatIntentPlan } from "./intentPlanner/types";

async function run(): Promise<void> {
  let answerCalls = 0;
  const answerTurn = { id: "answer-turn", threadId: "answer-thread", startedAt: Date.now(),
    context: { owner: "fixture", repo: "remote", branch: "preview" } };
  const answerSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { owner: "wrong", repo: "other", branch: "other" }, preferences: { maxTokens: 1000 },
    buildProjectInstructionsBlock: async (context: unknown) => { assert.deepEqual(context, answerTurn.context); return undefined; },
    options: { api: { streamChat: async (request: { message: string; context: unknown; history?: Array<{content: string}> }) => {
      assert.deepEqual(request.context, answerTurn.context);
      if (answerCalls++ === 0) {
        assert.ok(request.message.includes("captured-source"));
        return { message: {content: "First part"}, finishReason: "length" };
      }
      assert.ok(request.history?.some((entry) => entry.content.includes("captured-source")), "continuation retains captured body outside summarized tool history");
      return { message: {content: " completed"}, finishReason: "stop" };
    } } }
  });
  assert.equal(await answerSession.streamAgentAnswer({ message: "Explain source", repoId: "github:fixture/remote", conversation: [],
    attachedFiles: [{path: "src/oracle.ts", content: "captured-source", lineRange: [10,10]}]
  }, {model: "fixture", provider: "openai"}, "chat", () => {}, undefined, answerTurn.threadId, answerTurn), "First part completed");
  assert.equal(answerCalls, 2);
  const originalDocumentsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "textDocuments");
  let workspaceConsulted = false;
  Object.defineProperty(vscode.workspace, "textDocuments", { configurable: true, get() { workspaceConsulted = true; throw new Error("remote anchor must not consult same-path workspace buffers"); } });
  try {
    const remoteTurn = { context: { file: "src/isolated.ts", fileSource: "remote", owner: "fixture", repo: "remote", provider: "github", branch: "preview" }, editAnchor: undefined as unknown };
    const snapshotSession = Object.assign(Object.create(CoopChatSession.prototype), {
      preferences: { branch: "other" },
      pendingChatLocalFiles: { source: "local-workspace", activeFile: "src/isolated.ts", files: [{ path: "src/isolated.ts", content: "wrong-local" }] },
      selectedCodeSnippet: () => undefined,
      indexedRepoWorkspace: () => ({ readFile: async (target: { branch?: string }) => {
        assert.equal(target.branch, "preview"); return { content: "correct-remote" };
      } })
    });
    remoteTurn.editAnchor = snapshotSession.captureEditAnchor(remoteTurn);
    assert.equal((remoteTurn.editAnchor as {fileContents?: unknown}).fileContents, undefined);
    await snapshotSession.loadEditAnchorFile(remoteTurn);
    assert.equal((remoteTurn.editAnchor as {fileContents: Record<string,string>}).fileContents["src/isolated.ts"], "correct-remote");
    assert.equal(workspaceConsulted, false);
  } finally {
    if (originalDocumentsDescriptor) Object.defineProperty(vscode.workspace, "textDocuments", originalDocumentsDescriptor);
    else delete (vscode.workspace as unknown as {textDocuments?: unknown}).textDocuments;
  }
  for (const mode of ["missing", "open", "stop"] as const) {
    let active = true;
    let calls = 0;
    let finishLoad!: () => void;
    const controller = new AbortController();
    const turn = { id: "captured-turn", threadId: "captured-thread", streamGeneration: 1,
      startedAt: Date.now(), streamAbort: controller, clearResponseDeadline() {},
      context: { provider: "github", owner: "fixture", repo: "remote", branch: "preview", file: "src/oracle.ts", fileSource: "remote" },
      editAnchor: { file: "src/oracle.ts", fileContents: mode === "open" ? { "src/oracle.ts": "captured-old" } : {} },
      editAnchorLoad: undefined as Promise<void> | undefined, intentPlan: emptyChatIntentPlan("Explain this source"), allowsRepoTools: false
    };
    turn.editAnchorLoad = new Promise<void>((resolve) => { finishLoad = () => { turn.editAnchor.fileContents["src/oracle.ts"] = "captured-old"; resolve(); }; });
    const agentSession = Object.assign(Object.create(CoopChatSession.prototype), {
      currentContext: { owner: "other", repo: "latest", branch: "other" },
      pendingChatLocalFiles: { files: [{ path: "src/oracle.ts", content: "mutable-new" }] },
      preferences: { defaultCodeHost: "github", model: "Auto" },
      threadRuns: { isStreamActive: () => active, markError() { throw new Error("unexpected agent error"); } },
      synthesisActivityMessages: () => [], postKeepAliveActivity() {},
      createChatDeltaBatcher: () => ({ dispose() {}, push() {} }),
      blockIfFreeQuotaExhausted: async () => false, listConnectedIntegrationTools: () => [],
      isViewingThread: () => false,
      options: { agentOrchestrator: { run: async (_request: unknown, options: { capturedAttachment?: { repoId: string; branch?: string; files: Array<{content: string}> } }) => {
        calls++;
        assert.equal(options.capturedAttachment?.files[0].content, "captured-old");
        assert.equal(options.capturedAttachment?.repoId, "github:fixture/remote");
        assert.equal(options.capturedAttachment?.branch, "preview");
        active = false;
        return { steps: [] };
      } } }
    });
    const execution = agentSession.runAgentOwnedTurn(turn, "Explain this source");
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (mode !== "open") assert.equal(calls, 0, "agent must wait for its existing snapshot load");
    if (mode === "stop") { active = false; controller.abort(); }
    if (mode !== "open") finishLoad();
    await execution;
    assert.equal(calls, mode === "stop" ? 0 : 1);
  }
  const uri = { scheme: "untitled", path: "/selection-fixture", toString: () => "untitled:selection-fixture" };
  rememberRemotePatchBuffer("src/auth.ts", uri as vscode.Uri, "export function parser() {}", {
    provider: "gitlab", owner: "org", repo: "coop", branch: "preview"
  });
  const editor = {
    document: { uri, languageId: "typescript", lineCount: 30, getWordRangeAtPosition: () => undefined },
    selection: { isEmpty: false, start: {line: 9, character: 0}, end: {line: 17, character: 0} }
  } as vscode.TextEditor;
  const originalEditor = vscode.window.activeTextEditor;
  const originalTabGroups = vscode.window.tabGroups;
  const originalVisible = vscode.window.visibleTextEditors;
  const selectionSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: {}, preferences: {owner: "", repo: "", branch: ""}
  });
  try {
    (vscode.window as {tabGroups: unknown}).tabGroups = {all: []};
    (vscode.window as {activeTextEditor: vscode.TextEditor | undefined}).activeTextEditor = editor;
    const captured = selectionSession.captureNewChatSelection();
    assert.deepEqual(captured.selectedLines, [10, 17]);
    assert.equal(captured.file, "src/auth.ts");
    assert.equal(captured.provider, "gitlab");
    assert.equal(captured.branch, "preview");
    assert.equal(captured.fileSource, "remote");
    assert.deepEqual(selectionSession.currentContext, {}, "capturing a new panel must not change the origin thread");
    (vscode.window as {activeTextEditor: vscode.TextEditor | undefined}).activeTextEditor = undefined;
    (vscode.window as {visibleTextEditors: vscode.TextEditor[]}).visibleTextEditors = [editor];
    assert.deepEqual(selectionSession.captureNewChatSelection().selectedLines, [10, 17], "toolbar focus keeps the single explicit visible selection");
    (vscode.window as {visibleTextEditors: vscode.TextEditor[]}).visibleTextEditors = [editor, {...editor}];
    assert.equal(selectionSession.captureNewChatSelection(), undefined, "ambiguous visible selections cannot be guessed");
    (vscode.window as {visibleTextEditors: vscode.TextEditor[]}).visibleTextEditors = [editor];
    editor.selection = {...editor.selection, isEmpty: true} as vscode.Selection;
    assert.equal(selectionSession.captureNewChatSelection(), undefined, "passive open files cannot seed New chat");
  } finally {
    (vscode.window as {visibleTextEditors: readonly vscode.TextEditor[]}).visibleTextEditors = originalVisible;
    (vscode.window as {tabGroups: unknown}).tabGroups = originalTabGroups;
    (vscode.window as {activeTextEditor: vscode.TextEditor | undefined}).activeTextEditor = originalEditor;
  }
  const events: string[] = [];
  const context = { provider: "gitlab", owner: "org", repo: "coop", branch: "main", scope: "repo" };
  const repoSendSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { ...context }, allowPassiveEditorSnap: true,
    preferences: {}, postContext() { throw new Error("repo-only send must not attach a leftover editor"); }
  });
  repoSendSession.snapEditorContextBeforeSend();
  repoSendSession.snapEditorContextBeforeSend({allowLocalFileForEdit: true, preferRemoteForEdit: true});
  assert.deepEqual(repoSendSession.currentContext, context, "explicit repo selection survives normal and edit sends without a target file");
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: {}, contextEpoch: 0, chatHistory: [], threadRuns: { get() { return undefined; } },
    setThreadTitle() {}, post(message: { type: string }) { events.push(message.type); },
    postChatHistory() { events.push("history"); }, pushThreadsList() {},
    async restoreContextForActivatedThread() { this.currentContext = context; events.push("restore"); },
    postContext() { events.push("context"); }
  });
  session.activateThread({ id: "coop-thread", title: "auth", messages: [], artifacts: [], sessionCostUsd: 0 });
  assert.equal(session.currentContext, context, "identity restored before next send can snapshot it");
  await Promise.resolve();
  assert.deepEqual(events, ["restore", "chat:thread-changed", "history", "context"], "ready context follows thread reset");
  let active = true;
  let finishGrounding!: () => void;
  const written: string[] = [];
  const cancelledSession = Object.assign(Object.create(CoopChatSession.prototype), {
    threadRuns: { isStreamActive: () => active },
    groundAssistantCitationFences: () => new Promise<string>(resolve => {
      finishGrounding = () => resolve("Late grounded answer");
    }),
    isViewingThread: () => true,
    chatHistory: { push: () => written.push("history") },
    post: () => written.push("complete"),
    persistActiveThread: () => written.push("persist")
  });
  const finishing = cancelledSession.finishTurnAssistantMessage(
    { id: "stopped", context, threadId: "origin" },
    { role: "assistant", content: "Late answer", timestamp: 1 }
  );
  active = false;
  finishGrounding();
  await finishing;
  assert.deepEqual(written, [], "Stop during citation grounding prevents late persistence and completion");
  const patchSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { file: "other.ts", selectedLines: [50, 60] },
    pendingChatLocalFiles: { files: [{path: "other.ts", content: "other turn"}] }
  });
  const patchContext = patchSession.patchCompleteContext({
    context: { file: "origin.ts", selectedLines: [1, 2] },
    editAnchor: {file: "origin.ts", selectedLines: [1, 2], fileContents: {"origin.ts": "const x = 1;\nreturn x;"}},
    history: [], modelMessage: "rename x to value"
  });
  assert.equal(patchContext.file, "origin.ts");
  assert.deepEqual(patchContext.selectedLines, [1, 2]);
  assert.equal(patchContext.fileContents["other.ts"], undefined, "another turn's attachments cannot enter this patch");
  const attached = await patchSession.resolveChatLocalFiles({
    context: { file: "origin.ts", fileSource: "remote", owner: "org", repo: "repo" },
    editAnchor: { file: "origin.ts", fileContents: {"origin.ts": "const x = 1;\nreturn x;"} }
  });
  assert.equal(attached.activeFile, "origin.ts");
  assert.equal(attached.files[0].content, "const x = 1;\nreturn x;");
  assert.equal(attached.source, "remote-codehost");
  let readIdentity: unknown;
  const remoteSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { owner: "other", repo: "later", provider: "github", branch: "wrong" },
    preferences: {},
    indexedRepoWorkspace: () => ({
      readFile: async (identity: unknown, path: string) => {
        readIdentity = identity;
        assert.equal(path, "src/parser.ts");
        return {content: "export function parser() {}"};
      }
    })
  });
  const sut = await remoteSession.fetchRemotePathContent("src/parser.ts", {
    owner: "origin", repo: "repo", provider: "gitlab", branch: "preview"
  });
  assert.equal(sut, "export function parser() {}");
  assert.deepEqual(readIdentity, {
    owner: "origin", repo: "repo", provider: "gitlab", branch: "preview", repoId: "gitlab:origin/repo"
  });
  const updatedThreads: Array<{id: string; messages: Array<{patchCard?: {status: string}}>}> = [];
  const decisionSession = Object.assign(Object.create(CoopChatSession.prototype), {
    post() {},
    chatHistory: [{role: "assistant", content: "patch", timestamp: 1}],
    threadStore: {
      listAllThreads: () => [
        {id: "origin", messages: [{role: "assistant", content: "patch", timestamp: 1}], artifacts: [], title: "origin"},
        {id: "later", messages: [{role: "assistant", content: "other", timestamp: 2}], artifacts: [], title: "later"}
      ],
      setThread: (id: string, messages: Array<{patchCard?: {status: string}}>) => updatedThreads.push({id, messages})
    }
  });
  decisionSession.postPatchUpdate({cards: [{messageTimestamp: 1, status: "rejected", fileCount: 0, hunkCount: 0, files: []}]});
  assert.equal(updatedThreads.length, 1, "a patch decision must not rewrite a different thread");
  assert.equal(updatedThreads[0].id, "origin");
  assert.equal(updatedThreads[0].messages[0].patchCard?.status, "rejected");
  assert.equal(decisionSession.chatHistory[0].patchCard?.status, "rejected", "next turn sees the decision without reloading");
  console.log("thread activation identity and readiness ordering passed");
}
void run().catch(error => { console.error(error); process.exitCode = 1; });

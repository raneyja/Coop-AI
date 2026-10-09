import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import * as vscode from "vscode";
import { rememberRemotePatchBuffer } from "../context/remoteViewBuffer";
import { emptyChatIntentPlan } from "./intentPlanner/types";
import { readFileAssistantEditorForChat, findOpenFileAssistantDocument } from "../context/editorFileContext";
import { requestedFilesNeedRepoSelection } from "../api/agent/requestedRepoFiles";

async function run(): Promise<void> {
  const compound = "Read root AGENTS.md and state appDirectory in /apps/remix/react-router.config.ts.";
  const targetlessChip = { file: "apps/remix/react-router.config.ts", fileSource: "remote" };
  assert.equal(requestedFilesNeedRepoSelection(compound, targetlessChip), true);
  assert.equal(requestedFilesNeedRepoSelection("Read /apps/remix/react-router.config.ts.", targetlessChip), false);
  assert.equal(requestedFilesNeedRepoSelection(compound, { ...targetlessChip, owner: "fixture", repo: "remote" }), false);
  assert.equal(requestedFilesNeedRepoSelection(compound, { ...targetlessChip, fileSource: "external" }), false);
  const repoOnlyResult = { type: "chat_context", data: {} };
  const repoOnlySession = Object.assign(Object.create(CoopChatSession.prototype), {
    integrationContextText: () => { throw new Error("repo-only cannot begin integration gathering"); }
  });
  assert.equal(await repoOnlySession.enrichChatContextWithIntegrations(repoOnlyResult, {
    type: "chat_context", params: { sourceScope: { repositoryOnly: true, excludedIntegrations: [] } },
    intent: { context: { queryText: "rewritten docs query" } }
  }), repoOnlyResult);
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
      buildProjectInstructionsBlock: async () => undefined,
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
  const originalFolderResolver = vscode.workspace.getWorkspaceFolder;
  try {
    (vscode.workspace as {getWorkspaceFolder: unknown}).getWorkspaceFolder = () => ({uri:{fsPath:"/fixture"}});
    (vscode.window as {activeTextEditor: vscode.TextEditor | undefined}).activeTextEditor = {
      document:{uri:{scheme:"file",fsPath:"/fixture/src/selected.ts",path:"/fixture/src/selected.ts"},languageId:"typescript",getWordRangeAtPosition:()=>undefined},
      selection:{isEmpty:false,start:{line:1,character:0},end:{line:3,character:0}}
    } as vscode.TextEditor;
    (vscode.window as {tabGroups: unknown}).tabGroups = {all:[]};
    (vscode.window as {visibleTextEditors: vscode.TextEditor[]}).visibleTextEditors = [];
    const localSelectionSession = Object.assign(Object.create(CoopChatSession.prototype), {
      currentContext:{owner:"remote",repo:"previous",scope:"repo"}, preferences:{}
    });
    const chosen = localSelectionSession.captureNewChatSelection();
    assert.equal(chosen?.file,"src/selected.ts");
    assert.equal(chosen?.fileSource,"workspace");
    assert.deepEqual(chosen?.selectedLines,[2,3]);
    assert.equal(localSelectionSession.currentContext.scope,"repo","explicit new-chat capture does not mutate the prior chat");
  } finally {
    (vscode.workspace as {getWorkspaceFolder: unknown}).getWorkspaceFolder = originalFolderResolver;
    (vscode.window as {activeTextEditor: vscode.TextEditor | undefined}).activeTextEditor = originalEditor;
    (vscode.window as {tabGroups: unknown}).tabGroups = originalTabGroups;
    (vscode.window as {visibleTextEditors: readonly vscode.TextEditor[]}).visibleTextEditors = originalVisible;
  }
  let explicitPicks = 0;
  const originalDocuments = Object.getOwnPropertyDescriptor(vscode.workspace, "textDocuments");
  try {
    (vscode.workspace as {getWorkspaceFolder: unknown}).getWorkspaceFolder = () => ({uri:{fsPath:"/fixture"}});
    const hiddenUri = {scheme:"file",fsPath:"/fixture/src/selected.ts",path:"/fixture/src/selected.ts",toString:()=>"file:///fixture/src/selected.ts"} as vscode.Uri;
    const hiddenDoc = {uri:hiddenUri,isClosed:false,getText:()=>"unsaved selected buffer\nsecond line"} as vscode.TextDocument;
    Object.defineProperty(vscode.workspace,"textDocuments",{configurable:true,value:[hiddenDoc]});
    (vscode.window as {activeTextEditor: unknown}).activeTextEditor = undefined;
    (vscode.window as {visibleTextEditors: unknown}).visibleTextEditors = [];
    (vscode.window as {tabGroups: unknown}).tabGroups = {all:[{tabs:[{input:new vscode.TabInputText(hiddenUri)}]}]};
    const hiddenSession = Object.assign(Object.create(CoopChatSession.prototype), {
      currentContext:{file:"src/selected.ts",fileSource:"workspace",scope:"file",selectedLines:[1,2]},
      allowPassiveEditorSnap:false,editorContextSuppressedUntil:0,preferences:{},
      postContext(){},refreshEditorContext(){}
    });
    hiddenSession.reconcileEditorFileChips();
    assert.equal(hiddenSession.currentContext.file,"src/selected.ts","a hidden but open tab retains the explicit file chip");
    assert.equal(readFileAssistantEditorForChat(hiddenSession.currentContext)?.files[0].content,"unsaved selected buffer\nsecond line","hidden open tab reads live unsaved body, not disk");
    assert.equal(findOpenFileAssistantDocument("src/unrelated.ts"),undefined);
    const openDocumentBefore = vscode.workspace.openTextDocument;
    try {
      Object.defineProperty(vscode.workspace,"textDocuments",{configurable:true,value:[]});
      hiddenSession.reconcileEditorFileChips();
      assert.equal(hiddenSession.currentContext.file,"src/selected.ts","cold restored tab need not be loaded yet");
      (vscode.workspace as {openTextDocument:unknown}).openTextDocument = async (requested:vscode.Uri) => {
        assert.equal(requested.toString(),hiddenUri.toString()); return hiddenDoc;
      };
      const restoredTurn = {context:{file:"src/selected.ts",fileSource:"workspace"},editAnchor:{file:"src/selected.ts",fileContents:{}}};
      await hiddenSession.loadEditAnchorFile(restoredTurn);
      assert.equal(restoredTurn.editAnchor.fileContents["src/selected.ts"],hiddenDoc.getText(),"reload reads only the attached open tab");
    } finally {
      (vscode.workspace as {openTextDocument:unknown}).openTextDocument = openDocumentBefore;
    }
    Object.defineProperty(vscode.workspace,"textDocuments",{configurable:true,value:[hiddenDoc,{...hiddenDoc}]});
    assert.equal(findOpenFileAssistantDocument("src/selected.ts"),undefined,"ambiguous same-path documents cannot be guessed");
    Object.defineProperty(vscode.workspace,"textDocuments",{configurable:true,value:[hiddenDoc]});
    (vscode.window as {tabGroups: unknown}).tabGroups = {all:[]};
    assert.equal(readFileAssistantEditorForChat(hiddenSession.currentContext),undefined,"loaded document with a closed tab is not an attachment");
    hiddenSession.reconcileEditorFileChips();
    assert.equal(hiddenSession.currentContext.file,undefined,"a truly closed local tab clears its chip");
  } finally {
    if(originalDocuments) Object.defineProperty(vscode.workspace,"textDocuments",originalDocuments);
    else delete (vscode.workspace as {textDocuments?:unknown}).textDocuments;
    (vscode.workspace as {getWorkspaceFolder: unknown}).getWorkspaceFolder = originalFolderResolver;
    (vscode.window as {activeTextEditor: unknown}).activeTextEditor = originalEditor;
    (vscode.window as {visibleTextEditors: unknown}).visibleTextEditors = originalVisible;
    (vscode.window as {tabGroups: unknown}).tabGroups = originalTabGroups;
  }
  const remotePickSession = Object.assign(Object.create(CoopChatSession.prototype), {
    sessionHydrated: true, allowPassiveEditorSnap: false, editorContextSuppressedUntil: Date.now() + 10_000,
    currentContext: {owner: "org", repo: "coop", provider: "gitlab", branch: "preview", scope: "repo"}, preferences: {},
    resolveEditorForContextRefresh: () => editor, stampLiveEditorSelection() {},
    isWorkingOnRemoteProvenance: () => false,
    intentDetector: {detectEditorIntent: () => "selection", create: (_intent: unknown, context: {file:string;fileSource:string}) => {
      assert.equal(context.file, "src/auth.ts"); assert.equal(context.fileSource, "remote"); explicitPicks++; return {context};
    }}, intentDebouncer: {debounce: async () => {}}
  });
  try {
    (vscode.window as {tabGroups: unknown}).tabGroups = {all: []};
    (vscode.window as {visibleTextEditors: vscode.TextEditor[]}).visibleTextEditors = [];
    remotePickSession.refreshEditorContext(editor);
    assert.equal(explicitPicks, 0, "a passive remote tab cannot steal a fresh repo-only chat");
    remotePickSession.refreshEditorContext(editor, {userActivatedEditor: true});
    assert.equal(explicitPicks, 1, "explicit remote selection must chip even with passive snapping off");
  } finally {
    (vscode.window as {tabGroups: unknown}).tabGroups = originalTabGroups;
    (vscode.window as {visibleTextEditors: readonly vscode.TextEditor[]}).visibleTextEditors = originalVisible;
  }
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
  const ranged = await patchSession.resolveChatLocalFiles({
    context: { file: "origin.ts", fileSource: "remote", selectedLines: [80, 82] },
    editAnchor: { file: "origin.ts", bodyLineRange: [75, 87], fileContents: {"origin.ts": "selected remote source"} }
  });
  assert.deepEqual(ranged.files[0].lineRange, [75, 87], "captured range must survive normal synthesis, not become line 1");
  let releaseBody!: () => void;
  const restoringTurn = {
    context: { file: "src/origin.ts", fileSource: "remote", owner: "origin", repo: "repo", provider: "gitlab", branch: "preview" },
    editAnchor: { file: "src/origin.ts", fileContents: {} as Record<string, string> },
    editAnchorLoad: undefined as Promise<void> | undefined,
    streamAbort: new AbortController()
  };
  restoringTurn.editAnchorLoad = new Promise<void>(resolve => { releaseBody = () => {
    restoringTurn.editAnchor.fileContents["src/origin.ts"] = "origin source after async remote read";
    resolve();
  }; });
  const restoringSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { file: "src/other.ts", fileSource: "remote", owner: "other", repo: "other", branch: "main" },
    pendingChatLocalFiles: { source: "remote-codehost", activeFile: "src/other.ts", files: [{path: "src/other.ts", content: "wrong current thread"}] }
  });
  const restoring = restoringSession.resolveChatLocalFiles(restoringTurn);
  releaseBody();
  const restoredBody = await restoring;
  assert.equal(restoredBody?.activeFile, "src/origin.ts", "restore must await the original turn's read instead of taking a later pending file");
  assert.equal(restoredBody?.files[0].content, "origin source after async remote read");
  assert.equal(restoringSession.currentContext.file, "src/other.ts", "resolving an older turn must not mutate the active thread");
  const unavailable = await restoringSession.resolveChatLocalFiles({
    context: restoringTurn.context,
    editAnchor: { file: "src/origin.ts", fileContents: {} }
  });
  assert.equal(unavailable, undefined, "a failed original read must not borrow another thread's file");
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(restoringSession.resolveChatLocalFiles({
    ...restoringTurn, streamAbort: cancelled, editAnchorLoad: new Promise<void>(() => {})
  }), "Stop must release a waiting file read");
  const remoteRangeSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { file: "src/long.ts", fileSource: "remote", owner: "origin", repo: "repo", provider: "github", branch: "preview" },
    preferences: {},
    indexedRepoWorkspace: () => ({ readFile: async () => ({
      content: Array.from({length: 250}, (_, index) => `source line ${index + 1}`).join("\n")
    }) })
  });
  const selectionBody = await remoteRangeSession.fetchRemoteFileForChatAttach({ start: 200, end: 202 });
  assert.equal(selectionBody.files[0].content, Array.from({length: 13}, (_, index) => `source line ${195 + index}`).join("\n"), "remote selection must be sliced exactly once, with its five surrounding lines");
  assert.deepEqual(selectionBody.files[0].lineRange, [195, 207]);
  let releaseRemote!: (value: {content: string}) => void;
  const remoteController = new AbortController();
  const slowTurn = {
    context: { file: "src/slow.ts", fileSource: "remote", owner: "origin", repo: "repo", provider: "github", branch: "preview" },
    editAnchor: { file: "src/slow.ts", fileContents: {} as Record<string, string> },
    streamAbort: remoteController
  };
  const slowSession = Object.assign(Object.create(CoopChatSession.prototype), {
    preferences: {},
    indexedRepoWorkspace: () => ({ readFile: (target: {branch: string}, path: string) => {
      assert.equal(target.branch, "preview");
      assert.equal(path, "src/slow.ts");
      return new Promise<{content: string}>(resolve => { releaseRemote = resolve; });
    } })
  });
  const originalTimer = globalThis.setTimeout;
  let discardedReadTimer: (() => void) | undefined;
  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    if (ms === 4000) discardedReadTimer = callback;
    return originalTimer(callback, ms === 4000 ? 0 : ms);
  }) as typeof setTimeout;
  try {
    const read = slowSession.loadEditAnchorFile(slowTurn);
    assert.equal(discardedReadTimer, undefined, "explicit reads cannot be discarded by a separate four-second race");
    releaseRemote({ content: "late but correct remote body" });
    await read;
    assert.equal(slowTurn.editAnchor.fileContents["src/slow.ts"], "late but correct remote body");
    slowTurn.editAnchor.fileContents = {};
    const stoppedRead = slowSession.loadEditAnchorFile(slowTurn);
    remoteController.abort();
    await stoppedRead;
    releaseRemote({ content: "must not stamp after Stop" });
    await Promise.resolve();
    assert.equal(slowTurn.editAnchor.fileContents["src/slow.ts"], undefined);
  } finally {
    globalThis.setTimeout = originalTimer;
  }
  const documentsBeforeUnavailable = Object.getOwnPropertyDescriptor(vscode.workspace, "textDocuments");
  const editorsBeforeUnavailable = Object.getOwnPropertyDescriptor(vscode.window, "visibleTextEditors");
  const tabsBeforeUnavailable = Object.getOwnPropertyDescriptor(vscode.window, "tabGroups");
  Object.defineProperty(vscode.workspace, "textDocuments", { configurable: true, value: [] });
  Object.defineProperty(vscode.window, "visibleTextEditors", { configurable: true, value: [] });
  Object.defineProperty(vscode.window, "tabGroups", { configurable: true, value: { all: [] } });
  try {
    const localTurn = { context: { file: "src/closed.ts", fileSource: "local-workspace", owner: "stale", repo: "remote" },
      editAnchor: { file: "src/closed.ts", fileContents: {} as Record<string, string> } };
    const closedSession = Object.assign(Object.create(CoopChatSession.prototype), {
      preferences: {}, indexedRepoWorkspace: () => { throw new Error("closed local file must not consult remote repository"); }
    });
    await closedSession.loadEditAnchorFile(localTurn);
    assert.deepEqual(localTurn.editAnchor.fileContents, {});
  } finally {
    if (documentsBeforeUnavailable) Object.defineProperty(vscode.workspace, "textDocuments", documentsBeforeUnavailable);
    else delete (vscode.workspace as unknown as {textDocuments?: unknown}).textDocuments;
    if (editorsBeforeUnavailable) Object.defineProperty(vscode.window, "visibleTextEditors", editorsBeforeUnavailable);
    else delete (vscode.window as unknown as {visibleTextEditors?: unknown}).visibleTextEditors;
    if (tabsBeforeUnavailable) Object.defineProperty(vscode.window, "tabGroups", tabsBeforeUnavailable);
    else delete (vscode.window as unknown as {tabGroups?: unknown}).tabGroups;
  }
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
  const visibleEditorsBeforeRestore = Object.getOwnPropertyDescriptor(vscode.window, "visibleTextEditors");
  Object.defineProperty(vscode.window, "visibleTextEditors", { configurable: true, value: [] });
  const restoredRemoteSession = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: {},
    remoteProvenanceFile: undefined,
    boundThreadId: "restored-thread",
    openContextFileInEditor: async () => false
  });
  await restoredRemoteSession.applyThreadRepoContext({
    owner: "origin", repo: "repo", provider: "gitlab", branch: "preview",
    file: "src/parser.ts", fileSource: "remote", scope: "file"
  }, "restored-thread");
  assert.equal(restoredRemoteSession.currentContext.file, "src/parser.ts", "closed remote tabs retain file identity after restore");
  assert.equal(restoredRemoteSession.currentContext.fileSource, "remote");
  assert.equal(restoredRemoteSession.remoteProvenanceFile, "src/parser.ts");
  if (visibleEditorsBeforeRestore) Object.defineProperty(vscode.window, "visibleTextEditors", visibleEditorsBeforeRestore);
  else delete (vscode.window as {visibleTextEditors?: unknown}).visibleTextEditors;
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { WebviewStartup, type WebviewStartupEvent } from "./webviewStartup";

const vscode = createRequire(import.meta.url)("vscode");
vscode.ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };
vscode.window.activeColorTheme = {kind: 2};
vscode.Uri.joinPath = (uri: any, ...parts: string[]) => ({fsPath: uri.fsPath + "/" + parts.join("/")});
const extensionUri = {fsPath: "/private/tmp/test-extension"};
const { CoopChatSession } = require("./CoopChatSession") as typeof import("./CoopChatSession");
const { CoopSidebarProvider } = require("../CoopSidebarProvider") as typeof import("../CoopSidebarProvider");
const { renderWebviewHtml } = require("./renderWebviewHtml") as typeof import("./renderWebviewHtml");

function webview(): any {
  const handlers = new Set<(message: any) => Promise<void>>();
  const all: ((message: any) => Promise<void>)[] = [];
  return {html: "", cspSource: "vscode-webview:", handlers, all,
    asWebviewUri: (uri: any) => ({with: () => "https://test.invalid/" + uri.fsPath}),
    onDidReceiveMessage: (handler: (message: any) => Promise<void>) => {
      handlers.add(handler); all.push(handler); return {dispose: () => handlers.delete(handler)};
    },
    emit: async (message: any) => { await Promise.all([...handlers].map(handler => handler(message))); }
  };
}

function session(events: WebviewStartupEvent[] = []): any {
  return Object.assign(Object.create(CoopChatSession.prototype), {
    options: {extensionUri, onWebviewStartup: (event: WebviewStartupEvent) => events.push(event)},
    disposed: false, initialize: async () => undefined,
    postTheme() {}, postContext() {}, postChatHistory() {}, pushThreadsList() {}, pushPatchState() {},
    pushSettingsStateCached() {}, pushSettingsState: async () => undefined,
    pushLightningState: async () => undefined, pushWorkspacePrompts: async () => undefined,
    threadRuns: {get: () => undefined}, activeThreadId: () => "saved-thread"
  });
}

test("assigned HTML without a frame yields one actionable failure; hidden and stale views do not", ctx => {
  ctx.mock.timers.enable({apis: ["setTimeout"]});
  const failures: WebviewStartupEvent[] = [];
  const startup = new WebviewStartup(event => failures.push(event));
  startup.setVisible(true);
  startup.update({generation: "old", stage: "html-assigned"});
  ctx.mock.timers.tick(15_000);
  assert.deepEqual(failures, [{generation: "old", stage: "html-assigned"}]);
  ctx.mock.timers.tick(60_000);
  assert.equal(failures.length, 1, "no unlimited retries or repeated notifications");
  startup.update({generation: "new", stage: "html-assigned"});
  startup.update({generation: "old", stage: "session-restored"});
  startup.setVisible(false);
  ctx.mock.timers.tick(60_000);
  assert.equal(failures.length, 1);
  startup.setVisible(true);
  ctx.mock.timers.tick(15_000);
  assert.deepEqual(failures[1], {generation: "new", stage: "html-assigned"});
  startup.dispose();
});

test("startup distinguishes document, mount and hydration boundaries without regressing a ready stage", ctx => {
  ctx.mock.timers.enable({apis: ["setTimeout"]});
  const failures: WebviewStartupEvent[] = [];
  const startup = new WebviewStartup(event => failures.push(event));
  startup.setVisible(true);
  for (const stage of ["html-assigned", "document-loaded", "webview-ready", "frontend-mounted"] as const) {
    startup.update({generation: "one", stage});
  }
  ctx.mock.timers.tick(15_000);
  assert.equal(failures[0].stage, "webview-ready", "mounted effect arriving after ready cannot mislabel hydration");
  startup.update({generation: "two", stage: "html-assigned"});
  startup.update({generation: "two", stage: "session-restored"});
  startup.update({generation: "two", stage: "frontend-mounted"});
  ctx.mock.timers.tick(60_000);
  assert.equal(failures.length, 1);
  startup.setVisible(false); startup.setVisible(true);
  startup.update({generation: "two", stage: "document-loaded"});
  startup.update({generation: "two", stage: "session-restored"});
  ctx.mock.timers.tick(60_000);
  assert.equal(failures.length, 1, "successful hide/show handshake stops the watchdog");
  startup.update({generation: "two", stage: "frontend-failed"});
  assert.equal(failures[1].stage, "frontend-failed");
  startup.dispose();
});

test("the actual HTML bootstrap acquires once, keeps state and forwards send/measurement fields", () => {
  const html = renderWebviewHtml(webview(), extensionUri as any, {startupGeneration: "generation"});
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  let acquisitions = 0;
  const sent: any[] = []; const listeners: any = {}; let state: unknown;
  const window: any = {addEventListener: (name: string, callback: any) => {listeners[name] = callback;}};
  runInNewContext(script, {window, document: {getElementById: () => ({textContent: ""})},
    acquireVsCodeApi: () => {acquisitions++; return {postMessage: (message: unknown) => sent.push(message),
      getState: () => state, setState: (next: unknown) => {state = next;}};}});
  window.__coopVscodeApi.setState({input: "draft"});
  assert.deepEqual(window.__coopVscodeApi.getState(), {input: "draft"});
  window.__coopVscodeApi.postMessage({type: "chat:send", payload: {message: "hello", clientSubmissionId: "submission"}});
  assert.equal(acquisitions, 1);
  assert.equal(sent[0].payload.stage, "document-loaded");
  assert.equal(sent[1].startupGeneration, "generation");
  assert.equal(sent[1].payload.clientSubmissionId, "submission");
  const receipt = {type: "chat:display-receipt", payload: {traceId: "trace", submissionId: "submission", elapsedMs: 17, milestone: "complete"}};
  window.__coopVscodeApi.postMessage(receipt);
  assert.equal(sent[2].startupGeneration, "generation");
  assert.deepEqual(sent[2].payload, receipt.payload, "the startup fence preserves the frontend measurement receipt exactly");
  listeners.error({message: "load failed"});
  assert.equal(sent[3].payload.stage, "frontend-failed");
  assert.ok(html.includes("default-src 'none'"), "CSP remains enforced");
});

test("actual attachment keeps one listener; disposed views and obsolete document sends are ignored", async () => {
  const s = session(); let sends = 0;
  s.handleMessage = async () => {sends++;};
  const old = webview(); s.attachWebview(old); const firstGeneration = s.chatStartupGeneration;
  s.attachWebview(old);
  assert.equal(old.handlers.size, 1);
  await old.emit({type: "chat:send", startupGeneration: firstGeneration});
  assert.equal(sends, 0);
  await old.emit({type: "chat:send", startupGeneration: s.chatStartupGeneration});
  assert.equal(sends, 1, "one Send is handled once");
  const current = webview(); s.attachWebview(current);
  s.detachWebview(old);
  assert.equal(s.webview, current, "late disposal cannot detach the replacement");
  await old.all[0]({type: "chat:send", startupGeneration: firstGeneration});
  assert.equal(sends, 1);
  s.detachWebview(current);
  assert.equal(current.handlers.size, 0);
  assert.equal(s.webview, undefined);
});

test("old ready continuations cannot publish into a replacement; hydration failure is reported", async () => {
  const events: WebviewStartupEvent[] = []; const s = session(events);
  let release!: () => void; s.initialize = () => new Promise<void>(resolve => {release = resolve;});
  let histories = 0; s.postChatHistory = () => {histories++;};
  const old = webview(); s.attachWebview(old);
  const ready = old.emit({type: "webview-ready", startupGeneration: s.chatStartupGeneration});
  const current = webview(); s.attachWebview(current);
  release(); await ready;
  assert.equal(histories, 0);
  assert.ok(!events.some(event => event.stage === "session-restored"));
  s.initialize = async () => {throw new Error("preferences unavailable");};
  s.postToChat = () => undefined;
  await current.emit({type: "webview-ready", startupGeneration: s.chatStartupGeneration});
  assert.equal(events.at(-1)?.stage, "session-failed");
  s.initialize = async () => undefined;
  await current.emit({type: "webview-ready", startupGeneration: s.chatStartupGeneration});
  assert.equal(histories, 1);
  assert.equal(events.at(-1)?.stage, "session-restored");
  s.detachWebview(current);
});

test("provider ignores old disposal and visibility callbacks and detaches the active view", async () => {
  const makeView = () => {
    const callbacks: any = {};
    return {webview: webview(), visible: true, callbacks,
      onDidDispose: (fn: any) => {callbacks.dispose = fn; return {dispose() {}};},
      onDidChangeVisibility: (fn: any) => {callbacks.visible = fn; return {dispose() {}};}};
  };
  const detached: any[] = []; let touched = 0;
  const provider: any = Object.assign(Object.create(CoopSidebarProvider.prototype), {
    extensionUri, viewSubscriptions: [], startup: new WebviewStartup(() => undefined),
    session: {attachWebview() {}, detachWebview: (view: any) => detached.push(view),
      refreshEditorContext() {}, initialize: async () => undefined, touch: () => {touched++;}}
  });
  const old = makeView(); const current = makeView();
  await provider.resolveWebviewView(old as any); await provider.resolveWebviewView(current as any);
  old.callbacks.dispose(); old.callbacks.visible();
  assert.equal(provider.view, current);
  assert.equal(detached.length, 0); assert.equal(touched, 0);
  current.callbacks.dispose();
  assert.equal(provider.view, undefined);
  assert.deepEqual(detached, [current.webview]);
});

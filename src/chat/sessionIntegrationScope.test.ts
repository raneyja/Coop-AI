import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import type { CoopChatSessionOptions } from "./CoopChatSession";
import type { ContextFetchRequest } from "../context/requestBatcher";
import type { ResolvedIntegrationScope, ScopedIntegrationProvider } from "../integrationScope/types";

async function fixture(t: TestContext, resolve: (provider: ScopedIntegrationProvider) => Promise<ResolvedIntegrationScope>) {
  const require = createRequire(__filename);
  require("../../scripts/vscode-test-stub.cjs");
  const vscode = require("vscode") as typeof import("vscode");
  const original = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = (section) => {
    const config = original(section);
    return { ...config, get: <T>(key: string, fallback?: T): T => key === "devMode" ? true as T : config.get(key, fallback as T) };
  };
  t.after(() => { vscode.workspace.getConfiguration = original; });
  const { CoopChatSession } = await import("./CoopChatSession");
  const { SecureApiClient } = await import("./SecureApiClient");
  const api = new SecureApiClient({ get: async () => undefined, store: async () => {}, delete: async () => {},
    onDidChange: () => ({ dispose() {} }) });
  api.getIntegrationScope = (_base, provider) => resolve(provider);
  const unused = <K extends keyof CoopChatSessionOptions>(name: K): CoopChatSessionOptions[K] =>
    new Proxy({}, { get() { throw new Error(`Unexpected scope dependency: ${name}`); } }) as CoopChatSessionOptions[K];
  const session = new CoopChatSession({
    extensionUri: vscode.Uri.file("/private/tmp/coop-scope-session-fixture"), extensionContext: unused("extensionContext"), api,
    healthMonitor: unused("healthMonitor"), degradationCache: unused("degradationCache"), codeHostRouter: unused("codeHostRouter"),
    codeHostSecrets: unused("codeHostSecrets"), integrationSecrets: unused("integrationSecrets"), indexManager: unused("indexManager"),
    indexBackend: unused("indexBackend"), lightningStatusBar: unused("lightningStatusBar"), identityDirectoryStore: unused("identityDirectoryStore"),
    agentOrchestrator: unused("agentOrchestrator")
  });
  t.after(() => session.dispose());
  return session as unknown as {
    resolveIntegrationScopes(request: ContextFetchRequest): Promise<Partial<Record<ScopedIntegrationProvider, ResolvedIntegrationScope>>>;
    searchIntegrationForAgent(provider: "slack", query: string): Promise<Record<string, unknown>>;
  };
}

const request: ContextFetchRequest = {
  type: "chat_context", params: { integrationProvider: "slack", fileSource: "remote" },
  intent: { context: { queryText: "/slack release discussion" } }
};

test("constructed dev-mode session still obtains source authorization", async t => {
  const calls: string[] = [];
  const admitted: ResolvedIntegrationScope = { provider: "slack", enforced: true, allowed: true, scopeStatus: "active",
    slack: { channelIds: ["C1"], channelNames: ["allowed"] } };
  const session = await fixture(t, async provider => { calls.push(provider); return admitted; });
  assert.deepEqual(await session.resolveIntegrationScopes(request), { slack: admitted });
  assert.deepEqual(calls, ["slack"]);
});

test("failed initial scope is an enforced denial, never optional context", async t => {
  const session = await fixture(t, async () => { throw new Error("policy unavailable"); });
  assert.deepEqual((await session.resolveIntegrationScopes(request)).slack, {
    provider: "slack", enforced: true, allowed: false, scopeStatus: "required", reason: "Integration access could not be verified."
  });
});

test("failed mid-loop scope returns no evidence or credential read", async t => {
  let calls = 0;
  const session = await fixture(t, async () => { calls++; throw new Error("revoked session"); });
  const result = await session.searchIntegrationForAgent("slack", "release");
  assert.equal(calls, 1);
  assert.deepEqual(result.messages, []);
  assert.ok(result.error);
});

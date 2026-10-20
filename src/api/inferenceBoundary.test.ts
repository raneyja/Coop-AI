import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ModelRouter } from "./ModelRouter";
import { INFERENCE_ROLES, isInferenceRole, inferencePolicyUseCase } from "../config/inferenceRoles";
import { SecureApiClient } from "../chat/SecureApiClient";
import { resolveHonoredChatModel } from "../config/featureModelAssignments";
import type { CompletionRequest, LlmAuditEvent } from "./types";

const request: CompletionRequest = { requestId: "ownership-contract", orgId: "fixture", plan: "pro", message: "Explain retry ordering",
  history: [], useCase: "chat", inferenceRole: "answer", allowUnapprovedProvider: true,
  modelConfig: { provider: "openai", model: "requested-alias", temperature: 0, maxTokens: 100 } };

test("missing credentials never produce successful mock output unless mock mode was explicit", async () => {
  for (const mockMode of [false, true]) {
    const router = new ModelRouter({ config: { defaultProvider: "openai", mockMode, allowUnapprovedProvider: true, apiKeys: {} } });
    const chunks = [];
    for await (const chunk of router.stream(request)) chunks.push(chunk);
    assert.equal(router.isMockMode(), mockMode);
    assert.equal(chunks.some(chunk => chunk.type === "done"), mockMode);
    assert.equal(chunks.some(chunk => chunk.type === "error" && /No API key/.test(chunk.message)), !mockMode);
    if (!mockMode) assert.equal(chunks.some(chunk => chunk.type === "delta"), false);
    if (!mockMode) await assert.rejects(router.completeInline({ ...request, useCase: "inline_completion" }), /No API key/);
  }
});

test("provider-reported serving model and tokens survive the router and audit", async () => {
  const original = globalThis.fetch;
  const events: LlmAuditEvent[] = [];
  globalThis.fetch = async () => new Response([
    'data: {"model":"served-version-202610","choices":[{"delta":{"content":"Verified"}}]}',
    'data: {"model":"served-version-202610","choices":[],"usage":{"prompt_tokens":13,"completion_tokens":4}}',
    'data: [DONE]', ""
  ].join("\n\n"));
  try {
    const router = new ModelRouter({ config: { defaultProvider: "openai", mockMode: false, allowUnapprovedProvider: true,
      apiKeys: { openai: "fixture" } }, onAudit: event => events.push(event) });
    const chunks = [];
    for await (const chunk of router.stream(request)) chunks.push(chunk);
    const done = chunks.find(chunk => chunk.type === "done");
    assert.equal(done?.model, "served-version-202610");
    assert.equal(done?.usage.inputTokens, 13);
    assert.equal(events[0].model, "served-version-202610");
    assert.equal(events[0].requestedModel, "requested-alias");
    assert.equal(events[0].inferenceRole, "answer");
    const inline = await router.completeInline({ ...request, useCase: "inline_completion", inferenceRole: "autocomplete" });
    assert.equal(inline.model, "served-version-202610");
  } finally { globalThis.fetch = original; }
});

test("supporting role policy stays assigned and unknown roles are rejected before transport", async () => {
  assert.equal(isInferenceRole("unregistered-provider-helper"), false);
  for (const role of Object.keys(INFERENCE_ROLES)) assert.equal(isInferenceRole(role), true);
  const policy = inferencePolicyUseCase("opened_source_interpretation", "chat");
  assert.equal(policy, "intent_suggest");
  const honored = resolveHonoredChatModel({ allowUnapprovedProvider: false, plan: "pro", useCase: policy,
    clientModel: "claude-opus-4-8", clientProvider: "anthropic" });
  assert.equal(honored.model, "gpt-4o-mini");
  const client = Object.assign(Object.create(SecureApiClient.prototype), {
    ensureToken: async () => {}, setBaseUrl() {}, backend: { streamChat() { throw new Error("Transport must not run"); } }
  });
  await assert.rejects(client.streamChat({ inferenceRole: "unregistered-provider-helper" }, () => {}, "https://api.coop-ai.dev"), /Unregistered inference role/);
});

test("production model calls use registered roles and provider construction stays at the existing boundary", () => {
  const root = path.resolve(__dirname, "..");
  const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  for (const file of walk(root).filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))) {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const inspect = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
          : ts.isIdentifier(node.expression) ? node.expression.text : "";
        if (["createProviderClient", "createFimClient", "streamCompletion"].includes(name)) {
          assert.equal(relative, "api/ModelRouter.ts", `Provider bypass in ${relative}`);
        }
        if (name === "streamChat" && ts.isObjectLiteralExpression(node.arguments[0])) {
          const role = node.arguments[0].properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "inferenceRole");
          assert.ok(role, `Missing inference role in ${relative}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
          if (ts.isPropertyAssignment(role) && ts.isStringLiteral(role.initializer)) assert.ok(isInferenceRole(role.initializer.text));
        }
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /^(?:OpenAi|Anthropic|Gemini|Mistral|DeepSeek)ProviderClient$/.test(node.expression.text)) {
        assert.equal(relative, "api/providers/index.ts", `Provider construction bypass in ${relative}`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
});

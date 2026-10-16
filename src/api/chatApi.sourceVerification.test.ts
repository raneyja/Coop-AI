import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChatApiRequest } from "./chatApi";
import type { ModelRouter } from "./ModelRouter";
import type { CompletionRequest } from "./types";
import type { PlanQuotaService } from "../server/planQuota";
import { PlanQuotaExceededError } from "../server/planQuota";
import { resolveAssignedSourceVerificationModel, SOURCE_VERIFICATION_MAX_TOKENS } from "../config/featureModelAssignments";

test("API enforces private review/repair routing before quota and retains known stopped usage once", async () => {
  for (const phase of ["review", "repair"] as const) for (const stop of [false, true]) for (const allowUnapprovedProvider of [false, true]) {
    const calls: CompletionRequest[] = [], checked: Record<string, unknown>[] = [], recorded: Record<string, unknown>[] = [];
    const raw = new EventEmitter();
    const router = {stream: async function* (request: CompletionRequest, signal: AbortSignal) {
      calls.push(request);
      if (stop) raw.emit("close");
      assert.equal(signal.aborted, stop);
      yield {type: "done", model: request.modelConfig.model, provider: request.modelConfig.provider,
        finishReason: stop ? "cancelled" : "stop", usage: {inputTokens: 12, outputTokens: 6, estimatedCostUsd: 0.00015}};
    }} as unknown as ModelRouter;
    const quota = {check: async (...args: unknown[]) => {checked.push(args[4] as Record<string, unknown>);},
      recordTokens: async (_org: string, _plan: string, value: Record<string, unknown>) => {recorded.push(value);}} as unknown as PlanQuotaService;
    let status = 0;
    const response = {writeHead: (code: number) => {status = code;}, write: () => undefined, end: () => undefined} as unknown as ServerResponse;
    const deps = {router, planQuota: quota, config: {defaultProvider: "anthropic" as const, mockMode: false,
      allowUnapprovedProvider, apiKeys: {}}, serverConfig: {nodeEnv: "test", requireApiAuth: false,
      jobsWorkersEnabled: false, devMode: true}};
    await handleChatApiRequest({method: "POST", pathname: "/v1/chat", headers: {}, body: {
      message: "private source phase", useCase: "ownership", sourceClaimReview: phase === "review",
      sourceEvidenceSynthesis: phase === "repair", sourceEvidenceRepair: phase === "repair",
      provider: "anthropic", model: "claude-opus-4-8", maxTokens: 256, enableThinking: false,
      quotaTurnId: "one-user-send"}}, response, deps, raw as IncomingMessage);
    assert.equal(status, 200); assert.equal(calls.length, 1); assert.equal(checked.length, 1); assert.equal(recorded.length, 1);
    const assigned = resolveAssignedSourceVerificationModel();
    assert.deepEqual(checked[0] && {provider: checked[0].provider, model: checked[0].model, selection: checked[0].selection}, {...assigned, selection: "auto"});
    assert.equal(calls[0].modelConfig.model, assigned.model); assert.equal(calls[0].modelConfig.provider, assigned.provider);
    assert.equal(calls[0].modelConfig.maxTokens, SOURCE_VERIFICATION_MAX_TOKENS); assert.equal(calls[0].enableThinking, true);
    assert.equal(calls[0].useCase, "ownership"); assert.equal(recorded[0].quotaTurnId, "one-user-send");
    assert.equal(recorded[0].inputTokens, 12); assert.equal(recorded[0].outputTokens, 6);
    assert.equal(recorded[0].model, assigned.model); assert.equal(recorded[0].provider, assigned.provider);
    assert.equal(recorded[0].selection, "auto"); assert.equal(recorded[0].countsAsMessage, true);
    assert.equal((recorded[0].metadata as Record<string, unknown>)[phase === "review" ? "sourceClaimReview" : "sourceEvidenceRepair"], true);
    assert.equal(calls[0].sourceClaimReview, phase === "review");
    assert.equal(calls[0].sourceEvidenceSynthesis, phase === "repair");
    assert.equal(calls[0].sourceEvidenceRepair, phase === "repair");
  }
});

test("invalid repair flags and ordinary-chat phase claims fail before quota or provider processing", async () => {
  let calls = 0, checks = 0;
  const router = {stream: async function* () {calls++;}} as unknown as ModelRouter;
  const quota = {check: async () => {checks++;}} as unknown as PlanQuotaService;
  for (const flags of [
    {useCase: "ownership", sourceEvidenceRepair: "true", sourceEvidenceSynthesis: true},
    {useCase: "ownership", sourceEvidenceRepair: true},
    {useCase: "ownership", sourceEvidenceRepair: true, sourceEvidenceSynthesis: false},
    {useCase: "ownership", sourceEvidenceRepair: true, sourceEvidenceSynthesis: true, sourceClaimReview: true},
    {useCase: "chat", sourceEvidenceRepair: true, sourceEvidenceSynthesis: true},
    {useCase: "ownership", sourceClaimReview: false, sourceEvidenceSynthesis: "true"},
    {useCase: "ownership", sourceEvidenceRepair: false, sourceClaimReview: "false"}
  ]) {
    let status = 0;
    await handleChatApiRequest({method: "POST", pathname: "/v1/chat", headers: {}, body: {message: "test", quotaTurnId: "old-turn", ...flags}},
      {writeHead: (code: number) => {status = code;}, end: () => undefined} as unknown as ServerResponse,
      {router, planQuota: quota, config: {defaultProvider: "openai", mockMode: false, allowUnapprovedProvider: false, apiKeys: {}},
        serverConfig: {nodeEnv: "test", requireApiAuth: false, jobsWorkersEnabled: false, devMode: true}});
    assert.equal(status, 400);
  }
  assert.equal(calls, 0); assert.equal(checks, 0);
});

test("an ordinary chat cannot enable same-turn continuation by supplying an internal flag or a reused turn ID", async () => {
  let status = 0, calls = 0;
  const router = {stream: async function* () {calls++;}} as unknown as ModelRouter;
  const quota = {check: async (...args: unknown[]) => {
    const context = args[4] as Record<string, unknown>;
    assert.equal(context.quotaTurnId, "recorded-send"); assert.equal(context.internalSourceCall, false);
    throw new PlanQuotaExceededError(1000, 0, 0, "https://coop-ai.dev/pricing", new Date(Date.now() + 1000));
  }} as unknown as PlanQuotaService;
  await handleChatApiRequest({method: "POST", pathname: "/v1/chat", headers: {}, body: {
    message: "new question", useCase: "chat", quotaTurnId: "recorded-send", internalSourceCall: true}},
  {writeHead: (code: number) => {status = code;}, end: () => undefined} as unknown as ServerResponse,
  {router, planQuota: quota, config: {defaultProvider: "openai", mockMode: false, allowUnapprovedProvider: false, apiKeys: {}},
    serverConfig: {nodeEnv: "test", requireApiAuth: false, jobsWorkersEnabled: false, devMode: true}});
  assert.equal(status, 429); assert.equal(calls, 0);
});

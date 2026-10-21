import assert from "node:assert/strict";
import test from "node:test";
import { CoopChatSession } from "./CoopChatSession";
import { ThreadRunManager } from "./chatTurn";
import { emptyChatIntentPlan } from "./intentPlanner/types";
import { planChatFrontDoor } from "./intentPlanner/frontDoor";
import { agentTurnAction, agentTurnAllowsRepoTools, integrationsForAgentLoop } from "./agentRouting";
import { resolveChatIntentExecution } from "./intentPlanner/resolveExecution";
import { SecureApiClient, type StreamChatParams } from "./SecureApiClient";
import { agentRequestContext } from "./agentRequestContext";
import { syncThreadToBackend } from "./threadSync";

function ownedTurn() {
  const history = [
    { role: "user" as const, content: "Decision: retain the offline reconciliation queue.", timestamp: 1 },
    { role: "assistant" as const, content: "We will preserve retry ordering.", timestamp: 2 },
    { role: "user" as const, content: "Compare this diagram with the queue implementation; explain the mismatch without changing code.", timestamp: 3,
      attachments: [{ id: "diagram", name: "queue.png", mimeType: "image/png", dataUrl: "data:image/png;base64,cXVldWU=" }] }
  ];
  const settings = { apiBaseUrl: "https://owned.example.test", temperature: 0.2, maxTokens: 1200 };
  const turn = new ThreadRunManager().begin({ threadId: "owned", context: { owner: "old", repo: "queue", branch: "release" },
    history, artifacts: [], sessionCostUsd: 0, modelMessage: history[2].content, quotaTurnId: "original-quota",
    requestSettings: settings as any, connectedIntegrations: ["slack"],
    intentPlan: { ...emptyChatIntentPlan(history[2].content), purpose: "Explain the mismatch while retaining queue ordering",
      completionNeeds: ["Compare diagram and implementation", "Retain the prior ordering decision"] } });
  // Mutating the UI-owned originals must not mutate the request.
  history[0].content = "WRONG DECISION";
  history[2].attachments![0].dataUrl = "WRONG IMAGE";
  settings.apiBaseUrl = "https://wrong.example.test";
  return turn;
}

test("varied diagram and earlier decision reach planning, answer and length continuation on the owned target", async () => {
  const turn = ownedTurn();
  const calls: Array<{ body: StreamChatParams; base: string; signal?: AbortSignal }> = [];
  let answerCount = 0;
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    preferences: { apiBaseUrl: "https://wrong.example.test", temperature: 1, maxTokens: 10 },
    currentContext: { owner: "new", repo: "other", branch: "main" },
    turnStreamAbort: AbortSignal.abort(),
    buildProjectInstructionsBlock: async () => undefined,
    postForThread() {}, persistTurnThread() {}, logAgentDiagnostic() {}, isViewingThread: () => false,
    options: { api: { streamChat: async (body: StreamChatParams, _chunk: unknown, base: string, signal?: AbortSignal) => {
      calls.push({ body, base, signal });
      if (body.inferenceRole === "tool_plan") return { message: { content: '{"done":true}' },
        usage: { provider: "openai", model: "served-planner-version", inputTokens: 10, outputTokens: 2, estimatedCostUsd: 0.01 } };
      return { message: { content: ++answerCount === 1 ? "The diagram" : " omits retries." },
        finishReason: answerCount === 1 ? "length" : "stop",
        usage: { provider: "openai", model: "served-answer-version", inputTokens: 20, outputTokens: 5, estimatedCostUsd: 0.02 } };
    } } }
  });
  const conversation = [{ role: "user", content: turn.modelMessage }];
  await session.planAgentToolTurn({ message: turn.modelMessage, repoId: "github:old/queue", round: 1,
    conversation, priorSteps: [], allowedIntegrations: [] }, { model: "requested", provider: "openai" }, [], true,
    turn.intentPlan.purpose, undefined, turn);
  const answer = await session.streamAgentAnswer({ message: turn.modelMessage, repoId: "github:old/queue", action: "understand", conversation },
    { model: "requested", provider: "openai" }, "chat", () => {}, turn.streamAbort.signal, turn.threadId, turn);
  assert.equal(answer, "The diagram omits retries.");
  assert.deepEqual(calls.map(call => call.body.inferenceRole), ["tool_plan", "answer", "continuation"]);
  for (const { body, base, signal } of calls) {
    assert.equal(base, "https://owned.example.test");
    assert.equal(signal, turn.streamAbort.signal);
    assert.equal(body.quotaTurnId, "original-quota");
    const payload = JSON.stringify(body);
    assert.match(payload, /retain the offline reconciliation queue/);
    assert.match(payload, /Compare diagram and implementation/);
    assert.match(payload, /data:image\/png;base64,cXVldWU=/);
    assert.doesNotMatch(payload, /WRONG DECISION|WRONG IMAGE/);
  }
  assert.deepEqual(calls[1].body.context, turn.context);
  assert.equal(turn.inferenceCalls?.[0].model, "served-planner-version");
  assert.equal(turn.inferenceCalls?.[2].model, "served-answer-version");
  assert.equal(turn.sessionCostUsd, 0.05);
});

test("a valid model interpretation owns purpose and inferred action; explicit provider and workflow constraints still win", async () => {
  const complete = async () => JSON.stringify({ confidence: "high", purpose: "Explain the earlier decision only",
    codeIntent: { action: "none" }, tools: [], jobs: [], completionNeeds: ["Explain the earlier decision"] });
  const plan = await planChatFrontDoor({ message: "Why did that service change?", connectedTools: ["slack"] }, { complete });
  assert.equal(plan.interpretation, "model");
  assert.equal(plan.purpose, "Explain the earlier decision only");
  assert.deepEqual(plan.jobs, []);
  assert.equal(agentTurnAction({ query: "Why did that service change?", hasQuickAction: false, intentPlan: plan }), "none");
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan }), false);
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: { ...plan, codeIntent: undefined } }), false);
  const broad = async () => JSON.stringify({ confidence: "high", purpose: "Inspect everything", codeIntent: { action: "understand" },
    tools: ["slack", "jira"], jobs: [{ capability: "locate", terms: ["queue"] }] });
  const narrow = await planChatFrontDoor({ message: "Explain the queue decision", connectedTools: ["slack", "jira"],
    constraint: { kind: "integration", provider: "slack" } }, { complete: broad });
  assert.deepEqual(narrow.tools, ["slack"]);
  assert.equal(narrow.codeIntent?.action, "none");
  assert.equal(narrow.jobs?.some(job => job.capability === "locate"), false);
  const workflow = await planChatFrontDoor({ message: "Review queue impacts", connectedTools: [],
    constraint: { kind: "workflow", workflow: "blast-radius" } }, { complete });
  assert.equal(workflow.workflow, "blast-radius");
});

test("wait authority blocks adversarial tool and change plans before execution", async () => {
  const complete = async () => JSON.stringify({
    confidence: "high",
    purpose: "Acknowledge the operating boundary and wait",
    authority: { mode: "wait", repository: false, integrations: [] },
    authorityChange: "replace",
    codeIntent: { action: "change" },
    tools: ["slack", "jira"],
    jobs: [
      { capability: "decision", terms: ["release discussion"] },
      { capability: "locate", terms: ["release handler"] }
    ]
  });
  const plan = await planChatFrontDoor({
    message: "Hold here. Confirm the rules and wait until I send the incident details.",
    connectedTools: ["slack", "jira"]
  }, { complete });

  assert.equal(plan.actionAuthority?.mode, "wait");
  assert.deepEqual(plan.tools, []);
  assert.deepEqual(plan.jobs, []);
  assert.equal(resolveChatIntentExecution(plan).kind, "none");
  assert.equal(agentTurnAction({ query: "wait", hasQuickAction: false, intentPlan: plan }), "none");
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan }), false);
  assert.deepEqual(integrationsForAgentLoop({ connected: ["slack", "jira"], plan }), []);
});

test("repository-only read authority permits investigation but blocks vendors and patch proposals", async () => {
  const complete = async () => JSON.stringify({
    confidence: "high",
    purpose: "Explain the failing check from repository evidence",
    authority: { mode: "read", repository: true, integrations: [] },
    authorityChange: "replace",
    codeIntent: { action: "change" },
    tools: ["slack", "jira"],
    jobs: [
      { capability: "locate", terms: ["membership check"], searchCriteria: ["membership suspended"] },
      { capability: "decision", terms: ["access policy"] }
    ]
  });
  const plan = await planChatFrontDoor({
    message: "Inspect the selected repository only and keep this read-only.",
    connectedTools: ["slack", "jira"]
  }, { complete });

  assert.deepEqual(plan.tools, []);
  assert.deepEqual(plan.jobs?.map((job) => job.capability), ["locate"]);
  assert.equal(plan.codeIntent?.action, "understand");
  assert.equal(agentTurnAction({ query: "inspect the failure", hasQuickAction: false, intentPlan: plan }), "understand");
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan }), true);
  assert.deepEqual(integrationsForAgentLoop({ connected: ["slack", "jira"], plan }), []);
});

test("thread restrictions persist until an explicit later message replaces them", async () => {
  const prior = { mode: "read" as const, repository: true, integrations: [], source: "model" as const };
  const retain = await planChatFrontDoor({
    message: "Give me the remediation plan and keep the same limits.",
    connectedTools: ["slack"],
    priorActionAuthority: prior
  }, { complete: async () => JSON.stringify({
    confidence: "high",
    purpose: "Plan the remediation",
    authority: { mode: "read", repository: true, integrations: ["slack"] },
    authorityChange: "retain",
    codeIntent: { action: "change" },
    tools: ["slack"],
    jobs: [{ capability: "decision", terms: ["remediation"] }]
  }) });
  assert.deepEqual(retain.actionAuthority?.integrations, []);
  assert.equal(retain.actionAuthority?.mode, "read");
  assert.deepEqual(retain.tools, []);
  assert.notEqual(agentTurnAction({ query: "plan remediation", hasQuickAction: false, intentPlan: retain }), "change");

  const expanded = await planChatFrontDoor({
    message: "Proceed with a patch proposal in the selected repository. Do not apply it.",
    connectedTools: ["slack"],
    priorActionAuthority: prior
  }, { complete: async () => JSON.stringify({
    confidence: "high",
    purpose: "Prepare an evidence-backed patch proposal",
    authority: { mode: "change", repository: true, integrations: [] },
    authorityChange: "replace",
    codeIntent: { action: "change" },
    tools: [],
    jobs: [{ capability: "locate", terms: ["membership guard"] }]
  }) });
  assert.equal(expanded.actionAuthority?.mode, "change");
  assert.equal(agentTurnAction({ query: "prepare the patch", hasQuickAction: false, intentPlan: expanded }), "change");
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: expanded }), true);
});

test("an explicit integration command grants only that provider for the current turn", async () => {
  const plan = await planChatFrontDoor({
    message: "Find the latest incident note",
    connectedTools: ["slack", "jira"],
    priorActionAuthority: { mode: "wait", repository: false, integrations: [], source: "model" },
    constraint: { kind: "integration", provider: "slack" }
  }, { complete: async () => JSON.stringify({
    confidence: "high",
    authority: { mode: "wait", repository: false, integrations: [] },
    authorityChange: "retain",
    tools: ["slack", "jira"],
    jobs: [{ capability: "decision", verb: "latest", terms: [] }]
  }) });
  assert.equal(plan.actionAuthority?.source, "command");
  assert.deepEqual(plan.actionAuthority?.integrations, ["slack"]);
  assert.deepEqual(plan.tools, ["slack"]);
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan, integrationSlash: true }), false);
  assert.deepEqual(integrationsForAgentLoop({ connected: ["slack", "jira"], plan }), ["slack"]);
});

test("captured turn authority is isolated from mutable history and plan inputs", () => {
  const authority = { mode: "read" as const, repository: true, integrations: [] as Array<"slack">, source: "model" as const };
  const history = [{ role: "user" as const, content: "Read the repository only", timestamp: 1, actionAuthority: authority }];
  const plan = { ...emptyChatIntentPlan(history[0].content), actionAuthority: authority };
  const turn = new ThreadRunManager().begin({
    threadId: "authority",
    context: { owner: "coop", repo: "service", branch: "main" },
    history,
    artifacts: [],
    sessionCostUsd: 0,
    modelMessage: history[0].content,
    intentPlan: plan
  });
  history[0].actionAuthority!.integrations.push("slack");
  plan.actionAuthority!.mode = "change";
  assert.equal(turn.intentPlan.actionAuthority?.mode, "read");
  assert.deepEqual(turn.history[0].actionAuthority?.integrations, []);
});

test("an account switch while scope lookup is delayed prevents integration credential use", async () => {
  let token = "account-one";
  const identity = await SecureApiClient.prototype.captureRequestIdentity.call({ getToken: async () => token } as any);
  let release!: (value: unknown) => void;
  const scope = new Promise(resolve => { release = resolve; });
  let started!: () => void;
  const scopeStarted = new Promise<void>(resolve => { started = resolve; });
  let credentialsRead = false;
  const turn = ownedTurn(); turn.assertIdentity = identity;
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { owner: "other", repo: "other" }, preferences: { apiBaseUrl: "https://wrong.example.test" },
    options: { integrationSecrets: { getCredentials: async () => { credentialsRead = true; return {}; } },
      api: { getIntegrationScope: async (base: string) => { assert.equal(base, "https://owned.example.test"); started(); return scope; } } }
  });
  const request = session.searchIntegrationForAgent("slack", "queue decision", undefined, { turn });
  await scopeStarted;
  token = "account-two";
  release({});
  await assert.rejects(request, /signed-in account changed/);
  assert.equal(credentialsRead, false);
});

test("a delayed branch lookup cannot overwrite a new repository, branch or chat selection", async () => {
  for (const change of ["repository", "branch", "chat"]) {
    let resolve!: (branch: string) => void;
    let started!: () => void;
    const waiting = new Promise<void>(done => { started = done; });
    const branch = new Promise<string>(done => { resolve = done; });
    let sameChat = true;
    const session = Object.assign(Object.create(CoopChatSession.prototype), {
      currentContext: { owner: "old", repo: "queue", provider: "github", branch: "release", scope: "repo" },
      preferences: { branch: "release" },
      options: { api: { hasToken: async () => true } },
      resolveIndexedBranchForTarget: async () => { started(); return branch; },
      postContext() { throw new Error("The newer selection must not be overwritten"); }
    });
    const pending = session.pinCanonicalRepoBranchForTurn({ isCurrent: () => sameChat });
    await waiting;
    if (change === "repository") session.currentContext = { ...session.currentContext, repo: "other" };
    if (change === "branch") session.currentContext = { ...session.currentContext, branch: "hotfix" };
    if (change === "chat") sameChat = false;
    const selection = { ...session.currentContext };
    resolve("canonical-old-repo");
    assert.equal(await pending, false);
    assert.deepEqual(session.currentContext, selection);
  }
});

test("file-only and explicit provider-only briefs retain their boundaries", () => {
  const turn = ownedTurn();
  turn.context = { ...turn.context, file: "scratch.ts", fileSource: "external" };
  const fileBrief = agentRequestContext(turn).brief;
  assert.match(fileBrief, /"repository":false/);
  assert.doesNotMatch(fileBrief.split("Source target: ")[1].split("\n")[0], /"repo"|"owner"/);
  turn.intentPlan = { ...turn.intentPlan, commandConstraint: { kind: "integration", provider: "slack" }, tools: ["slack"] };
  assert.match(agentRequestContext(turn).brief, /Source target: {"integration":"slack"}/);
});

test("the actual intent request retains an earlier decision, current media and source identity", async () => {
  const turn = ownedTurn();
  const history = [turn.history[0], ...Array.from({ length: 6 }, (_, index) => ({ role: "assistant", content: `Follow-up ${index}`, timestamp: index + 2 }))];
  let calls = 0;
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    preferences: {}, currentContext: { repo: "wrong" }, chatHistory: [],
    options: { api: { streamChat: async (body: StreamChatParams, chunk: (text: string) => void, base: string) => {
      calls++;
      assert.equal(base, "https://owned.example.test");
      assert.match(body.message, /retain the offline reconciliation queue/);
      assert.match(body.message, /"repo":"queue"/);
      assert.equal(body.attachments?.[0].id, "diagram");
      assert.equal(body.inferenceRole, "intent");
      chunk(JSON.stringify({ purpose: "Explain the diagram against the earlier queue decision", confidence: "high", tools: [], jobs: [], codeIntent: { action: "understand" } }));
      return { message: { content: "" }, usage: { provider: "openai", model: "served-intent-version", inputTokens: 30, outputTokens: 10, estimatedCostUsd: 0.01 } };
    } } }
  });
  const plan = await session.resolveChatIntentPlan(turn.modelMessage, { settings: turn.requestSettings, context: turn.context,
    history, connectedTools: [], attachments: turn.history.at(-1)?.attachments });
  assert.equal(calls, 1);
  assert.equal(plan.interpretation, "model");
  assert.equal(plan.inferenceUsage?.model, "served-intent-version");
});

test("saved chat sync retains inference attribution without sending the local account guard", async () => {
  const original = globalThis.fetch;
  let payload: any;
  globalThis.fetch = async (_url, init) => { payload = JSON.parse(String(init?.body)); return new Response("{}"); };
  const call = { role: "tool_plan" as const, provider: "openai", model: "served-version", inputTokens: 9, outputTokens: 3, estimatedCostUsd: 0.01 };
  try {
    await syncThreadToBackend({ id: "owned", title: "Queue", createdAt: 1, updatedAt: 2, messageCount: 1,
      sessionCostUsd: 0.01, artifacts: [], messages: [{ role: "assistant", content: "Verified", timestamp: 2, inferenceCalls: [call] }] },
    { baseUrl: "https://api.coop-ai.dev", getToken: async () => "fixture" });
    assert.deepEqual(payload.messages[0].metadata.inferenceCalls, [call]);
    assert.equal(JSON.stringify(payload).includes("assertIdentity"), false);
  } finally { globalThis.fetch = original; }
});

import assert from "node:assert/strict";
import test from "node:test";
import type { ServerResponse } from "node:http";
import { SecureApiClient, type StreamChatParams } from "./SecureApiClient";
import { handleChatApiRequest } from "../api/chatApi";
import { ModelRouter } from "../api/ModelRouter";
import type { PlanQuotaService } from "../server/planQuota";
import { usageFixture } from "../api/providers/providerUsageFixtures.testSupport";

test("private review mode survives client, transport and API boundaries into the actual provider system contract", async () => {
  const original = globalThis.fetch;
  const recorded: Array<Record<string, unknown>> = [];
  let providerCalls = 0, synthesisMode = false, repairMode = false;
  const router = new ModelRouter({config: {defaultProvider: "anthropic", mockMode: false,
    allowUnapprovedProvider: false, apiKeys: {anthropic: "fixture-key", openai: "fixture-key"}}});
  const deps = {router, orgStore: {
      resolveAuth: async () => ({orgId: "00000000-0000-4000-8000-000000000001",orgName: "fixture",plan: "enterprise",apiKeyId: "fixture"}),
      getOrganization: async () => ({plan: "enterprise"})
    } as unknown as import("../server/orgStore").OrgStore, sourceTurnAuthority: {
    // This test owns provider/prompt transport only. Actual grant admission is
    // exercised separately by sourceTurnAuthority.integration.test.ts.
    admit: async ({check,quota}: {check: (quota: PlanQuotaService,id: string,continuation: boolean,now: Date)=>Promise<void>;quota: PlanQuotaService}) => {
      await check(quota,"same-server-turn",true,new Date()); return {id:"same-server-turn",source:true};
    }, complete: async () => undefined, close: async () => undefined
  }, config: {defaultProvider: "anthropic" as const, mockMode: false, allowUnapprovedProvider: false, apiKeys: {}},
    serverConfig: {nodeEnv: "test", requireApiAuth: false, legacyApiToken: "fixture-token", jobsWorkersEnabled: false, devMode: true},
    planQuota: {cappedSubject: () => undefined,check: async () => undefined, recordTokens: async (_org: string, _plan: string, value: Record<string, unknown>) => {recorded.push(value);}} as unknown as PlanQuotaService};
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/v1/chat")) {
        assert.equal(body.sourceClaimReview, !synthesisMode);
        assert.equal(body.sourceEvidenceSynthesis, synthesisMode);
        assert.equal(body.sourceEvidenceRepair, repairMode);
        const chunks: string[] = []; let status = 0;
        const response = {writeHead: (code: number) => {status = code;}, write: (chunk: string) => chunks.push(chunk), end: () => undefined};
        await handleChatApiRequest({method: "POST", pathname: "/v1/chat", headers: {authorization: "Bearer fixture-token"}, body}, response as unknown as ServerResponse, deps);
        assert.equal(status, 200);
        return new Response(chunks.join(""), {status, headers: {"content-type": "text/event-stream"}});
      }
      providerCalls++;
      const system = body.system ? typeof body.system === "string" ? body.system
        : body.system.map((block: {text: string}) => block.text).join("\n") : body.messages.find((part: {role: string}) => part.role === "system").content;
      assert(system.includes(synthesisMode ? "frozen evidence envelope" : "private source-claim reviewer"));
      if (!synthesisMode) assert(system.includes("conditions, scope, attribution, operation, impact, unknown-premise"));
      if (!synthesisMode) {
        assert(!system.includes("Required response structure"));
        assert(!system.includes("Group each gap"));
      } else {
        assert(system.includes("IDE"), "Generation retains the trusted product output contract");
        assert(system.includes("[[source:window-1:12:13]]"));
        assert(!system.includes("```start:end:path"));
        assert(!system.includes("Required response structure"), "Frozen actions do not inherit competing legacy templates");
        assert(!system.includes("first body line is REAL integers"), "Only local source rendering owns code fences");
        assert(system.includes("16 rendered source cards"));
      }
      assert.equal(body.model, synthesisMode && !repairMode ? "claude-sonnet-4-6" : "gpt-5.5");
      const user = body.messages.find((part: {role: string}) => part.role === "user");
      const userText = typeof user.content === "string" ? user.content
        : user.content.map((part: {text: string}) => part.text).join("\n");
      assert.equal(userText, '{"candidate":"Review this as a PR; what would you block?"}');
      assert(!userText.includes("Turn directive"), "Candidate words must not trigger ordinary chat instructions");
      if (!synthesisMode || repairMode) {
        assert.equal(body.reasoning_effort, "low");
        assert.equal(body.max_completion_tokens, 32768);
        if (!synthesisMode) {
          assert.equal(body.response_format.type,"json_schema");
          assert.equal(body.response_format.json_schema.strict,true);
          const checkSchema = body.response_format.json_schema.schema.properties.checks.items;
          for (const field of ["category", "qualificationStatus", "counterexampleStatus", "publicQualifications"])
            assert(checkSchema.required.includes(field), `Native review grammar requires ${field}`);
          assert(checkSchema.properties.qualificationStatus.enum.includes("missing"));
          assert(checkSchema.properties.counterexampleStatus.enum.includes("unresolved-contradiction"));
          assert.equal(checkSchema.properties.publicQualifications.items.type, "string");
        } else assert.equal(body.response_format,undefined,"Corrective source prose does not request audit JSON");
        assert.equal(body.thinking, undefined);
        return new Response(usageFixture("openai", 10, 2, {text: "private-verdict"}));
      }
      assert.deepEqual(body.thinking, {type:"adaptive"});
      assert.equal(body.output_config.effort,"medium");
      assert.equal(body.output_config.format,undefined); assert.equal(body.response_format,undefined);
      return new Response(usageFixture("anthropic", 10, 2, {text: "private-verdict"}));
    };
    const client = new SecureApiClient({get: async () => "fixture-token"} as never);
    for ([synthesisMode, repairMode] of [[false,false],[true,false],[true,true]]) for (const useCase of ["blast_radius", "knowledge_gaps", "comprehension", "decision_archaeology", "ownership"] as const) {
      const request: StreamChatParams = {message: '{"candidate":"Review this as a PR; what would you block?"}', context: {owner: "tenant", repo: "repo", branch: "preview", file: "src/guard.ts"}, history: [],
        model: "claude-sonnet-4-6", provider: "anthropic", useCase, sourceClaimReview: !synthesisMode, sourceEvidenceSynthesis: synthesisMode, sourceEvidenceRepair: repairMode,
        enableThinking: synthesisMode && !repairMode, temperature: 0.5, maxTokens: 16000, quotaTurnId: "same-user-turn"};
      const result = await client.streamChat(request, () => undefined, "https://fixture.invalid");
      assert.equal(result.message.content, "private-verdict");
    }
    assert.equal(providerCalls, 15);
    assert.equal(recorded.length, 15);
    assert(recorded.every(value => value.quotaTurnId === "same-server-turn"));
    for (const body of [{useCase: "chat", sourceClaimReview: true}, {useCase: "blast_radius", sourceClaimReview: "true"},
      {useCase: "chat", sourceEvidenceSynthesis: true}, {useCase: "ownership", sourceEvidenceSynthesis: "true"},
      {useCase: "comprehension", sourceEvidenceSynthesis: true, sourceClaimReview: true},
      {useCase: "chat", sourceEvidenceSynthesis: true, sourceEvidenceRepair: true},
      {useCase: "blast_radius", sourceEvidenceRepair: true},
      {useCase: "ownership", sourceEvidenceSynthesis: true, sourceEvidenceRepair: "true"}]) {
      let status = 0;
      await handleChatApiRequest({method: "POST", pathname: "/v1/chat", headers: {}, body: {message: "test", ...body}},
        {writeHead: (code: number) => {status = code;}, end: () => undefined} as unknown as ServerResponse, deps);
      assert.equal(status, 400);
    }
    assert.equal(providerCalls, 15, "Invalid private modes never reach the provider");
  } finally {globalThis.fetch = original;}
});

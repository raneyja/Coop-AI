/**
 * Front-door billing ship gate. Touches `recordTokens` the same way `/v1/chat` does.
 * Helper-only plans that never record do not count.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { recordV1ChatUsageTokens } from "../../api/chatApi";
import {
  pickerAppliesToUseCase,
  resolveAssignedModelForUseCase,
  resolveHonoredChatModel
} from "../../config/featureModelAssignments";
import { loadPlanQuotaConfig, PlanQuotaService } from "../../server/planQuota";
import { UsageTracker } from "../../server/usageTracker";
import {
  FRONT_DOOR_INTERPRETER_USE_CASE,
  SLACK_SQL_INJECTION_SLASH_ASK
} from "./frontDoor";
import {
  planFrontDoorAnswerCompletions,
  planFrontDoorInterpretCompletions
} from "./frontDoorBilling";

const USE_REPO = "coopai-group/training-java-monolith-refactor";
const FRONTIER_PICK = "claude-opus-4-8";
const CONNECTED = ["slack", "jira", "confluence"] as const;

type RecordedUsage = {
  eventType: string;
  metadata: Record<string, unknown>;
};

function recordingQuota(): { quota: PlanQuotaService; events: RecordedUsage[] } {
  const events: RecordedUsage[] = [];
  const pool = {
    query: async (_sql: string, params: unknown[]) => {
      events.push({
        eventType: String(params[3]),
        metadata: JSON.parse(String(params[4])) as Record<string, unknown>
      });
      return { rows: [] };
    }
  };
  const quota = new PlanQuotaService(
    new UsageTracker(pool as never),
    loadPlanQuotaConfig({ COOP_PLAN_QUOTA_DISABLED: "false" })
  );
  return { quota, events };
}

const org = {
  orgId: "org-pro",
  plan: "pro" as const,
  userId: "user-1",
  principal: "user:test",
  usageTier: "pro" as const
};

async function recordCompletion(
  quota: PlanQuotaService,
  useCase: Parameters<typeof resolveHonoredChatModel>[0]["useCase"],
  requestId: string,
  tokens: { inputTokens: number; outputTokens: number }
): Promise<ReturnType<typeof resolveHonoredChatModel>> {
  const honored = resolveHonoredChatModel({
    allowUnapprovedProvider: false,
    plan: "pro",
    useCase,
    clientProvider: "anthropic",
    clientModel: FRONTIER_PICK
  });
  await recordV1ChatUsageTokens(quota, org, honored, {
    ...tokens,
    requestId
  });
  return honored;
}

test("one /slack topic ask bills one Auto interpreter and one separate answer — no re-entry third", async () => {
  assert.equal(pickerAppliesToUseCase("intent_suggest"), false);
  assert.equal(pickerAppliesToUseCase("intent_job"), true);
  assert.equal(FRONT_DOOR_INTERPRETER_USE_CASE, "intent_suggest");
  assert.equal(resolveAssignedModelForUseCase("intent_suggest").model, "gpt-4o-mini");

  const interpret = planFrontDoorInterpretCompletions({
    rawAsk: SLACK_SQL_INJECTION_SLASH_ASK,
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });
  const reentryInterpret = planFrontDoorInterpretCompletions({
    rawAsk: SLACK_SQL_INJECTION_SLASH_ASK,
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO,
    skipChatIntentPlanner: true
  });
  const answer = planFrontDoorAnswerCompletions({
    rawAsk: SLACK_SQL_INJECTION_SLASH_ASK,
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });

  assert.equal(interpret.length, 1);
  assert.equal(interpret[0]?.useCase, "intent_suggest");
  assert.deepEqual(reentryInterpret, []);
  assert.equal(answer.length, 1);
  assert.notEqual(answer[0]?.useCase, "intent_suggest");

  const { quota, events } = recordingQuota();
  const interpreterHonored = await recordCompletion(quota, interpret[0]!.useCase, "front-door-interpreter", {
    inputTokens: 80,
    outputTokens: 40
  });
  const answerHonored = await recordCompletion(quota, answer[0]!.useCase, "front-door-answer", {
    inputTokens: 900,
    outputTokens: 300
  });

  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.eventType === "chat.message"));

  const interpMeta = events[0]!.metadata;
  assert.equal(interpMeta.bucket, "auto");
  assert.equal(interpMeta.model, "gpt-4o-mini");
  assert.equal(interpMeta.provider, "openai");
  assert.equal(interpreterHonored.selection, "auto");
  assert.equal(interpreterHonored.model, "gpt-4o-mini");
  assert.notEqual(interpMeta.model, FRONTIER_PICK);

  const answerMeta = events[1]!.metadata;
  assert.equal(answerHonored.model, FRONTIER_PICK);
  assert.equal(answerHonored.selection, FRONTIER_PICK);
  assert.equal(answerMeta.model, FRONTIER_PICK);
  assert.equal(answerMeta.bucket, "frontier");
  assert.notEqual(answerMeta.model, interpMeta.model);
});

test("regex fail-open that never calls a model records zero interpreter tokens", async () => {
  const interpret = planFrontDoorInterpretCompletions({
    rawAsk: SLACK_SQL_INJECTION_SLASH_ASK,
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO,
    modelEnabled: false
  });
  assert.deepEqual(interpret, []);

  const bare = planFrontDoorInterpretCompletions({
    rawAsk: "/slack",
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });
  assert.deepEqual(bare, []);

  const { quota, events } = recordingQuota();
  const answer = planFrontDoorAnswerCompletions({
    rawAsk: "/slack",
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });
  assert.equal(answer.length, 1);
  await recordCompletion(quota, answer[0]!.useCase, "bare-slack-answer", {
    inputTokens: 200,
    outputTokens: 80
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.metadata.requestId, "bare-slack-answer");
  assert.equal(
    events.some((event) => event.metadata.model === "gpt-4o-mini" && event.metadata.bucket === "auto"),
    false
  );
});

test("front-door interpreter stream stays intent_suggest on the /v1/chat path", () => {
  const sessionPath = path.join(__dirname, "../CoopChatSession.ts");
  const src = fs.readFileSync(sessionPath, "utf8");
  assert.match(src, /useCase:\s*FRONT_DOOR_INTERPRETER_USE_CASE/);
  const apiPath = path.join(__dirname, "../../api/chatApi.ts");
  const apiSrc = fs.readFileSync(apiPath, "utf8");
  assert.match(apiSrc, /export async function recordV1ChatUsageTokens/);
  assert.match(apiSrc, /await recordV1ChatUsageTokens\(/);
  assert.doesNotMatch(apiSrc, /forceAutoBucket:\s*true[\s\S]{0,80}eventType:\s*"chat\.message"/);
});

import assert from "node:assert/strict";
import {
  DEFAULT_FREE_TOKEN_LIMIT,
  DEFAULT_ROLLING_WINDOW_MS,
  PlanQuotaExceededError,
  PlanQuotaService,
  computeQuotaResetsAt,
  estimateChatRequestTokens,
  loadPlanQuotaConfig,
  rollingWindowRange,
  tokensToCredits
} from "./planQuota";
import type { TokenUsageEvent } from "./usageTracker";
import { UsageTracker } from "./usageTracker";

void (async () => {
  const config = loadPlanQuotaConfig({
    COOP_FREE_TOKEN_LIMIT: "10000",
    COOP_FREE_ROLLING_WINDOW_MS: String(5 * 60 * 60 * 1000),
    COOP_PRICING_URL: "https://coop-ai.dev/pricing"
  });
  assert.equal(config.freeTokenLimit, 10_000);
  assert.equal(config.rollingWindowMs, DEFAULT_ROLLING_WINDOW_MS);
  assert.equal(config.enabled, true);

  const disabled = loadPlanQuotaConfig({ COOP_PLAN_QUOTA_DISABLED: "true" });
  assert.equal(disabled.enabled, false);

  assert.equal(tokensToCredits(1), 1);
  assert.equal(tokensToCredits(1000), 1);
  assert.equal(tokensToCredits(1001), 2);

  const textEstimate = estimateChatRequestTokens({
    message: "Explain this function",
    history: [{ content: "Hello" }],
    maxTokens: 2000,
    provider: "openai",
    model: "gpt-5.1"
  });
  assert.ok(textEstimate > 2000);

  const visionEstimate = estimateChatRequestTokens({
    message: "What's in this screenshot?",
    history: [{ content: "Hello" }],
    maxTokens: 2000,
    imageAttachmentCount: 1,
    provider: "openai",
    model: "gpt-5.1"
  });
  const textOnlyEstimate = estimateChatRequestTokens({
    message: "What's in this screenshot?",
    history: [{ content: "Hello" }],
    maxTokens: 2000,
    provider: "openai",
    model: "gpt-5.1"
  });
  assert.ok(visionEstimate > textOnlyEstimate);

  const miniEstimate = estimateChatRequestTokens({
    message: "Explain this function",
    history: [{ content: "Hello" }],
    maxTokens: 2000,
    provider: "openai",
    model: "gpt-5-mini"
  });
  const flagshipEstimate = estimateChatRequestTokens({
    message: "Explain this function",
    history: [{ content: "Hello" }],
    maxTokens: 2000,
    provider: "openai",
    model: "gpt-5.1"
  });
  assert.ok(flagshipEstimate > miniEstimate);

  const now = new Date("2026-06-12T15:00:00.000Z");
  const range = rollingWindowRange(now, DEFAULT_ROLLING_WINDOW_MS);
  assert.equal(range.to.toISOString(), now.toISOString());
  assert.equal(range.from.toISOString(), new Date(now.getTime() - DEFAULT_ROLLING_WINDOW_MS).toISOString());

  const events: TokenUsageEvent[] = [
    { createdAt: new Date("2026-06-12T11:00:00.000Z"), tokens: 6_000 },
    { createdAt: new Date("2026-06-12T13:00:00.000Z"), tokens: 5_000 }
  ];
  const blockedReset = computeQuotaResetsAt(events, 11_000, 10_000, DEFAULT_ROLLING_WINDOW_MS, now);
  assert.equal(blockedReset?.toISOString(), "2026-06-12T16:00:00.000Z");

  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("ORDER BY created_at ASC")) {
        assert.deepEqual(params[3], ["chat.message", "completion.suggested"]);
        return {
          rows: [
            { created_at: "2026-06-12T11:00:00.000Z", tokens: 6_000 },
            { created_at: "2026-06-12T13:00:00.000Z", tokens: 3_500 }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const tracker = new UsageTracker(pool as never);
  const quota = new PlanQuotaService(tracker, config);

  const snapshot = await quota.getSnapshot("org-free", "free");
  assert.ok(snapshot);
  assert.equal(snapshot?.usedTokens, 9_500);
  assert.equal(snapshot?.remainingTokens, 500);
  assert.equal(snapshot?.limitCredits, 10);
  assert.equal(snapshot?.windowHours, 5);

  try {
    await quota.check("org-free", "free", 600);
    assert.fail("expected quota check to reject");
  } catch (error) {
    assert.ok(error instanceof PlanQuotaExceededError);
    assert.equal(error.code, "quota_limit_reached");
    assert.equal(error.usedTokens, 9_500);
    assert.equal(error.limitTokens, 10_000);
    assert.match(error.message, /upgrade to Pro/i);
    assert.match(error.message, /5-hour window/);
  }

  await quota.check("org-free", "pro", 50_000);
  await quota.check("dev", "free", 50_000);

  let recorded: Record<string, unknown> | undefined;
  const recordingPool = {
    query: async (_sql: string, params: unknown[]) => {
      recorded = {
        orgId: params[0],
        eventType: params[3],
        metadata: JSON.parse(String(params[4]))
      };
      return { rows: [] };
    }
  };
  const recordingTracker = new UsageTracker(recordingPool as never);
  const recordingQuota = new PlanQuotaService(recordingTracker, config);
  await recordingQuota.recordTokens("org-free", "free", {
    eventType: "chat.message",
    inputTokens: 1200,
    outputTokens: 800,
    provider: "openai",
    model: "gpt-5.1",
    principal: "user:test",
    metadata: { requestId: "req-1" },
    visionWeighted: true
  });
  assert.equal(recorded?.orgId, "org-free");
  assert.equal(recorded?.eventType, "chat.message");
  assert.deepEqual(recorded?.metadata, {
    requestId: "req-1",
    provider: "openai",
    model: "gpt-5.1",
    inputTokens: 1200,
    outputTokens: 800,
    rawTokens: 2000,
    totalTokens: 16_000,
    billedTokens: 16_000,
    modelWeight: 4,
    visionMultiplier: 2,
    visionWeighted: true,
    plan: "free"
  });

  assert.equal(DEFAULT_FREE_TOKEN_LIMIT, 80_000);
  console.log("planQuota: 1/1 tests passed");
})();

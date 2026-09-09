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
        assert.deepEqual(params[3], ["chat.message", "completion.requested"]);
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

  // With 9,500 used and 500 remaining, requests should still be allowed.
  await quota.check("org-free", "free", 600);

  const exhaustedPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("ORDER BY created_at ASC")) {
        return {
          rows: [
            { created_at: "2026-06-12T11:00:00.000Z", tokens: 6_000 },
            { created_at: "2026-06-12T13:00:00.000Z", tokens: 4_000 }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const exhaustedQuota = new PlanQuotaService(new UsageTracker(exhaustedPool as never), config);
  try {
    await exhaustedQuota.check("org-free", "free", 1);
    assert.fail("expected quota check to reject when exhausted");
  } catch (error) {
    assert.ok(error instanceof PlanQuotaExceededError);
    assert.equal(error.code, "quota_limit_reached");
    assert.equal(error.usedTokens, 10_000);
    assert.equal(error.limitTokens, 10_000);
    assert.match(error.message, /upgrade to Pro/i);
    assert.match(error.message, /Try again at/i);
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
    plan: "free",
    bucket: "auto",
    usdCents: 2
  });

  assert.equal(DEFAULT_FREE_TOKEN_LIMIT, 80_000);

  const windowMs = DEFAULT_ROLLING_WINDOW_MS;
  const usageRows = [{ created_at: "2026-06-12T11:00:00.000Z", tokens: 10_000 }];
  const rollingPool = {
    query: async (sql: string, params: unknown[]) => {
      if (!sql.includes("ORDER BY created_at ASC")) {
        return { rows: [] };
      }
      const from = new Date(String(params[1]));
      const to = new Date(String(params[2]));
      const rows = usageRows.filter((row) => {
        const createdAt = new Date(row.created_at);
        return createdAt >= from && createdAt < to;
      });
      return { rows };
    }
  };
  const rollingQuota = new PlanQuotaService(new UsageTracker(rollingPool as never), config);
  const exhaustedAt = new Date("2026-06-12T15:00:00.000Z");
  try {
    await rollingQuota.check("org-free", "free", 0, exhaustedAt);
    assert.fail("expected quota check to reject when rolling window is full");
  } catch (error) {
    assert.ok(error instanceof PlanQuotaExceededError);
    assert.equal(error.resetsAt.toISOString(), "2026-06-12T16:00:00.000Z");
  }

  const afterReset = new Date("2026-06-12T16:00:01.000Z");
  await rollingQuota.check("org-free", "free", 0, afterReset);
  const recovered = await rollingQuota.getSnapshot("org-free", "free", afterReset);
  assert.equal(recovered?.usedTokens, 0);
  assert.equal(recovered?.remainingTokens, 10_000);

  const paidNow = new Date("2026-09-15T12:00:00.000Z");
  const centsByKey = new Map<string, { auto: number; frontier: number }>();
  function bucketKey(sql: string, params: unknown[]): string {
    if (sql.includes("user_id IS NULL")) {
      return "null";
    }
    if (sql.includes("user_id = $6")) {
      return String(params[5] ?? "null");
    }
    return "org";
  }
  const paidTrackerPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("INSERT INTO usage_events")) {
        const metadata = JSON.parse(String(params[4]));
        const bucket = metadata.bucket === "frontier" ? "frontier" : "auto";
        const key = params[1] ? String(params[1]) : "null";
        const current = centsByKey.get(key) ?? { auto: 0, frontier: 0 };
        current[bucket] += Number(metadata.usdCents ?? 0);
        centsByKey.set(key, current);
        return { rows: [] };
      }
      if (sql.includes("usdCents") && sql.includes("metadata->>'bucket'")) {
        const bucket = String(params[4]) === "frontier" ? "frontier" : "auto";
        const key = bucketKey(sql, params);
        return { rows: [{ total: (centsByKey.get(key) ?? { auto: 0, frontier: 0 })[bucket] }] };
      }
      return { rows: [] };
    }
  };
  const paidQuota = new PlanQuotaService(new UsageTracker(paidTrackerPool as never), config);

  await paidQuota.check("org-pro", "pro", 0, paidNow, {
    usageTier: "pro",
    userId: "user-a",
    selection: "auto",
    provider: "openai",
    model: "gpt-5-mini"
  });

  centsByKey.set("user-a", { auto: 1000, frontier: 0 });
  await paidQuota.check("org-pro", "pro", 0, paidNow, {
    usageTier: "pro",
    userId: "user-a",
    selection: "auto",
    provider: "openai",
    model: "gpt-5-mini"
  });

  centsByKey.set("user-a", { auto: 1000, frontier: 500 });
  try {
    await paidQuota.check("org-pro", "pro", 0, paidNow, {
      usageTier: "pro",
      userId: "user-a",
      selection: "auto",
      provider: "openai",
      model: "gpt-5-mini",
      periodAnchor: new Date("2026-09-04T17:00:00.000Z")
    });
    assert.fail("expected paid cap exhaustion to 429");
  } catch (error) {
    assert.ok(error instanceof PlanQuotaExceededError);
    assert.equal(error.pool, "paid");
    assert.equal(error.upgradePlan, "pro_plus");
    assert.equal(error.resetsAt.toISOString(), "2026-10-04T17:00:00.000Z");
    assert.match(error.message, /Upgrade to Pro\+/);
  }

  centsByKey.set("user-b", { auto: 0, frontier: 0 });
  await paidQuota.check("org-pro", "pro", 0, paidNow, {
    usageTier: "pro",
    userId: "user-b",
    selection: "auto",
    provider: "openai",
    model: "gpt-5-mini",
    periodAnchor: new Date("2026-09-04T17:00:00.000Z")
  });

  try {
    await paidQuota.check("org-pro", "pro", 0, paidNow, {
      usageTier: "pro",
      userId: "user-a",
      selection: "claude-opus-4-8",
      provider: "anthropic",
      model: "claude-opus-4-8"
    });
    assert.fail("expected paid cap to block Frontier picks too");
  } catch (error) {
    assert.ok(error instanceof PlanQuotaExceededError);
    assert.equal(error.pool, "paid");
  }

  const unavailable = new PlanQuotaService(undefined, config);
  try {
    await unavailable.check("org-pro", "pro", 0, paidNow, {
      usageTier: "pro",
      selection: "auto",
      provider: "openai",
      model: "gpt-5-mini"
    });
    assert.fail("expected paid check without tracker to fail closed");
  } catch (error) {
    assert.equal((error as Error).name, "PlanQuotaUnavailableError");
  }

  const meters = await paidQuota.getUsageMeters(
    "org-pro",
    "pro",
    "pro",
    paidNow,
    new Date("2026-09-04T17:00:00.000Z"),
    "user-a"
  );
  assert.ok(meters);
  assert.equal(meters?.displayName, "Pro");
  assert.equal(meters?.periodStart, "2026-09-04T17:00:00.000Z");
  assert.equal(meters?.periodEnd, "2026-10-04T17:00:00.000Z");
  assert.equal(meters?.limitCents, 1500);
  assert.equal(meters?.usedCents, 1500);
  assert.equal(meters?.remainingCents, 0);
  assert.equal(meters?.auto.limitCents, 1500);
  assert.equal(meters?.frontier.limitCents, 1500);
  assert.equal(meters?.auto.usedCents, 1000);
  assert.equal(meters?.frontier.usedCents, 500);

  centsByKey.set("user-record", { auto: 100, frontier: 50 });
  let recordedMeta: Record<string, unknown> | undefined;
  const recordPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("INSERT INTO usage_events")) {
        recordedMeta = JSON.parse(String(params[4]));
        return { rows: [] };
      }
      if (sql.includes("usdCents") && sql.includes("metadata->>'bucket'")) {
        const bucket = String(params[4]) === "frontier" ? "frontier" : "auto";
        return { rows: [{ total: (centsByKey.get("user-record") ?? { auto: 0, frontier: 0 })[bucket] }] };
      }
      return { rows: [] };
    }
  };
  const recordQuota = new PlanQuotaService(new UsageTracker(recordPool as never), config);
  await recordQuota.recordTokens("org-pro", "pro", {
    eventType: "chat.message",
    inputTokens: 1000,
    outputTokens: 0,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    principal: "user:test",
    selection: "auto",
    usageTier: "pro"
  });
  assert.equal(recordedMeta?.bucket, "auto");
  assert.equal(recordedMeta?.overflowedFromAuto, undefined);

  const groupedPool = {
    query: async (sql: string) => {
      if (sql.includes("GROUP BY user_id")) {
        return {
          rows: [
            { user_id: "user-a", bucket: "auto", total: 200 },
            { user_id: "user-a", bucket: "frontier", total: 50 }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const groupedQuota = new PlanQuotaService(new UsageTracker(groupedPool as never), config);
  const byUser = await groupedQuota.getUsageMetersForUsers(
    "org-pro",
    "pro",
    [
      { id: "user-a", usageTier: "pro" },
      { id: "user-b", usageTier: "pro_plus" }
    ],
    paidNow,
    new Date("2026-09-04T17:00:00.000Z")
  );
  assert.equal(byUser.get("user-a")?.usedCents, 250);
  assert.equal(byUser.get("user-a")?.auto.usedCents, 200);
  assert.equal(byUser.get("user-a")?.frontier.usedCents, 50);
  assert.equal(byUser.get("user-b")?.displayName, "Pro+");
  assert.equal(byUser.get("user-b")?.usedCents, 0);
  const enterpriseSeats = await groupedQuota.getUsageMetersForUsers("org-ent", "enterprise", [
    { id: "user-a", usageTier: "pro" }
  ]);
  assert.equal(enterpriseSeats.size, 0);

  console.log("planQuota: 1/1 tests passed");
})();

import assert from "node:assert/strict";
import test from "node:test";
import { countFreeMessages, eventFreeCostUsd, flashListCostUsd, summarizeFreeAllowance } from "./freeAllowance";
import { PlanQuotaService, PlanQuotaExceededError, loadPlanQuotaConfig } from "./planQuota";
import { UsageTracker } from "./usageTracker";

// Standard GPT-5.5 fixture: 10 input at $5/M plus 10 output at $30/M = $0.00035.

test("mixed generation and source verification retain one Free message and all raw costs without a cent floor", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const generation = {createdAt: now, inputTokens: 10, outputTokens: 10, model: "gemini-2.5-flash", quotaTurnId: "one-send", countsAsMessage: true};
  const review = {...generation, model: "gpt-5.5", sourceClaimReview: true};
  const repair = {...review, sourceClaimReview: false, sourceEvidenceRepair: true};
  const events = [generation, review, repair];
  assert.equal(countFreeMessages(events), 1);
  assert.equal(eventFreeCostUsd(review), 0.00035);
  assert.equal(eventFreeCostUsd(repair), 0.00035);
  assert.equal(eventFreeCostUsd({...repair, sourceClaimReview: true}), 0.00035, "Each call is counted once, regardless of its internal markers");
  assert.equal(eventFreeCostUsd({...review, sourceClaimReview: false}), 0);
  assert.equal(eventFreeCostUsd({...review, sourceReviewCostUsd: NaN}), 0.00035);
  assert.equal(eventFreeCostUsd({...generation, sourceClaimReview: true, sourceReviewCostUsd: 123}), flashListCostUsd(10, 10));
  const totals = summarizeFreeAllowance({cycleEvents: events, weekEvents: events, weekEnd: new Date(now.getTime() + 86400000), windowMs: 3600000, now});
  const expectedCycleUsd = flashListCostUsd(10, 10) + 0.0007;
  // The aggregate can differ by one binary accumulation rounding step; per-call charges remain exact above.
  assert.ok(Math.abs(totals.cycleUsd - expectedCycleUsd) <= Number.EPSILON * expectedCycleUsd);
  assert.equal(totals.messages, 1); assert.equal(totals.exhausted, false);
  const blocked = summarizeFreeAllowance({cycleEvents: [{...review, sourceReviewCostUsd: 1.75}], weekEvents: [{...review, sourceReviewCostUsd: 1.75}], weekEnd: new Date(now.getTime() + 86400000), windowMs: 3600000, now});
  assert.equal(blocked.exhausted, true); assert.equal(blocked.blockedWindow, "cycle");
  const weekBlocked = summarizeFreeAllowance({cycleEvents: [generation], weekEvents: [{...review, sourceReviewCostUsd: 7}],
    weekEnd: new Date(now.getTime() + 86400000), windowMs: 3600000, now, quotaTurnId: "one-send"});
  assert.equal(weekBlocked.exhausted, true); assert.equal(weekBlocked.blockedWindow, "week");
});

test("server-persisted actual verifier cost is Auto usage and survives allowance SQL projection", async () => {
  let metadata: Record<string, unknown> = {};
  const now = new Date();
  const pool = {query: async (sql: string, params: unknown[]) => {
    if (sql.includes("INSERT INTO usage_events")) {metadata = JSON.parse(String(params[4])); return {rows: []};}
    assert(sql.includes("sourceClaimReview")); assert(sql.includes("sourceReviewCostUsd"));
    return {rows: [{created_at: now.toISOString(), input_tokens: metadata.inputTokens, output_tokens: metadata.outputTokens,
      model: metadata.model, use_case: metadata.useCase, quota_turn_id: metadata.quotaTurnId,
      counts_as_message: metadata.countsAsMessage, source_claim_review: metadata.sourceClaimReview,
      source_evidence_repair: metadata.sourceEvidenceRepair,
      source_review_cost_usd: metadata.sourceReviewCostUsd}]};
  }};
  const tracker = new UsageTracker(pool as never);
  const quota = new PlanQuotaService(tracker, loadPlanQuotaConfig());
  await quota.recordTokens("org", "free", {eventType: "chat.message", principal: "user:test", model: "gpt-5.5", provider: "openai",
    inputTokens: 10, outputTokens: 10, selection: "auto", useCase: "ownership", quotaTurnId: "same-send", metadata: {sourceClaimReview: true}});
  assert.equal(metadata.sourceReviewCostUsd, 0.00035); assert.equal(metadata.usdCents, 1); assert.equal(metadata.bucket, "auto");
  const events = await tracker.listAllowanceEventsForOrg("org", {from: now, to: new Date(now.getTime() + 1000)}, ["chat.message"]);
  assert.equal(events[0].sourceClaimReview, true); assert.equal(events[0].sourceReviewCostUsd, 0.00035);
  assert.equal(eventFreeCostUsd(events[0]), 0.00035); assert.equal(countFreeMessages(events), 1);
  await quota.recordTokens("org", "free", {eventType: "chat.message", principal: "user:test", model: "gpt-5.5", provider: "openai",
    inputTokens: 10, outputTokens: 10, selection: "auto", useCase: "ownership", quotaTurnId: "same-send", metadata: {sourceEvidenceRepair: true}});
  assert.equal(metadata.sourceReviewCostUsd, 0.00035); assert.equal(metadata.bucket, "auto");
  const replacements = await tracker.listAllowanceEventsForOrg("org", {from: now, to: new Date(now.getTime() + 1000)}, ["chat.message"]);
  assert.equal(replacements[0].sourceEvidenceRepair, true); assert.equal(eventFreeCostUsd(replacements[0]), 0.00035);
  assert.equal(countFreeMessages([...events, ...replacements]), 1);
});

test("the fifteenth recorded turn can finish verification, while new turns and exhausted dollar limits stay blocked", async () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const rows = Array.from({length: 15}, (_, index) => ({created_at: now.toISOString(), input_tokens: 10, output_tokens: 10,
    model: "gemini-2.5-flash", use_case: "ownership", quota_turn_id: `send-${index}`, counts_as_message: "true", flash_cost_usd: 0.000028}));
  let reviewCost = 0;
  const pool = {query: async (sql: string) => sql.includes("MIN(created_at)") ? {rows: [{oldest: now.toISOString()}]}
    : {rows: [...rows, ...(reviewCost ? [{created_at: now.toISOString(), input_tokens: 1, output_tokens: 1,
      model: "gpt-5.5", quota_turn_id: "send-14", counts_as_message: "true", source_claim_review: "true", source_review_cost_usd: reviewCost}] : [])]}};
  const quota = new PlanQuotaService(new UsageTracker(pool as never), loadPlanQuotaConfig());
  const context = {provider: "openai" as const, model: "gpt-5.5", selection: "auto", quotaTurnId: "send-14", internalSourceCall: true};
  await quota.check("org", "free", 0, now, context);
  assert.equal((await quota.getSnapshot("org", "free", now))?.exhausted, true, "New user sends remain blocked");
  await assert.rejects(quota.check("org", "free", 0, now, {...context, quotaTurnId: "new-send"}), PlanQuotaExceededError);
  await assert.rejects(quota.check("org", "free", 0, now, {...context, internalSourceCall: false}), PlanQuotaExceededError,
    "An ordinary new request cannot continue a recorded turn merely by reusing its ID");
  reviewCost = 1.75;
  await assert.rejects(quota.check("org", "free", 0, now, context), PlanQuotaExceededError);
});

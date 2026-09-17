import { principalForUser } from "./audit/auditLogger";
import type { OrgBilling, Organization } from "./orgStore";
import {
  capKindForPlan,
  loadUserUsageSnapshot,
  type OperatorUsageCapKind,
  type OperatorUserUsageSnapshot
} from "./operatorUsage";
import { QUOTA_CREDIT_EVENT_TYPE } from "./planQuota";
import type { UsageTracker } from "./usageTracker";
import type { UserRecord } from "./users/userStore";

export const USAGE_CREDIT_TARGET_RATIOS = [0, 0.25, 0.5] as const;
export type UsageCreditTargetRatio = (typeof USAGE_CREDIT_TARGET_RATIOS)[number];

export const USAGE_CREDIT_REASON_MAX = 500;

export { QUOTA_CREDIT_EVENT_TYPE };

export function parseUsageCreditTargetRatio(value: unknown): UsageCreditTargetRatio | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 0 || n === 0.25 || n === 0.5) {
    return n;
  }
  return undefined;
}

export function parseUsageCreditReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const reason = value.trim();
  if (reason.length < 1 || reason.length > USAGE_CREDIT_REASON_MAX) {
    return undefined;
  }
  return reason;
}

/** How many units to subtract so used lands on targetRatio * limit. */
export function creditAmountToReachRatio(
  used: number,
  limit: number,
  targetRatio: UsageCreditTargetRatio
): number {
  const clampedUsed = Math.max(0, Math.round(used));
  const clampedLimit = Math.max(0, Math.round(limit));
  const targetUsed = Math.round(targetRatio * clampedLimit);
  return Math.max(0, clampedUsed - targetUsed);
}

export function splitPaidCreditCents(
  autoCents: number,
  frontierCents: number,
  creditCents: number
): { auto: number; frontier: number } {
  const auto = Math.max(0, Math.round(autoCents));
  const frontier = Math.max(0, Math.round(frontierCents));
  const total = auto + frontier;
  const credit = Math.max(0, Math.round(creditCents));
  if (credit <= 0 || total <= 0) {
    return { auto: 0, frontier: 0 };
  }
  if (credit >= total) {
    return { auto, frontier };
  }
  const autoCredit = Math.min(auto, Math.round((auto / total) * credit));
  let frontierCredit = Math.min(frontier, credit - autoCredit);
  let leftover = credit - autoCredit - frontierCredit;
  if (leftover > 0 && auto - autoCredit >= leftover) {
    return { auto: autoCredit + leftover, frontier: frontierCredit };
  }
  if (leftover > 0) {
    frontierCredit = Math.min(frontier, frontierCredit + leftover);
  }
  return { auto: autoCredit, frontier: frontierCredit };
}

export type UsageCreditSuccess = {
  ok: true;
  applied: boolean;
  targetUsedRatio: UsageCreditTargetRatio;
  capKind: OperatorUsageCapKind;
  creditTokens: number;
  creditAutoCents: number;
  creditFrontierCents: number;
  beforeUsedRatio: number | null;
  afterUsedRatio: number | null;
  user: OperatorUserUsageSnapshot;
};

export type UsageCreditFailure = {
  ok: false;
  error: "not_applicable" | "usage_unavailable";
};

export type UsageCreditResult = UsageCreditSuccess | UsageCreditFailure;

export async function applyOperatorUsageCredit(input: {
  org: Organization;
  billing?: OrgBilling;
  user: UserRecord;
  usageTracker: UsageTracker;
  targetUsedRatio: UsageCreditTargetRatio;
  reason: string;
  operatorEmail: string;
  now?: Date;
}): Promise<UsageCreditResult> {
  if (!input.usageTracker.canRead()) {
    return { ok: false, error: "usage_unavailable" };
  }
  const capKind = capKindForPlan(input.org.plan);
  if (capKind === "unlimited") {
    return { ok: false, error: "not_applicable" };
  }

  const before = await loadUserUsageSnapshot({
    org: input.org,
    billing: input.billing,
    user: input.user,
    usageTracker: input.usageTracker,
    now: input.now
  });

  const credits =
    capKind === "free_credits"
      ? planFreeCredit(before, input.targetUsedRatio)
      : planPaidCredit(before, input.targetUsedRatio);

  if (!credits) {
    return { ok: false, error: capKind === "free_credits" ? "usage_unavailable" : "not_applicable" };
  }

  const beforeUsedRatio = credits.usedRatio;
  if (credits.creditTokens <= 0 && credits.creditAutoCents <= 0 && credits.creditFrontierCents <= 0) {
    return {
      ok: true,
      applied: false,
      targetUsedRatio: input.targetUsedRatio,
      capKind,
      creditTokens: 0,
      creditAutoCents: 0,
      creditFrontierCents: 0,
      beforeUsedRatio,
      afterUsedRatio: beforeUsedRatio,
      user: before
    };
  }

  const principal = principalForUser(input.user.id);
  const baseMeta = {
    plan: input.org.plan,
    operatorCredit: true,
    targetUsedRatio: input.targetUsedRatio,
    reason: input.reason,
    operatorEmail: input.operatorEmail
  };

  if (credits.creditTokens > 0) {
    const tokens = -credits.creditTokens;
    await input.usageTracker.record({
      orgId: input.org.id,
      userId: input.user.id,
      principal,
      eventType: QUOTA_CREDIT_EVENT_TYPE,
      metadata: {
        ...baseMeta,
        totalTokens: tokens,
        billedTokens: tokens
      }
    });
  }

  if (credits.creditAutoCents > 0) {
    await input.usageTracker.record({
      orgId: input.org.id,
      userId: input.user.id,
      principal,
      eventType: QUOTA_CREDIT_EVENT_TYPE,
      metadata: {
        ...baseMeta,
        usdCents: -credits.creditAutoCents,
        bucket: "auto"
      }
    });
  }

  if (credits.creditFrontierCents > 0) {
    await input.usageTracker.record({
      orgId: input.org.id,
      userId: input.user.id,
      principal,
      eventType: QUOTA_CREDIT_EVENT_TYPE,
      metadata: {
        ...baseMeta,
        usdCents: -credits.creditFrontierCents,
        bucket: "frontier"
      }
    });
  }

  const after = await loadUserUsageSnapshot({
    org: input.org,
    billing: input.billing,
    user: input.user,
    usageTracker: input.usageTracker,
    now: input.now
  });

  return {
    ok: true,
    applied: true,
    targetUsedRatio: input.targetUsedRatio,
    capKind,
    creditTokens: credits.creditTokens,
    creditAutoCents: credits.creditAutoCents,
    creditFrontierCents: credits.creditFrontierCents,
    beforeUsedRatio,
    afterUsedRatio: creditUsedRatio(after, capKind),
    user: after
  };
}

function planFreeCredit(
  snapshot: OperatorUserUsageSnapshot,
  targetUsedRatio: UsageCreditTargetRatio
): { usedRatio: number | null; creditTokens: number; creditAutoCents: number; creditFrontierCents: number } | undefined {
  if (!snapshot.free) {
    return undefined;
  }
  return {
    usedRatio: snapshot.free.usedRatio,
    creditTokens: creditAmountToReachRatio(
      snapshot.free.usedTokens,
      snapshot.free.limitTokens,
      targetUsedRatio
    ),
    creditAutoCents: 0,
    creditFrontierCents: 0
  };
}

function planPaidCredit(
  snapshot: OperatorUserUsageSnapshot,
  targetUsedRatio: UsageCreditTargetRatio
): { usedRatio: number | null; creditTokens: number; creditAutoCents: number; creditFrontierCents: number } | undefined {
  const limitCents = snapshot.includedCents;
  if (limitCents == null || limitCents <= 0) {
    return undefined;
  }
  const usedCents = Math.max(0, snapshot.autoCents + snapshot.frontierCents);
  const creditCents = creditAmountToReachRatio(usedCents, limitCents, targetUsedRatio);
  const split = splitPaidCreditCents(snapshot.autoCents, snapshot.frontierCents, creditCents);
  return {
    usedRatio: snapshot.usedRatio,
    creditTokens: 0,
    creditAutoCents: split.auto,
    creditFrontierCents: split.frontier
  };
}

function creditUsedRatio(
  snapshot: OperatorUserUsageSnapshot,
  capKind: OperatorUsageCapKind
): number | null {
  if (capKind === "free_credits") {
    return snapshot.free?.usedRatio ?? null;
  }
  return snapshot.usedRatio;
}

import { principalForUser } from "./audit/auditLogger";
import {
  emptySeatInventory,
  inventoryFromOrgColumns,
  seatInventoryTotal,
  type SeatInventory
} from "./billing/seatInventory";
import type { OrgBilling, OrgPlan, Organization } from "./orgStore";
import {
  createPlanQuotaService,
  LLM_USAGE_EVENT_TYPES,
  rollingWindowRange,
  type PaidUsageMeters,
  type PlanQuotaService
} from "./planQuota";
import {
  paidUsagePeriodRange,
  USAGE_TIER_LIMITS,
  type UsageTier
} from "./usageTiers";
import {
  productMixFromEventTypes,
  type ProductMix,
  type UsageTracker
} from "./usageTracker";
import type { UserRecord } from "./users/userStore";

export const USAGE_NEAR_CAP_RATIO = 0.8;

export type OperatorUsageCapKind = "paid_included" | "free_credits" | "unlimited";
export type OperatorUsageAlertCode = "near_cap" | "at_cap" | "unprofitable";

export type OperatorOrgUsageSummary = {
  capKind: OperatorUsageCapKind;
  periodStart: string;
  periodEnd: string;
  usedCents: number;
  includedCents: number | null;
  usedRatio: number | null;
  seatRevenueCents: number | null;
  marginCents: number | null;
  alerts: OperatorUsageAlertCode[];
};

export type OperatorOrgUsageSnapshot = OperatorOrgUsageSummary & {
  autoCents: number;
  frontierCents: number;
  productMix: ProductMix;
  free?: {
    usedTokens: number;
    limitTokens: number;
    remainingTokens: number;
    usedRatio: number;
    resetsAt: string;
  };
};

export type OperatorUserUsageSnapshot = {
  userId: string;
  email: string;
  role: string;
  status: "active" | "invited" | "deactivated";
  usageTier: UsageTier | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  capKind: OperatorUsageCapKind;
  periodStart: string;
  periodEnd: string;
  usedCents: number;
  includedCents: number | null;
  usedRatio: number | null;
  autoCents: number;
  frontierCents: number;
  productMix: ProductMix;
  alerts: OperatorUsageAlertCode[];
};

export type OperatorUsageQueueItem = {
  orgId: string;
  orgName: string;
  plan: OrgPlan;
  usedCents: number;
  includedCents: number | null;
  usedRatio: number | null;
  seatRevenueCents: number | null;
  marginCents: number | null;
  trigger: "org" | "user";
  userEmail?: string;
};

/** Unclamped used/limit. Null when there is no cap to compare. */
export function unclampedRatio(used: number, limit: number | null | undefined): number | null {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }
  if (!Number.isFinite(used) || used < 0) {
    return 0;
  }
  return used / limit;
}

export function inventoryListPriceEconomics(inventory: SeatInventory): {
  seatRevenueCents: number;
  includedCents: number;
} {
  let seatRevenueCents = 0;
  let includedCents = 0;
  for (const tier of ["pro", "pro_plus", "max"] as const) {
    const count = Math.max(0, Math.floor(inventory[tier] || 0));
    seatRevenueCents += count * USAGE_TIER_LIMITS[tier].seatPriceUsd * 100;
    includedCents += count * USAGE_TIER_LIMITS[tier].costCents;
  }
  return { seatRevenueCents, includedCents };
}

export function purchasedSeatInventory(billing: OrgBilling | undefined): SeatInventory {
  if (billing?.seatInventory && seatInventoryTotal(billing.seatInventory) > 0) {
    return billing.seatInventory;
  }
  return inventoryFromOrgColumns({
    seatCount: billing?.seatCount ?? 0,
    usageTier: billing?.usageTier ?? null
  });
}

export function occupiedSeatInventory(users: Array<{ usageTier?: UsageTier | string | null; deactivatedAt?: Date }>): SeatInventory {
  const occupied = emptySeatInventory();
  for (const user of users) {
    if (user.deactivatedAt) {
      continue;
    }
    const tier = user.usageTier === "pro_plus" || user.usageTier === "max" || user.usageTier === "pro" ? user.usageTier : "pro";
    occupied[tier] += 1;
  }
  return occupied;
}

export function paidPlanEconomics(
  plan: OrgPlan,
  billing: OrgBilling | undefined,
  users: Array<{ usageTier?: UsageTier | string | null; deactivatedAt?: Date }>
): { seatRevenueCents: number | null; includedCents: number | null } {
  if (plan !== "pro") {
    return { seatRevenueCents: null, includedCents: null };
  }
  const purchased = purchasedSeatInventory(billing);
  const source = seatInventoryTotal(purchased) > 0 ? purchased : occupiedSeatInventory(users);
  if (seatInventoryTotal(source) <= 0) {
    return { seatRevenueCents: 0, includedCents: 0 };
  }
  return inventoryListPriceEconomics(source);
}

export function alertsForCapRatio(usedRatio: number | null): OperatorUsageAlertCode[] {
  if (usedRatio == null || !Number.isFinite(usedRatio)) {
    return [];
  }
  if (usedRatio >= 1) {
    return ["at_cap"];
  }
  if (usedRatio >= USAGE_NEAR_CAP_RATIO) {
    return ["near_cap"];
  }
  return [];
}

export function alertsForPaidOrg(input: {
  usedRatio: number | null;
  usedCents: number;
  seatRevenueCents: number | null;
}): OperatorUsageAlertCode[] {
  const alerts = alertsForCapRatio(input.usedRatio);
  if (
    input.seatRevenueCents != null &&
    input.seatRevenueCents > 0 &&
    input.usedCents > input.seatRevenueCents
  ) {
    alerts.push("unprofitable");
  }
  return alerts;
}

export function capKindForPlan(plan: OrgPlan): OperatorUsageCapKind {
  if (plan === "pro") {
    return "paid_included";
  }
  if (plan === "free") {
    return "free_credits";
  }
  return "unlimited";
}

export function operatorUserStatus(user: UserRecord): OperatorUserUsageSnapshot["status"] {
  if (user.deactivatedAt) {
    return "deactivated";
  }
  return user.lastLoginAt ? "active" : "invited";
}

function principalAliasesForUser(user: UserRecord): string[] {
  const aliases = new Set<string>([principalForUser(user.id), user.id]);
  const email = user.email.trim();
  if (email) {
    aliases.add(email);
    aliases.add(email.toLowerCase());
  }
  return [...aliases];
}

async function sumLlmCents(
  usageTracker: UsageTracker,
  orgId: string,
  range: { from: Date; to: Date }
): Promise<{ autoCents: number; frontierCents: number; usedCents: number }> {
  const eventTypes = [...LLM_USAGE_EVENT_TYPES];
  const [autoCents, frontierCents] = await Promise.all([
    usageTracker.sumUsdCentsForOrg(orgId, range, eventTypes, "auto"),
    usageTracker.sumUsdCentsForOrg(orgId, range, eventTypes, "frontier")
  ]);
  return { autoCents, frontierCents, usedCents: autoCents + frontierCents };
}

function periodIso(anchor: Date | undefined, now: Date): { periodStart: string; periodEnd: string; range: { from: Date; to: Date } } {
  const range = paidUsagePeriodRange(anchor, now);
  return { periodStart: range.from.toISOString(), periodEnd: range.to.toISOString(), range };
}

export async function loadOrgUsageSnapshot(input: {
  org: Organization;
  billing?: OrgBilling;
  users: UserRecord[];
  usageTracker: UsageTracker;
  now?: Date;
  quota?: PlanQuotaService;
  includeMix?: boolean;
}): Promise<OperatorOrgUsageSnapshot> {
  const now = input.now ?? new Date();
  const capKind = capKindForPlan(input.org.plan);
  const quota = input.quota ?? createPlanQuotaService(input.usageTracker);
  const includeMix = input.includeMix !== false;

  if (capKind === "free_credits") {
    const snapshot = await quota.getSnapshot(input.org.id, "free", now);
    const windowMs = snapshot ? snapshot.windowHours * 3_600_000 : 5 * 60 * 60 * 1000;
    const range = rollingWindowRange(now, windowMs);
    const [cents, byType] = await Promise.all([
      sumLlmCents(input.usageTracker, input.org.id, range),
      includeMix ? input.usageTracker.eventsByType(input.org.id, range) : Promise.resolve([])
    ]);
    const usedRatio = snapshot
      ? unclampedRatio(snapshot.usedTokens, snapshot.limitTokens) ?? 0
      : 0;
    return {
      capKind,
      periodStart: range.from.toISOString(),
      periodEnd: snapshot?.resetsAt ?? now.toISOString(),
      usedCents: cents.usedCents,
      includedCents: null,
      usedRatio,
      seatRevenueCents: 0,
      marginCents: null,
      alerts: alertsForCapRatio(usedRatio),
      autoCents: cents.autoCents,
      frontierCents: cents.frontierCents,
      productMix: productMixFromEventTypes(byType),
      free: snapshot
        ? {
            usedTokens: snapshot.usedTokens,
            limitTokens: snapshot.limitTokens,
            remainingTokens: snapshot.remainingTokens,
            usedRatio,
            resetsAt: snapshot.resetsAt
          }
        : undefined
    };
  }

  const { periodStart, periodEnd, range } = periodIso(input.org.createdAt, now);
  const [cents, byType] = await Promise.all([
    sumLlmCents(input.usageTracker, input.org.id, range),
    includeMix ? input.usageTracker.eventsByType(input.org.id, range) : Promise.resolve([])
  ]);
  const economics = paidPlanEconomics(input.org.plan, input.billing, input.users);
  const productMix = productMixFromEventTypes(byType);

  const usedRatio =
    capKind === "paid_included" ? unclampedRatio(cents.usedCents, economics.includedCents) : null;
  const seatRevenueCents = economics.seatRevenueCents;
  const marginCents =
    seatRevenueCents != null ? seatRevenueCents - cents.usedCents : null;

  return {
    capKind,
    periodStart,
    periodEnd,
    usedCents: cents.usedCents,
    includedCents: economics.includedCents,
    usedRatio,
    seatRevenueCents,
    marginCents,
    alerts:
      capKind === "paid_included"
        ? alertsForPaidOrg({
            usedRatio,
            usedCents: cents.usedCents,
            seatRevenueCents
          })
        : [],
    autoCents: cents.autoCents,
    frontierCents: cents.frontierCents,
    productMix
  };
}

export async function loadOrgUsageSummary(input: {
  org: Organization;
  billing?: OrgBilling;
  users: UserRecord[];
  usageTracker: UsageTracker;
  now?: Date;
  quota?: PlanQuotaService;
}): Promise<OperatorOrgUsageSummary> {
  const snapshot = await loadOrgUsageSnapshot({ ...input, includeMix: false });
  return {
    capKind: snapshot.capKind,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    usedCents: snapshot.usedCents,
    includedCents: snapshot.includedCents,
    usedRatio: snapshot.usedRatio,
    seatRevenueCents: snapshot.seatRevenueCents,
    marginCents: snapshot.marginCents,
    alerts: snapshot.alerts
  };
}

export function userAlertsFromMeters(meters: PaidUsageMeters | undefined): OperatorUsageAlertCode[] {
  if (!meters) {
    return [];
  }
  return alertsForCapRatio(unclampedRatio(meters.usedCents, meters.limitCents));
}

export async function loadUserUsageSnapshot(input: {
  org: Organization;
  billing?: OrgBilling;
  user: UserRecord;
  usageTracker: UsageTracker;
  now?: Date;
  quota?: PlanQuotaService;
}): Promise<OperatorUserUsageSnapshot> {
  const now = input.now ?? new Date();
  const capKind = capKindForPlan(input.org.plan);
  const quota = input.quota ?? createPlanQuotaService(input.usageTracker);
  let { periodStart, periodEnd, range } = periodIso(input.org.createdAt, now);
  if (capKind === "free_credits") {
    const snapshot = await quota.getSnapshot(input.org.id, "free", now);
    const windowMs = snapshot ? snapshot.windowHours * 3_600_000 : 5 * 60 * 60 * 1000;
    range = rollingWindowRange(now, windowMs);
    periodStart = range.from.toISOString();
    periodEnd = snapshot?.resetsAt ?? now.toISOString();
  }
  const aliases = principalAliasesForUser(input.user);
  const eventTypes = [...LLM_USAGE_EVENT_TYPES];
  const [byType, lastActiveRows, metersByUser, pooledCents] = await Promise.all([
    input.usageTracker.eventsByTypeForPrincipals(input.org.id, aliases, range),
    input.usageTracker.lastActiveAtByPrincipal(input.org.id, aliases),
    capKind === "paid_included"
      ? quota.getUsageMetersForUsers(
          input.org.id,
          input.org.plan,
          [{ id: input.user.id, usageTier: input.user.usageTier ?? input.billing?.usageTier }],
          now,
          input.org.createdAt
        )
      : Promise.resolve(new Map<string, PaidUsageMeters>()),
    capKind === "paid_included"
      ? Promise.resolve(new Map<string, { autoCents: number; frontierCents: number }>())
      : input.usageTracker.sumUsdCentsByUserIds(input.org.id, range, eventTypes, [input.user.id])
  ]);
  const meters = metersByUser.get(input.user.id);
  const pooled = pooledCents.get(input.user.id);
  const autoCents = meters?.auto.usedCents ?? pooled?.autoCents ?? 0;
  const frontierCents = meters?.frontier.usedCents ?? pooled?.frontierCents ?? 0;
  const usedCents = meters?.usedCents ?? autoCents + frontierCents;
  const includedCents = meters?.limitCents ?? null;
  const lastActiveAt = lastActiveRows.reduce<Date | undefined>((latest, row) => {
    if (!latest || row.lastActiveAt > latest) {
      return row.lastActiveAt;
    }
    return latest;
  }, undefined);

  return {
    userId: input.user.id,
    email: input.user.email,
    role: input.user.role === "owner" ? "admin" : input.user.role,
    status: operatorUserStatus(input.user),
    usageTier: input.user.usageTier ?? null,
    lastLoginAt: input.user.lastLoginAt ? input.user.lastLoginAt.toISOString() : null,
    lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
    capKind,
    periodStart,
    periodEnd,
    usedCents,
    includedCents,
    usedRatio: unclampedRatio(usedCents, includedCents),
    autoCents,
    frontierCents,
    productMix: productMixFromEventTypes(byType),
    alerts: userAlertsFromMeters(meters)
  };
}

export async function loadUserUsageSummaries(input: {
  org: Organization;
  billing?: OrgBilling;
  users: UserRecord[];
  usageTracker: UsageTracker;
  now?: Date;
  quota?: PlanQuotaService;
}): Promise<Map<string, Pick<OperatorUserUsageSnapshot, "usedCents" | "includedCents" | "usedRatio" | "lastActiveAt" | "alerts" | "usageTier">>> {
  const now = input.now ?? new Date();
  const capKind = capKindForPlan(input.org.plan);
  const quota = input.quota ?? createPlanQuotaService(input.usageTracker);
  const active = input.users.filter((user) => !user.deactivatedAt);
  const range = paidUsagePeriodRange(input.org.createdAt, now);
  const [metersByUser, lastActiveRows, pooledCents] = await Promise.all([
    capKind === "paid_included"
      ? quota.getUsageMetersForUsers(
          input.org.id,
          input.org.plan,
          active.map((user) => ({
            id: user.id,
            usageTier: user.usageTier ?? input.billing?.usageTier
          })),
          now,
          input.org.createdAt
        )
      : Promise.resolve(new Map<string, PaidUsageMeters>()),
    input.usageTracker.lastActiveAtByPrincipal(input.org.id),
    capKind === "paid_included"
      ? Promise.resolve(new Map<string, { autoCents: number; frontierCents: number }>())
      : input.usageTracker.sumUsdCentsByUserIds(
          input.org.id,
          range,
          [...LLM_USAGE_EVENT_TYPES],
          input.users.map((user) => user.id)
        )
  ]);
  const lastActiveByPrincipal = new Map(lastActiveRows.map((row) => [row.principal, row.lastActiveAt] as const));
  const summaries = new Map<
    string,
    Pick<OperatorUserUsageSnapshot, "usedCents" | "includedCents" | "usedRatio" | "lastActiveAt" | "alerts" | "usageTier">
  >();
  for (const user of input.users) {
    const meters = metersByUser.get(user.id);
    const pooled = pooledCents.get(user.id);
    const usedCents = meters?.usedCents ?? (pooled ? pooled.autoCents + pooled.frontierCents : 0);
    const includedCents = meters?.limitCents ?? null;
    let lastActiveAt: Date | undefined;
    for (const alias of principalAliasesForUser(user)) {
      const ts = lastActiveByPrincipal.get(alias);
      if (ts && (!lastActiveAt || ts > lastActiveAt)) {
        lastActiveAt = ts;
      }
    }
    summaries.set(user.id, {
      usageTier: user.usageTier ?? null,
      usedCents,
      includedCents,
      usedRatio: unclampedRatio(usedCents, includedCents),
      lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
      alerts: userAlertsFromMeters(meters)
    });
  }
  return summaries;
}

export function splitUsageQueueItems(input: {
  orgId: string;
  orgName: string;
  plan: OrgPlan;
  summary: OperatorOrgUsageSummary;
  users?: Array<{ email: string; alerts: OperatorUsageAlertCode[]; usedRatio: number | null }>;
}): {
  usageNearCap: OperatorUsageQueueItem[];
  usageAtCap: OperatorUsageQueueItem[];
  unprofitable: OperatorUsageQueueItem[];
} {
  const base = {
    orgId: input.orgId,
    orgName: input.orgName,
    plan: input.plan,
    usedCents: input.summary.usedCents,
    includedCents: input.summary.includedCents,
    usedRatio: input.summary.usedRatio,
    seatRevenueCents: input.summary.seatRevenueCents,
    marginCents: input.summary.marginCents
  };
  const usageNearCap: OperatorUsageQueueItem[] = [];
  const usageAtCap: OperatorUsageQueueItem[] = [];
  const unprofitable: OperatorUsageQueueItem[] = [];

  if (input.summary.alerts.includes("unprofitable")) {
    unprofitable.push({ ...base, trigger: "org" });
  }
  if (input.summary.alerts.includes("at_cap")) {
    usageAtCap.push({ ...base, trigger: "org" });
  } else if (input.summary.alerts.includes("near_cap")) {
    usageNearCap.push({ ...base, trigger: "org" });
  }

  for (const user of input.users ?? []) {
    if (user.alerts.includes("at_cap")) {
      usageAtCap.push({ ...base, trigger: "user", userEmail: user.email, usedRatio: user.usedRatio });
    } else if (user.alerts.includes("near_cap")) {
      usageNearCap.push({ ...base, trigger: "user", userEmail: user.email, usedRatio: user.usedRatio });
    }
  }

  return { usageNearCap, usageAtCap, unprofitable };
}

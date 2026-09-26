import { estimateTokensFromText } from "../api/costEstimate";
import type { ChatOrgPlan, UseCase } from "../api/types";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import {
  billTokensForQuota,
  billUsdCents,
  classifyRequestBucket,
  type UsageBucket
} from "../config/modelCreditWeights";
import { DEMO_PAGE_URL, PRICING_PAGE_URL } from "../config/siteConfig";
import { formatWaitTime } from "../jobs/types";
import {
  countsAsFreeQuotaMessage,
  flashListCostUsd,
  isFreeFlashModel,
  summarizeFreeAllowance,
  currentWeekWindow,
  type FreeBlockedWindow,
  type FreeAllowanceEvent
} from "./freeAllowance";
import type { OrgPlan } from "./orgStore";
import type { TokenUsageEvent, UsageTracker } from "./usageTracker";
import {
  USAGE_TIER_LIMITS,
  displayUsageTierName,
  effectiveUsageTier,
  nextUsageTier,
  paidUsagePeriodRange,
  type UsageTier
} from "./usageTiers";

export const QUOTA_CREDIT_EVENT_TYPE = "quota.credit" as const;
export const LLM_USAGE_EVENT_TYPES = ["chat.message", "completion.accepted", QUOTA_CREDIT_EVENT_TYPE] as const;

export const DEFAULT_FREE_TOKEN_LIMIT = 80_000;
/** @deprecated Use DEFAULT_FREE_TOKEN_LIMIT */
export const DEFAULT_FREE_DAILY_TOKEN_LIMIT = DEFAULT_FREE_TOKEN_LIMIT;

export const DEFAULT_ROLLING_WINDOW_MS = 5 * 60 * 60 * 1000;
export const VISION_TOKEN_MULTIPLIER = 2;

/** 1 credit = 1,000 tokens — easier to show in UI than raw token counts. */
export const TOKENS_PER_CREDIT = 1_000;

export type PlanQuotaConfig = {
  enabled: boolean;
  freeTokenLimit: number;
  rollingWindowMs: number;
  visionTokenMultiplier: number;
  upgradeUrl: string;
};

export type PlanQuotaSnapshot = {
  plan: "free";
  usedRatio: number;
  exhausted: boolean;
  nearLimit: boolean;
  blockedWindow?: FreeBlockedWindow;
  windowHours: number;
  resetsAt: string;
  retryAfterMs: number;
  /** Operator-only ratio mapping. Not rendered in the extension. */
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
};

export type UsagePoolMeter = {
  usedCents: number;
  limitCents: number;
  remainingCents: number;
  usedRatio: number;
};

export type PaidUsageMeters = {
  usageTier: UsageTier;
  displayName: string;
  seatPriceUsd: number;
  periodStart: string;
  periodEnd: string;
  usedCents: number;
  limitCents: number;
  remainingCents: number;
  usedRatio: number;
  /** Share of the one monthly cap (not a second cap). */
  auto: UsagePoolMeter;
  frontier: UsagePoolMeter;
  nextTier?: UsageTier;
  nextTierName?: string;
  nextTierPriceUsd?: number;
};

export type PaidQuotaContext = {
  usageTier?: UsageTier | null;
  /** Named seat holder. Omit for org API-key / unattributed traffic. */
  userId?: string;
  selection?: string | null;
  provider: LlmProvider;
  model: string;
  forceAutoBucket?: boolean;
  /** Org signup time — monthly usage window is this anniversary, not the calendar month. */
  periodAnchor?: Date;
};

export type QuotaPool = "paid" | "free";

export type PlanQuotaExceededExtras = {
  pool?: QuotaPool;
  upgradePlan?: UsageTier;
  usedCents?: number;
  limitCents?: number;
  message?: string;
  blockedWindow?: FreeBlockedWindow;
};

export class PlanQuotaExceededError extends Error {
  public readonly code = "quota_limit_reached";
  public readonly pool: QuotaPool;
  public readonly upgradePlan?: UsageTier;
  public readonly usedCents?: number;
  public readonly limitCents?: number;
  public readonly blockedWindow?: FreeBlockedWindow;

  public constructor(
    public readonly retryAfterMs: number,
    public readonly usedTokens: number,
    public readonly limitTokens: number,
    public readonly upgradeUrl: string,
    public readonly resetsAt: Date,
    extras: PlanQuotaExceededExtras = {}
  ) {
    super(extras.message ?? buildQuotaLimitMessage(retryAfterMs, resetsAt, extras.blockedWindow));
    this.name = "PlanQuotaExceededError";
    this.pool = extras.pool ?? "free";
    this.upgradePlan = extras.upgradePlan;
    this.usedCents = extras.usedCents;
    this.limitCents = extras.limitCents;
    this.blockedWindow = extras.blockedWindow;
  }
}

export class PlanQuotaUnavailableError extends Error {
  public readonly code = "quota_metering_unavailable";

  public constructor() {
    super("Usage metering is temporarily unavailable. Try again in a moment.");
    this.name = "PlanQuotaUnavailableError";
  }
}

export class PlanQuotaService {
  public constructor(
    private readonly usageTracker: UsageTracker | undefined,
    private readonly config: PlanQuotaConfig
  ) {}

  public appliesToPlan(plan: OrgPlan | ChatOrgPlan): boolean {
    return plan === "free" && this.config.enabled;
  }

  public appliesPaidCaps(plan: OrgPlan | ChatOrgPlan, usageTier?: UsageTier | null): boolean {
    return effectiveUsageTier(plan, usageTier) != null;
  }

  public async getSnapshot(
    orgId: string,
    plan: OrgPlan | ChatOrgPlan,
    now = new Date()
  ): Promise<PlanQuotaSnapshot | undefined> {
    if (!this.appliesToPlan(plan) || orgId === "dev") {
      return undefined;
    }
    const usage = await this.getFreeAllowance(orgId, now);
    return buildSnapshot(usage, this.config.rollingWindowMs);
  }

  public async getUsageMeters(
    orgId: string,
    plan: OrgPlan | ChatOrgPlan,
    usageTier?: UsageTier | null,
    now = new Date(),
    periodAnchor?: Date,
    userId?: string
  ): Promise<PaidUsageMeters | undefined> {
    const tier = effectiveUsageTier(plan, usageTier);
    if (!tier || orgId === "dev") {
      return undefined;
    }
    if (!this.usageTracker?.canRead()) {
      return undefined;
    }
    const pools = await this.getPaidPoolUsage(orgId, now, periodAnchor, userId);
    return buildPaidUsageMeters(tier, pools, now, periodAnchor);
  }

  /** Monthly Base/Frontier meters for each named seat. Free/Enterprise skip. */
  public async getUsageMetersForUsers(
    orgId: string,
    plan: OrgPlan | ChatOrgPlan,
    users: Array<{ id: string; usageTier?: UsageTier | string | null }>,
    now = new Date(),
    periodAnchor?: Date
  ): Promise<Map<string, PaidUsageMeters>> {
    const meters = new Map<string, PaidUsageMeters>();
    if (orgId === "dev" || !this.usageTracker?.canRead()) {
      return meters;
    }
    const ids = users.map((user) => user.id.trim()).filter(Boolean);
    if (ids.length === 0) {
      return meters;
    }
    const range = paidUsagePeriodRange(periodAnchor, now);
    const pooled = await this.usageTracker.sumUsdCentsByUserIds(
      orgId,
      range,
      [...LLM_USAGE_EVENT_TYPES],
      ids
    );
    for (const user of users) {
      const userId = user.id.trim();
      if (!userId) {
        continue;
      }
      const tier = effectiveUsageTier(plan, user.usageTier);
      if (!tier) {
        continue;
      }
      const pools = pooled.get(userId) ?? { autoCents: 0, frontierCents: 0 };
      meters.set(userId, buildPaidUsageMeters(tier, pools, now, periodAnchor));
    }
    return meters;
  }

  public async check(
    orgId: string,
    plan: OrgPlan | ChatOrgPlan,
    _estimatedAdditionalTokens = 0,
    now = new Date(),
    paid?: PaidQuotaContext,
    options?: { skipFreeAllowance?: boolean; skipPaidCap?: boolean }
  ): Promise<void> {
    if (orgId === "dev") {
      return;
    }
    const tier = effectiveUsageTier(plan, paid?.usageTier);
    if (tier) {
      if (options?.skipPaidCap) {
        return;
      }
      await this.checkPaid(orgId, tier, now, paid?.periodAnchor, paid?.userId);
      return;
    }
    if (options?.skipFreeAllowance || !this.appliesToPlan(plan)) {
      return;
    }
    const usage = await this.getFreeAllowance(orgId, now);
    if (!usage.exhausted) {
      return;
    }
    const retryAfterMs = Math.max(0, usage.resetsAt.getTime() - Date.now());
    throw new PlanQuotaExceededError(retryAfterMs, 0, 0, this.config.upgradeUrl, usage.resetsAt, {
      pool: "free",
      upgradePlan: "pro",
      blockedWindow: usage.blockedWindow
    });
  }

  public async recordTokens(
    orgId: string,
    plan: OrgPlan | ChatOrgPlan,
    entry: {
      eventType: (typeof LLM_USAGE_EVENT_TYPES)[number];
      inputTokens: number;
      outputTokens: number;
      provider: LlmProvider;
      model: string;
      userId?: string;
      principal: string;
      metadata?: Record<string, unknown>;
      visionWeighted?: boolean;
      selection?: string | null;
      usageTier?: UsageTier | null;
      forceAutoBucket?: boolean;
      useCase?: UseCase | string;
      quotaTurnId?: string;
      countsAsMessage?: boolean;
    }
  ): Promise<void> {
    if (orgId === "dev") {
      return;
    }
    const billed = billTokensForQuota({
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      provider: entry.provider,
      model: entry.model,
      visionWeighted: entry.visionWeighted,
      visionMultiplier: this.config.visionTokenMultiplier
    });
    const usd = billUsdCents({
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      provider: entry.provider,
      model: entry.model,
      visionWeighted: entry.visionWeighted,
      visionMultiplier: this.config.visionTokenMultiplier
    });
    const bucket: UsageBucket = classifyRequestBucket({
      selection: entry.selection,
      provider: entry.provider,
      resolvedModel: entry.model,
      forceAutoBucket: entry.forceAutoBucket
    });
    const tier = effectiveUsageTier(plan, entry.usageTier);
    const useCase = typeof entry.useCase === "string" ? entry.useCase : undefined;
    const countsAsMessage =
      entry.countsAsMessage ?? (entry.eventType === "chat.message" && countsAsFreeQuotaMessage(useCase));
    const flashCostUsd = isFreeFlashModel(entry.model)
      ? flashListCostUsd(entry.inputTokens, entry.outputTokens)
      : undefined;
    await this.usageTracker?.record({
      orgId,
      userId: entry.userId,
      principal: entry.principal,
      eventType: entry.eventType,
      metadata: {
        ...entry.metadata,
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        rawTokens: billed.rawTokens,
        totalTokens: billed.billedTokens,
        billedTokens: billed.billedTokens,
        modelWeight: billed.modelWeight,
        visionMultiplier: billed.visionMultiplier,
        visionWeighted: Boolean(entry.visionWeighted),
        plan,
        bucket,
        usdCents: usd.usdCents,
        usageTier: tier ?? undefined,
        ...(useCase ? { useCase } : {}),
        ...(entry.quotaTurnId?.trim() ? { quotaTurnId: entry.quotaTurnId.trim() } : {}),
        countsAsMessage,
        ...(flashCostUsd != null ? { flashCostUsd } : {})
      }
    });
  }

  private async checkPaid(
    orgId: string,
    tier: UsageTier,
    now: Date,
    periodAnchor?: Date,
    userId?: string
  ): Promise<void> {
    if (!this.usageTracker?.canRead()) {
      throw new PlanQuotaUnavailableError();
    }
    const limits = USAGE_TIER_LIMITS[tier];
    const pools = await this.getPaidPoolUsage(orgId, now, periodAnchor, userId);
    const usedCents = Math.max(0, pools.autoCents + pools.frontierCents);
    if (usedCents < limits.costCents) {
      return;
    }
    const period = paidUsagePeriodRange(periodAnchor, now);
    const retryAfterMs = Math.max(0, period.to.getTime() - now.getTime());
    const next = nextUsageTier(tier);
    const upgradePlan = next === "enterprise" ? undefined : next;
    const upgradeUrl = next === "enterprise" ? DEMO_PAGE_URL : this.config.upgradeUrl;
    throw new PlanQuotaExceededError(retryAfterMs, 0, 0, upgradeUrl, period.to, {
      pool: "paid",
      upgradePlan,
      usedCents,
      limitCents: limits.costCents,
      message: buildPaidCapMessage(upgradePlan)
    });
  }

  private async getPaidPoolUsage(
    orgId: string,
    now = new Date(),
    periodAnchor?: Date,
    userId?: string
  ): Promise<{ autoCents: number; frontierCents: number }> {
    const range = paidUsagePeriodRange(periodAnchor, now);
    const eventTypes = [...LLM_USAGE_EVENT_TYPES];
    const subject = userId?.trim() ? userId.trim() : null;
    const [autoCents, frontierCents] = await Promise.all([
      this.usageTracker!.sumUsdCentsForSubject(orgId, range, eventTypes, "auto", subject),
      this.usageTracker!.sumUsdCentsForSubject(orgId, range, eventTypes, "frontier", subject)
    ]);
    return { autoCents, frontierCents };
  }

  private async getFreeAllowance(orgId: string, now = new Date()) {
    const eventTypes = [...LLM_USAGE_EVENT_TYPES];
    const cycleRange = rollingWindowRange(now, this.config.rollingWindowMs);
    const weekAnchor =
      (await this.usageTracker?.oldestAllowanceEventAt(orgId, eventTypes)) ?? now;
    const week = currentWeekWindow(weekAnchor, now);
    const [cycleEvents, weekEvents] = await Promise.all([
      this.listAllowanceEvents(orgId, cycleRange),
      this.listAllowanceEvents(orgId, week)
    ]);
    return summarizeFreeAllowance({
      cycleEvents,
      weekEvents,
      weekEnd: week.to,
      windowMs: this.config.rollingWindowMs,
      now
    });
  }

  private async listAllowanceEvents(
    orgId: string,
    range: { from: Date; to: Date }
  ): Promise<FreeAllowanceEvent[]> {
    if (!this.usageTracker) {
      return [];
    }
    return this.usageTracker.listAllowanceEventsForOrg(orgId, range, [...LLM_USAGE_EVENT_TYPES]);
  }
}

export function loadPlanQuotaConfig(env: NodeJS.ProcessEnv = process.env): PlanQuotaConfig {
  const disabled = readBoolean(env.COOP_PLAN_QUOTA_DISABLED, false);
  const freeTokenLimit = readPositiveInt(
    env.COOP_FREE_TOKEN_LIMIT ?? env.COOP_FREE_DAILY_TOKEN_LIMIT,
    DEFAULT_FREE_TOKEN_LIMIT
  );
  const rollingWindowMs = readPositiveInt(env.COOP_FREE_ROLLING_WINDOW_MS, DEFAULT_ROLLING_WINDOW_MS);
  const visionTokenMultiplier = readPositiveInt(env.COOP_VISION_TOKEN_MULTIPLIER, VISION_TOKEN_MULTIPLIER);
  return {
    enabled: !disabled && freeTokenLimit > 0,
    freeTokenLimit,
    rollingWindowMs,
    visionTokenMultiplier: Math.max(1, visionTokenMultiplier),
    upgradeUrl: env.COOP_PRICING_URL?.trim() || PRICING_PAGE_URL
  };
}

export function createPlanQuotaService(usageTracker?: UsageTracker): PlanQuotaService {
  return new PlanQuotaService(usageTracker, loadPlanQuotaConfig());
}

export function estimateChatRequestTokens(input: {
  message: string;
  history?: Array<{ content: string; attachments?: unknown[] }>;
  maxTokens?: number;
  imageAttachmentCount?: number;
  provider: LlmProvider;
  model: string;
  visionMultiplier?: number;
}): number {
  const maxOut = typeof input.maxTokens === "number" ? input.maxTokens : 2_000;
  const historyText = (input.history ?? []).map((entry) => entry.content).join("\n");
  const historyImages = (input.history ?? []).reduce(
    (count, entry) => count + (Array.isArray(entry.attachments) ? entry.attachments.length : 0),
    0
  );
  const imageCount = (input.imageAttachmentCount ?? 0) + historyImages;
  const inputEstimate = estimateTokensFromText(`${historyText}\n${input.message}`) + 2_500;
  return billTokensForQuota({
    inputTokens: inputEstimate,
    outputTokens: maxOut,
    provider: input.provider,
    model: input.model,
    visionWeighted: imageCount > 0,
    visionMultiplier: input.visionMultiplier
  }).billedTokens;
}

export function rollingWindowRange(now: Date, windowMs: number): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - windowMs), to: now };
}

export function computeQuotaResetsAt(
  events: TokenUsageEvent[],
  usedTokens: number,
  limitTokens: number,
  windowMs: number,
  now = new Date(),
  additionalTokens = 0
): Date | null {
  if (events.length === 0) {
    return null;
  }
  const targetUsed = Math.max(0, limitTokens - additionalTokens);
  if (usedTokens <= targetUsed) {
    return new Date(events[0].createdAt.getTime() + windowMs);
  }
  let remaining = usedTokens;
  let resetsAt: Date | null = null;
  for (const event of events) {
    if (remaining <= targetUsed) {
      break;
    }
    remaining -= event.tokens;
    resetsAt = new Date(event.createdAt.getTime() + windowMs);
  }
  return resetsAt;
}

export function writePlanQuotaExceededResponse(
  response: import("node:http").ServerResponse,
  error: PlanQuotaExceededError
): void {
  response.writeHead(429, { "content-type": "application/json; charset=utf-8" });
  const payload: Record<string, unknown> = {
    error: error.code,
    legacyError: "daily_limit_reached",
    message: error.message,
    retryAfterMs: error.retryAfterMs,
    retryAfter: formatQuotaRetryAfter(error.retryAfterMs),
    resetsAt: error.resetsAt.toISOString(),
    upgradeUrl: error.upgradeUrl,
    pool: error.pool,
    upgradePlan: error.upgradePlan
  };
  if (error.pool === "free") {
    payload.blockedWindow = error.blockedWindow;
  } else {
    payload.usedTokens = error.usedTokens;
    payload.limitTokens = error.limitTokens;
    payload.usedCredits = tokensToCredits(error.usedTokens);
    payload.limitCredits = tokensToCredits(error.limitTokens);
    payload.usedCents = error.usedCents;
    payload.limitCents = error.limitCents;
  }
  response.end(JSON.stringify(payload));
}

export function writePlanQuotaUnavailableResponse(
  response: import("node:http").ServerResponse,
  error: PlanQuotaUnavailableError
): void {
  response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: error.code, message: error.message }));
}

export function tokensToCredits(tokens: number): number {
  return Math.ceil(tokens / TOKENS_PER_CREDIT);
}

/** @deprecated Use rollingWindowRange */
export function utcDayRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

/** @deprecated Rolling window uses event-based reset times */
export function msUntilUtcDayEnd(now = new Date()): number {
  const { to } = utcDayRange(now);
  return Math.max(0, to.getTime() - now.getTime());
}

function buildSnapshot(
  usage: {
    usedRatio: number;
    exhausted: boolean;
    nearLimit: boolean;
    blockedWindow?: FreeBlockedWindow;
    resetsAt: Date;
  },
  rollingWindowMs: number
): PlanQuotaSnapshot {
  const retryAfterMs = Math.max(0, usage.resetsAt.getTime() - Date.now());
  const usedTokens = Math.round(usage.usedRatio * 1000);
  return {
    plan: "free",
    usedRatio: usage.usedRatio,
    exhausted: usage.exhausted,
    nearLimit: usage.nearLimit,
    blockedWindow: usage.blockedWindow,
    windowHours: rollingWindowMs / 3_600_000,
    resetsAt: usage.resetsAt.toISOString(),
    retryAfterMs,
    usedTokens,
    limitTokens: 1000,
    remainingTokens: Math.max(0, 1000 - usedTokens)
  };
}

function buildQuotaLimitMessage(
  _retryAfterMs: number,
  resetsAt: Date,
  blockedWindow?: FreeBlockedWindow
): string {
  const clock = formatResetsAtLocal(resetsAt);
  if (blockedWindow === "week") {
    const weekday = resetsAt.toLocaleDateString(undefined, { weekday: "long" });
    return `You can continue on ${weekday} at ${clock}. Upgrade to Pro for a monthly allowance.`;
  }
  return `You can continue at ${clock}. Upgrade to Pro for a monthly allowance.`;
}

export function buildPaidCapMessage(upgradePlan?: UsageTier): string {
  if (!upgradePlan) {
    return "You've used this month's included usage. Contact us about Enterprise to continue.";
  }
  return `You've used this month's included usage. Upgrade to ${displayUsageTierName(upgradePlan)} to continue.`;
}

function buildPaidUsageMeters(
  tier: UsageTier,
  pools: { autoCents: number; frontierCents: number },
  now: Date,
  periodAnchor?: Date
): PaidUsageMeters {
  const limits = USAGE_TIER_LIMITS[tier];
  const period = paidUsagePeriodRange(periodAnchor, now);
  const next = nextUsageTier(tier);
  const usedCents = pools.autoCents + pools.frontierCents;
  const total = toPoolMeter(usedCents, limits.costCents);
  return {
    usageTier: tier,
    displayName: displayUsageTierName(tier),
    seatPriceUsd: limits.seatPriceUsd,
    periodStart: period.from.toISOString(),
    periodEnd: period.to.toISOString(),
    ...total,
    auto: toPoolMeter(pools.autoCents, limits.costCents),
    frontier: toPoolMeter(pools.frontierCents, limits.costCents),
    nextTier: next === "enterprise" ? undefined : next,
    nextTierName: next === "enterprise" ? "Enterprise" : displayUsageTierName(next),
    nextTierPriceUsd: next === "enterprise" ? undefined : USAGE_TIER_LIMITS[next].seatPriceUsd
  };
}

function toPoolMeter(usedCents: number, limitCents: number): UsagePoolMeter {
  const clampedUsed = Math.max(0, usedCents);
  const remainingCents = Math.max(0, limitCents - clampedUsed);
  return {
    usedCents: clampedUsed,
    limitCents,
    remainingCents,
    usedRatio: limitCents <= 0 ? 1 : Math.min(1, clampedUsed / limitCents)
  };
}

function formatResetsAtLocal(resetsAt: Date): string {
  return resetsAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatQuotaRetryAfter(ms: number): string {
  if (ms >= 3_600_000) {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.round((ms % 3_600_000) / 60_000);
    if (minutes <= 0) {
      return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
    }
    return `in ${hours}h ${minutes}m`;
  }
  const wait = formatWaitTime(ms);
  return wait.startsWith("in ") ? wait : `in ${wait}`;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

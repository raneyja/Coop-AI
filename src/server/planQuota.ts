import { estimateTokensFromText } from "../api/costEstimate";
import type { ChatOrgPlan } from "../api/types";
import type { LlmProvider } from "../api/zeroRetentionConfig";
import {
  billTokensForQuota,
  billUsdCents,
  classifyRequestBucket,
  type UsageBucket
} from "../config/modelCreditWeights";
import { DEMO_PAGE_URL, PRICING_PAGE_URL } from "../config/siteConfig";
import { formatWaitTime } from "../jobs/types";
import type { OrgPlan } from "./orgStore";
import type { TokenUsageEvent, UsageTracker } from "./usageTracker";
import {
  USAGE_TIER_LIMITS,
  displayUsageTierName,
  effectiveUsageTier,
  nextUsageTier,
  utcCalendarMonthRange,
  type UsageTier
} from "./usageTiers";

export const LLM_USAGE_EVENT_TYPES = ["chat.message", "completion.requested"] as const;

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
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  usedCredits: number;
  limitCredits: number;
  remainingCredits: number;
  windowHours: number;
  resetsAt: string;
  retryAfterMs: number;
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
  selection?: string | null;
  provider: LlmProvider;
  model: string;
  forceAutoBucket?: boolean;
};

export type QuotaPool = "paid" | "free";

export type PlanQuotaExceededExtras = {
  pool?: QuotaPool;
  upgradePlan?: UsageTier;
  usedCents?: number;
  limitCents?: number;
  message?: string;
};

export class PlanQuotaExceededError extends Error {
  public readonly code = "quota_limit_reached";
  public readonly pool: QuotaPool;
  public readonly upgradePlan?: UsageTier;
  public readonly usedCents?: number;
  public readonly limitCents?: number;

  public constructor(
    public readonly retryAfterMs: number,
    public readonly usedTokens: number,
    public readonly limitTokens: number,
    public readonly upgradeUrl: string,
    public readonly resetsAt: Date,
    extras: PlanQuotaExceededExtras = {}
  ) {
    super(extras.message ?? buildQuotaLimitMessage(retryAfterMs, resetsAt, upgradeUrl));
    this.name = "PlanQuotaExceededError";
    this.pool = extras.pool ?? "free";
    this.upgradePlan = extras.upgradePlan;
    this.usedCents = extras.usedCents;
    this.limitCents = extras.limitCents;
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
    const usage = await this.getRollingUsage(orgId, now);
    return buildSnapshot(usage.usedTokens, this.config.freeTokenLimit, usage.resetsAt, this.config.rollingWindowMs);
  }

  public async getUsageMeters(
    orgId: string,
    plan: OrgPlan | ChatOrgPlan,
    usageTier?: UsageTier | null,
    now = new Date()
  ): Promise<PaidUsageMeters | undefined> {
    const tier = effectiveUsageTier(plan, usageTier);
    if (!tier || orgId === "dev") {
      return undefined;
    }
    if (!this.usageTracker?.canRead()) {
      return undefined;
    }
    const pools = await this.getPaidPoolUsage(orgId, now);
    return buildPaidUsageMeters(tier, pools, now);
  }

  public async check(
    orgId: string,
    plan: OrgPlan | ChatOrgPlan,
    _estimatedAdditionalTokens = 0,
    now = new Date(),
    paid?: PaidQuotaContext
  ): Promise<void> {
    if (orgId === "dev") {
      return;
    }
    const tier = effectiveUsageTier(plan, paid?.usageTier);
    if (tier) {
      await this.checkPaid(orgId, tier, now);
      return;
    }
    if (!this.appliesToPlan(plan)) {
      return;
    }
    const usage = await this.getRollingUsage(orgId, now);
    const remainingTokens = this.config.freeTokenLimit - usage.usedTokens;
    // Block new requests only when already exhausted. Do not use estimated tokens —
    // a request that starts with any remaining budget may finish even if it goes over.
    if (remainingTokens <= 0) {
      const retryAfterMs = Math.max(0, usage.resetsAt.getTime() - Date.now());
      throw new PlanQuotaExceededError(
        retryAfterMs,
        usage.usedTokens,
        this.config.freeTokenLimit,
        this.config.upgradeUrl,
        usage.resetsAt,
        { pool: "free", upgradePlan: "pro" }
      );
    }
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
        usageTier: tier ?? undefined
      }
    });
  }

  private async checkPaid(orgId: string, tier: UsageTier, now: Date): Promise<void> {
    if (!this.usageTracker?.canRead()) {
      throw new PlanQuotaUnavailableError();
    }
    const limits = USAGE_TIER_LIMITS[tier];
    const pools = await this.getPaidPoolUsage(orgId, now);
    const usedCents = pools.autoCents + pools.frontierCents;
    if (usedCents < limits.costCents) {
      return;
    }
    const period = utcCalendarMonthRange(now);
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
    now = new Date()
  ): Promise<{ autoCents: number; frontierCents: number }> {
    const range = utcCalendarMonthRange(now);
    const eventTypes = [...LLM_USAGE_EVENT_TYPES];
    const [autoCents, frontierCents] = await Promise.all([
      this.usageTracker!.sumUsdCentsForOrg(orgId, range, eventTypes, "auto"),
      this.usageTracker!.sumUsdCentsForOrg(orgId, range, eventTypes, "frontier")
    ]);
    return { autoCents, frontierCents };
  }

  private async getRollingUsage(orgId: string, now = new Date()): Promise<{
    usedTokens: number;
    resetsAt: Date;
    events: TokenUsageEvent[];
  }> {
    const range = rollingWindowRange(now, this.config.rollingWindowMs);
    const events = await this.listTokenEvents(orgId, range);
    const usedTokens = events.reduce((sum, event) => sum + event.tokens, 0);
    const resetsAt =
      computeQuotaResetsAt(events, usedTokens, this.config.freeTokenLimit, this.config.rollingWindowMs, now) ??
      new Date(now.getTime() + this.config.rollingWindowMs);
    return { usedTokens, resetsAt, events };
  }

  private async listTokenEvents(orgId: string, range: { from: Date; to: Date }): Promise<TokenUsageEvent[]> {
    if (!this.usageTracker) {
      return [];
    }
    return this.usageTracker.listTokenEventsForOrg(orgId, range, [...LLM_USAGE_EVENT_TYPES]);
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
  response.end(
    JSON.stringify({
      error: error.code,
      legacyError: "daily_limit_reached",
      message: error.message,
      retryAfterMs: error.retryAfterMs,
      retryAfter: formatQuotaRetryAfter(error.retryAfterMs),
      resetsAt: error.resetsAt.toISOString(),
      usedTokens: error.usedTokens,
      limitTokens: error.limitTokens,
      usedCredits: tokensToCredits(error.usedTokens),
      limitCredits: tokensToCredits(error.limitTokens),
      upgradeUrl: error.upgradeUrl,
      pool: error.pool,
      upgradePlan: error.upgradePlan,
      usedCents: error.usedCents,
      limitCents: error.limitCents
    })
  );
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
  usedTokens: number,
  limitTokens: number,
  resetsAt: Date,
  rollingWindowMs: number
): PlanQuotaSnapshot {
  const remainingTokens = Math.max(0, limitTokens - usedTokens);
  const retryAfterMs = Math.max(0, resetsAt.getTime() - Date.now());
  return {
    plan: "free",
    usedTokens,
    limitTokens,
    remainingTokens,
    usedCredits: tokensToCredits(usedTokens),
    limitCredits: tokensToCredits(limitTokens),
    remainingCredits: tokensToCredits(remainingTokens),
    windowHours: rollingWindowMs / 3_600_000,
    resetsAt: resetsAt.toISOString(),
    retryAfterMs
  };
}

function buildQuotaLimitMessage(_retryAfterMs: number, resetsAt: Date, _upgradeUrl: string): string {
  const atLabel = formatResetsAtLocal(resetsAt);
  return `You've reached your free AI credits limit. Try again at ${atLabel} or upgrade to Pro for a monthly allowance.`;
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
  now: Date
): PaidUsageMeters {
  const limits = USAGE_TIER_LIMITS[tier];
  const period = utcCalendarMonthRange(now);
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
  const remainingCents = Math.max(0, limitCents - usedCents);
  return {
    usedCents,
    limitCents,
    remainingCents,
    usedRatio: limitCents <= 0 ? 1 : Math.min(1, usedCents / limitCents)
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

import type { RateLimitState } from "../api/rateLimitTracker";
import { DEFAULT_INTENT_CONFIG, IntentRateLimitConfig } from "../config/intentConfig";
import { IntentCost, IntentEvent, UserIntent } from "./intentDetector";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";

export type RateLimitSnapshot = {
  limit: number;
  remaining: number;
  resetTime?: Date;
  percentageRemaining: number;
};

export type CacheEntry<T = unknown> = {
  data: T;
  cachedAt: Date;
  message?: string;
};

export type ContextCacheManager = {
  get: (key: string) => Promise<CacheEntry | undefined> | CacheEntry | undefined;
  set?: (key: string, value: CacheEntry) => Promise<void> | void;
};

export type RateLimitProvider = {
  getRateLimits: () => Promise<RateLimitSnapshot | undefined> | RateLimitSnapshot | undefined;
};

export type RequestExecutor = (request: ContextFetchRequest) => Promise<ContextFetchResult>;

export type RateLimitAwareExecutionOptions = {
  config?: Partial<IntentRateLimitConfig>;
  rateLimits?: RateLimitProvider;
  cache?: ContextCacheManager;
  now?: () => Date;
};

export type FetchDecision = {
  shouldFetch: boolean;
  reason: "allowed" | "explicit_intent" | "expensive_quota_low" | "cheap_quota_low" | "no_limits";
  limits?: RateLimitSnapshot;
};

export class RateLimitAwareExecutor {
  private readonly config: IntentRateLimitConfig;
  private readonly rateLimits?: RateLimitProvider;
  private readonly cache?: ContextCacheManager;
  private readonly now: () => Date;

  public constructor(options: RateLimitAwareExecutionOptions = {}) {
    this.config = {
      ...DEFAULT_INTENT_CONFIG.rateLimitAware,
      ...options.config
    };
    this.rateLimits = options.rateLimits;
    this.cache = options.cache;
    this.now = options.now ?? (() => new Date());
  }

  public async shouldFetch(intent: UserIntent, cost: IntentCost): Promise<FetchDecision> {
    const limits = await this.rateLimits?.getRateLimits();
    if (!limits) {
      return { shouldFetch: true, reason: "no_limits" };
    }

    if (intent === UserIntent.QUICK_ACTION_CLICKED || intent === UserIntent.MANUAL_CHAT_SUBMIT) {
      return { shouldFetch: true, reason: "explicit_intent", limits };
    }

    if (cost === "expensive" && limits.percentageRemaining < this.config.expensiveThreshold) {
      return { shouldFetch: false, reason: "expensive_quota_low", limits };
    }

    if (cost === "cheap" && limits.percentageRemaining < this.config.cheapThreshold) {
      return { shouldFetch: false, reason: "cheap_quota_low", limits };
    }

    return { shouldFetch: true, reason: "allowed", limits };
  }

  public async execute(request: ContextFetchRequest, executor: RequestExecutor): Promise<ContextFetchResult> {
    const decision = await this.shouldFetch(request.intent.intent, request.cost);
    if (!decision.shouldFetch) {
      return this.fromCacheOrError(request, decision);
    }

    const result = await executor(request);
    if (!result.error && request.cacheKey && this.cache?.set) {
      await this.cache.set(request.cacheKey, {
        data: result.data,
        cachedAt: this.now(),
        message: result.message
      });
    }
    return result;
  }

  public async executeMany(
    requests: ContextFetchRequest[],
    executor: (request: ContextFetchRequest) => Promise<ContextFetchResult>
  ): Promise<ContextFetchResult[]> {
    const results: ContextFetchResult[] = [];
    for (const request of requests) {
      results.push(await this.execute(request, executor));
    }
    return results;
  }

  private async fromCacheOrError(request: ContextFetchRequest, decision: FetchDecision): Promise<ContextFetchResult> {
    if (this.config.fallbackToCache && request.cacheKey && this.cache) {
      const cached = await this.cache.get(request.cacheKey);
      if (cached) {
        return {
          requestId: request.id,
          type: request.type,
          data: cached.data,
          stale: true,
          message: `Rate limited; showing cached data from ${formatAge(cached.cachedAt, this.now())}.`,
          fetchedAt: this.now()
        };
      }
    }

    return {
      requestId: request.id,
      type: request.type,
      error: decision.reason === "expensive_quota_low"
        ? "Rate limited and no cached context is available for this expensive request."
        : "Rate limited and no cached context is available.",
      message: rateLimitMessage(decision),
      fetchedAt: this.now()
    };
  }
}

export function snapshotFromRateLimitState(state: RateLimitState | undefined): RateLimitSnapshot | undefined {
  if (!state || state.limit <= 0) {
    return undefined;
  }
  return {
    limit: state.limit,
    remaining: state.remaining,
    resetTime: new Date(state.resetTime),
    percentageRemaining: Math.max(0, Math.min(1, state.remaining / state.limit))
  };
}

export async function shouldFetch(
  intent: UserIntent,
  cost: IntentCost,
  rateLimits?: RateLimitProvider,
  config: Partial<IntentRateLimitConfig> = {}
): Promise<boolean> {
  const executor = new RateLimitAwareExecutor({ rateLimits, config });
  return (await executor.shouldFetch(intent, cost)).shouldFetch;
}

export function intentFeedbackFromResult(event: IntentEvent, result: ContextFetchResult): string | undefined {
  if (result.stale) {
    return result.message ?? "Rate limited; showing cached context.";
  }
  if (result.error) {
    return result.error;
  }
  if (event.costEstimate === "expensive") {
    return "Context analysis complete.";
  }
  return undefined;
}

function rateLimitMessage(decision: FetchDecision): string {
  const percentage = decision.limits ? `${Math.round(decision.limits.percentageRemaining * 100)}%` : "unknown";
  if (decision.reason === "expensive_quota_low") {
    return `Skipping expensive context fetch because quota remaining is ${percentage}.`;
  }
  if (decision.reason === "cheap_quota_low") {
    return `Skipping context fetch because quota remaining is ${percentage}.`;
  }
  return "Context fetch skipped by rate-limit policy.";
}

function formatAge(date: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) {
    return "less than a minute ago";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

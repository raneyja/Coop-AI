import { IntentEvent, UserIntent, repoContextToIntentContext } from "./intentDetector";
import type { RepoContext } from "../chat/types";
import type { ContextFetchResult } from "./requestBatcher";
import type { CacheEntry, ContextCacheManager, RateLimitProvider, RateLimitSnapshot } from "./rateLimitAwareExecution";

export function createIntentEvent(
  intent: UserIntent,
  context: RepoContext = {},
  overrides: Partial<IntentEvent> = {}
): IntentEvent {
  return {
    id: overrides.id ?? `test-${intent}`,
    intent,
    timestamp: overrides.timestamp ?? new Date(0),
    context: {
      ...repoContextToIntentContext(context),
      source: "test",
      ...overrides.context
    },
    costEstimate: overrides.costEstimate ?? "cheap"
  };
}

export function createContextResult(
  requestId: string,
  type: ContextFetchResult["type"],
  data: unknown
): ContextFetchResult {
  return {
    requestId,
    type,
    data,
    fetchedAt: new Date(0)
  };
}

export function createMemoryContextCache(seed: Record<string, CacheEntry> = {}): ContextCacheManager {
  const entries = new Map(Object.entries(seed));
  return {
    get: (key) => entries.get(key),
    set: (key, value) => {
      entries.set(key, value);
    }
  };
}

export function createStaticRateLimits(snapshot?: RateLimitSnapshot): RateLimitProvider {
  return {
    getRateLimits: () => snapshot
  };
}

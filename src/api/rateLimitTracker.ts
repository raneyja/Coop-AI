import type { WebhookProvider } from "../webhooks/types";

export type CodeHostRateLimitProvider = "bitbucket";
export type RateLimitProvider = WebhookProvider | CodeHostRateLimitProvider;

export interface RateLimitState {
  provider: RateLimitProvider;
  limit: number;
  remaining: number;
  resetTime: Date;
  percentageUsed: number;
}

export type RateLimitSample = RateLimitState & {
  sampledAt: Date;
};

export type RateLimitPrediction = {
  provider: RateLimitProvider;
  requestsPerHour: number;
  minutesUntilExhausted?: number;
  shouldWarn: boolean;
  shouldPauseNonCritical: boolean;
};

export type RateLimitTrackerOptions = {
  warnThreshold?: number;
  pauseThreshold?: number;
  historyLimit?: number;
};

const DEFAULT_WARN_THRESHOLD = 0.2;
const DEFAULT_PAUSE_THRESHOLD = 0.2;
const DEFAULT_HISTORY_LIMIT = 100;

export class RateLimitTracker {
  private readonly states = new Map<RateLimitProvider, RateLimitState>();
  private readonly history = new Map<RateLimitProvider, RateLimitSample[]>();
  private readonly warnThreshold: number;
  private readonly pauseThreshold: number;
  private readonly historyLimit: number;

  public constructor(options: RateLimitTrackerOptions = {}) {
    this.warnThreshold = options.warnThreshold ?? DEFAULT_WARN_THRESHOLD;
    this.pauseThreshold = options.pauseThreshold ?? DEFAULT_PAUSE_THRESHOLD;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  public update(state: Omit<RateLimitState, "percentageUsed"> & { percentageUsed?: number }): RateLimitState {
    const normalized: RateLimitState = {
      ...state,
      resetTime: new Date(state.resetTime),
      percentageUsed: state.percentageUsed ?? percentageUsed(state.limit, state.remaining)
    };
    this.states.set(state.provider, normalized);
    const samples = this.history.get(state.provider) ?? [];
    samples.push({ ...normalized, sampledAt: new Date() });
    this.history.set(state.provider, samples.slice(-this.historyLimit));
    return normalized;
  }

  public updateFromHeaders(
    provider: RateLimitProvider,
    headers: Record<string, string | string[] | number | undefined>
  ): RateLimitState | undefined {
    const limit = readNumberHeader(headers, "x-ratelimit-limit");
    const remaining = readNumberHeader(headers, "x-ratelimit-remaining");
    const reset = readNumberHeader(headers, "x-ratelimit-reset");
    if (limit === undefined || remaining === undefined || reset === undefined) {
      return undefined;
    }
    return this.update({
      provider,
      limit,
      remaining,
      resetTime: new Date(reset * 1000)
    });
  }

  public get(provider: RateLimitProvider): RateLimitState | undefined {
    const state = this.states.get(provider);
    return state ? { ...state, resetTime: new Date(state.resetTime) } : undefined;
  }

  public getAll(): RateLimitState[] {
    return [...this.states.values()].map((state) => ({ ...state, resetTime: new Date(state.resetTime) }));
  }

  public getHistory(provider: RateLimitProvider): RateLimitSample[] {
    return (this.history.get(provider) ?? []).map((sample) => ({
      ...sample,
      resetTime: new Date(sample.resetTime),
      sampledAt: new Date(sample.sampledAt)
    }));
  }

  public prediction(provider: RateLimitProvider): RateLimitPrediction {
    const state = this.states.get(provider);
    const samples = this.history.get(provider) ?? [];
    const requestsPerHour = calculateBurnRate(samples);
    const minutesUntilExhausted = state && requestsPerHour > 0
      ? (state.remaining / requestsPerHour) * 60
      : undefined;
    return {
      provider,
      requestsPerHour,
      minutesUntilExhausted,
      shouldWarn: state ? state.remaining / state.limit <= this.warnThreshold : false,
      shouldPauseNonCritical: state ? state.remaining / state.limit <= this.pauseThreshold : false
    };
  }

  public shouldPause(provider: RateLimitProvider): boolean {
    return this.prediction(provider).shouldPauseNonCritical;
  }
}

function percentageUsed(limit: number, remaining: number): number {
  if (limit <= 0) {
    return 1;
  }
  return Number(((limit - remaining) / limit).toFixed(4));
}

function readNumberHeader(
  headers: Record<string, string | string[] | number | undefined>,
  name: string
): number | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function calculateBurnRate(samples: RateLimitSample[]): number {
  if (samples.length < 2) {
    return 0;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedHours = (last.sampledAt.getTime() - first.sampledAt.getTime()) / (60 * 60 * 1000);
  if (elapsedHours <= 0) {
    return 0;
  }
  const consumed = Math.max(0, first.remaining - last.remaining);
  return Number((consumed / elapsedHours).toFixed(2));
}

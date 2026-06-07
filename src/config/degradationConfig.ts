export type UserNotificationLevel = "all" | "warnings" | "critical";

export type DegradationTimeouts = {
  critical: number;
  normal: number;
  background: number;
};

export type DegradationCacheRetentionDays = {
  fresh: number;
  warm: number;
  stale: number;
};

export type DegradationConfig = {
  enableGracefulFallback: boolean;
  cacheRetentionDays: DegradationCacheRetentionDays;
  timeouts: DegradationTimeouts;
  notifyUser: boolean;
  userNotificationLevel: UserNotificationLevel;
};

export type DegradationConfigInput = Partial<{
  enableGracefulFallback: boolean;
  cacheRetentionDays: Partial<DegradationCacheRetentionDays>;
  timeouts: Partial<DegradationTimeouts>;
  notifyUser: boolean;
  userNotificationLevel: UserNotificationLevel;
}>;

export const DEFAULT_DEGRADATION_CONFIG: DegradationConfig = {
  enableGracefulFallback: true,
  cacheRetentionDays: {
    fresh: 0.08,
    warm: 1,
    stale: 7
  },
  timeouts: {
    critical: 3_000,
    normal: 5_000,
    background: 10_000
  },
  notifyUser: true,
  userNotificationLevel: "warnings"
};

export function mergeDegradationConfig(input: DegradationConfigInput = {}): DegradationConfig {
  return {
    ...DEFAULT_DEGRADATION_CONFIG,
    ...defined(input),
    cacheRetentionDays: {
      ...DEFAULT_DEGRADATION_CONFIG.cacheRetentionDays,
      ...defined(input.cacheRetentionDays)
    },
    timeouts: {
      ...DEFAULT_DEGRADATION_CONFIG.timeouts,
      ...defined(input.timeouts)
    },
    userNotificationLevel: normalizeNotificationLevel(input.userNotificationLevel)
  };
}

export function cacheRetentionMs(config: DegradationConfig): {
  fresh: number;
  warm: number;
  stale: number;
} {
  return {
    fresh: daysToMs(config.cacheRetentionDays.fresh),
    warm: daysToMs(config.cacheRetentionDays.warm),
    stale: daysToMs(config.cacheRetentionDays.stale)
  };
}

function daysToMs(days: number): number {
  return Math.max(0, days * 24 * 60 * 60 * 1000);
}

function normalizeNotificationLevel(level: UserNotificationLevel | undefined): UserNotificationLevel {
  if (level === "all" || level === "critical") {
    return level;
  }
  return "warnings";
}

function defined<T extends object>(input: T | undefined): Partial<T> {
  if (!input) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

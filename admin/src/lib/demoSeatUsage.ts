export type SeatUsageBarMeters = {
  usedRatio?: number;
  auto?: { usedRatio?: number };
  frontier?: { usedRatio?: number };
};

/** Local sign-off only — two distinct seats so the stacked bar is obvious. */
export const DEMO_SEAT_USAGE_PROFILES: SeatUsageBarMeters[] = [
  { usedRatio: 0.41, auto: { usedRatio: 0.18 }, frontier: { usedRatio: 0.23 } },
  { usedRatio: 0.12, auto: { usedRatio: 0.12 }, frontier: { usedRatio: 0 } }
];

export function isLocalAdminHost(hostname?: string): boolean {
  const host =
    hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  return host === "localhost" || host === "127.0.0.1";
}

export function hasVisibleSeatUsage(meters?: SeatUsageBarMeters | null): boolean {
  if (!meters) {
    return false;
  }
  const used =
    typeof meters.usedRatio === "number"
      ? meters.usedRatio
      : (meters.auto?.usedRatio ?? 0) + (meters.frontier?.usedRatio ?? 0);
  return used > 0;
}

export function demoSeatUsageForIndex(index: number): SeatUsageBarMeters {
  const safeIndex = index < 0 ? 0 : index;
  return DEMO_SEAT_USAGE_PROFILES[safeIndex % DEMO_SEAT_USAGE_PROFILES.length];
}

export function resolveSeatUsageMeters(input: {
  meters?: SeatUsageBarMeters | null;
  index: number;
  hostname?: string;
}): { meters: SeatUsageBarMeters; sample: boolean } {
  if (hasVisibleSeatUsage(input.meters) && input.meters) {
    return { meters: input.meters, sample: false };
  }
  if (isLocalAdminHost(input.hostname)) {
    return { meters: demoSeatUsageForIndex(input.index), sample: true };
  }
  return {
    meters: input.meters ?? { usedRatio: 0, auto: { usedRatio: 0 }, frontier: { usedRatio: 0 } },
    sample: false
  };
}

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Default: 20 attempts per key per 15 minutes (login / register / reset). */
export const AUTH_RATE_LIMIT_MAX = 20;
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * In-memory auth attempt limiter (single process). Returns true when the request
 * may proceed. Production multi-instance deployments still benefit per replica.
 */
export function consumeAuthRateLimit(
  key: string,
  max = AUTH_RATE_LIMIT_MAX,
  windowMs = AUTH_RATE_LIMIT_WINDOW_MS,
  now = Date.now()
): boolean {
  const normalized = key.trim().toLowerCase() || "unknown";
  const existing = buckets.get(normalized);
  if (!existing || existing.resetAt <= now) {
    buckets.set(normalized, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= max) {
    return false;
  }
  existing.count += 1;
  return true;
}

export function authClientKey(
  headers: Record<string, string | undefined>,
  email?: string
): string {
  const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();
  const ip = forwarded || headers["x-real-ip"]?.trim() || "unknown";
  const mail = email?.trim().toLowerCase();
  return mail ? `${ip}|${mail}` : ip;
}

/** Test helper — clear buckets between cases. */
export function resetAuthRateLimitForTests(): void {
  buckets.clear();
}

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Pool, PoolClient } from "pg";
import type { ServerConfig } from "../serverConfig";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
export const AUTH_RATE_LIMIT_MAX = 20;
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 10_000;

/** Explicit development/test fallback only; bounded keys and expiry, never a production replica policy. */
export function consumeAuthRateLimit(key: string, max = AUTH_RATE_LIMIT_MAX, windowMs = AUTH_RATE_LIMIT_WINDOW_MS, now = Date.now()): boolean {
  const normalized = key.trim().toLowerCase() || "unknown";
  for (const [candidate, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(candidate);
  const existing = buckets.get(normalized);
  if (!existing) {
    if (buckets.size >= MAX_BUCKETS) return false;
    buckets.set(normalized, { count: 1, resetAt: now + windowMs }); return true;
  }
  if (existing.count >= max) return false;
  existing.count++; return true;
}

function normalizeIp(value: string | undefined): string | undefined {
  if (!value || !isIP(value)) return undefined;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return canonical;
}

/** A configured proxy must append its observed peer. Untrusted headers never identify the client. */
export function authClientKey(headers: Record<string, string | undefined>, peerAddress?: string, trustedProxyAddresses: readonly string[] = []): string | undefined {
  const peer = normalizeIp(peerAddress);
  if (!peer) return undefined;
  const trusted = new Set(trustedProxyAddresses.map(normalizeIp).filter((ip): ip is string => Boolean(ip)));
  if (!trusted.has(peer)) return peer;
  const raw = headers["x-forwarded-for"];
  if (!raw || raw.length > 2048) return peer;
  const chain = raw.split(",").map(value => normalizeIp(value.trim()));
  if (chain.length > 20 || chain.some(ip => !ip)) return peer;
  for (let i = chain.length - 1; i >= 0; i--) if (!trusted.has(chain[i]!)) return chain[i]!;
  return chain[0] ?? peer;
}

/** Shared counters use the database clock and a short cross-replica transaction; no email/token enters the key. */
export class AuthRateLimitStore {
  public constructor(private readonly pool: Pool, private readonly options: { max?: number; windowMs?: number; maxBuckets?: number } = {}) {
    for (const [value, ceiling] of [[options.max ?? AUTH_RATE_LIMIT_MAX, 1000], [options.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS, 3_600_000], [options.maxBuckets ?? MAX_BUCKETS, MAX_BUCKETS]]) {
      if (!Number.isSafeInteger(value) || value! < 1 || value! > ceiling!) throw new Error("Invalid auth rate limit policy.");
    }
  }
  public async consume(key: string): Promise<boolean> {
    if (!key || key.length > 200) throw new Error("Invalid auth rate limit key.");
    const keyHash = createHash("sha256").update(`coop-auth-peer-v1:${key}`).digest("hex");
    let client: PoolClient | undefined; let abandoned = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { abandoned = true; client?.release(true); reject(new Error("Auth rate limiting is unavailable.")); }, 1500);
    });
    try {
      const checkout = this.pool.connect().then(owned => {
        if (abandoned) { owned.release(); throw new Error("Auth rate limiting is unavailable."); }
        client = owned; return owned;
      });
      await Promise.race([checkout, stopped]);
      const work = async () => {
        const owned = client!;
        await owned.query("BEGIN");
        await owned.query("SET LOCAL statement_timeout = '1000ms'; SET LOCAL lock_timeout = '750ms'; SET LOCAL idle_in_transaction_session_timeout = '1500ms'");
        await owned.query("SELECT pg_advisory_xact_lock(19803403, 39)");
        // A distinct statement after lock acquisition gets a fresh snapshot and current database time.
        await owned.query(`DELETE FROM public.auth_rate_limits WHERE key_hash IN (
          SELECT key_hash FROM public.auth_rate_limits WHERE reset_at <= clock_timestamp() LIMIT 256 FOR UPDATE SKIP LOCKED)`);
        const present = await owned.query("SELECT 1 FROM public.auth_rate_limits WHERE key_hash = $1", [keyHash]);
        if (!present.rowCount) {
          const size = await owned.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM public.auth_rate_limits");
          if (Number(size.rows[0]?.count) >= (this.options.maxBuckets ?? MAX_BUCKETS)) { await owned.query("COMMIT"); return false; }
        }
        const maximum = this.options.max ?? AUTH_RATE_LIMIT_MAX;
        const result = await owned.query<{ attempts: number }>(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS now)
          INSERT INTO public.auth_rate_limits (key_hash, attempts, reset_at)
          SELECT $1, 1, tick.now + $2 * INTERVAL '1 millisecond' FROM tick
          ON CONFLICT (key_hash) DO UPDATE SET
            attempts = CASE WHEN auth_rate_limits.reset_at <= (SELECT now FROM tick) THEN 1 ELSE LEAST(auth_rate_limits.attempts + 1, $3 + 1) END,
            reset_at = CASE WHEN auth_rate_limits.reset_at <= (SELECT now FROM tick) THEN (SELECT now FROM tick) + $2 * INTERVAL '1 millisecond' ELSE auth_rate_limits.reset_at END
          RETURNING attempts`, [keyHash, this.options.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS, maximum]);
        if (result.rows.length !== 1) throw new Error("Auth rate limiting is unavailable.");
        const allowed = result.rows[0]!.attempts <= maximum;
        await owned.query("COMMIT"); return allowed;
      };
      return await Promise.race([work(), stopped]);
    } catch {
      if (client && !abandoned) {
        try { await Promise.race([client.query("ROLLBACK"), stopped]); } catch { /* bounded teardown below */ }
      }
      throw new Error("Auth rate limiting is unavailable.");
    } finally {
      if (timeout) clearTimeout(timeout);
      if (client && !abandoned) client.release();
    }
  }
}

/** Callers must supply the real socket peer and the configured shared owner in production. */
export async function consumeAuthRequest(options: {
  headers: Record<string, string | undefined>; peerAddress?: string; serverConfig: ServerConfig;
  authRateLimitStore?: AuthRateLimitStore;
}): Promise<boolean> {
  const production = options.serverConfig.nodeEnv === "production" || process.env.NODE_ENV === "production";
  const key = authClientKey(options.headers, options.peerAddress, options.serverConfig.trustedAuthProxyAddresses);
  if (options.authRateLimitStore) {
    if (!key) throw new Error("Auth rate limiting is unavailable.");
    return options.authRateLimitStore.consume(key);
  }
  if (production || !(options.serverConfig.nodeEnv === "test" ||
      (options.serverConfig.nodeEnv === "development" && options.serverConfig.devMode))) {
    throw new Error("Auth rate limiting is unavailable.");
  }
  return consumeAuthRateLimit(key ?? "local-test-peer");
}
export function resetAuthRateLimitForTests(): void { buckets.clear(); }

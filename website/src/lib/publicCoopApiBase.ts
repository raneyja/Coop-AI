const PRODUCTION_API_BASE = "https://api.coop-ai.dev";
const LOCAL_API_BASE = "http://localhost:8787";

type EnvLike = Record<string, string | undefined>;

function isProductionEnv(env: EnvLike): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

function isLoopbackApiBase(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(value);
  }
}

/**
 * Coop API origin for marketing-site server routes (and any leftover public env).
 * Production must never use localhost — even if a NEXT_PUBLIC_* leftover says so.
 */
export function resolveCoopApiBase(env: EnvLike = process.env): string {
  const configured = (
    env.COOP_API_BASE?.trim() ||
    env.NEXT_PUBLIC_COOP_API_BASE?.trim() ||
    env.NEXT_PUBLIC_API_BASE?.trim() ||
    ""
  ).replace(/\/+$/, "");

  if (isProductionEnv(env) && (!configured || isLoopbackApiBase(configured))) {
    return PRODUCTION_API_BASE;
  }
  return configured || LOCAL_API_BASE;
}

/** @deprecated Use resolveCoopApiBase — kept for existing imports. */
export function resolvePublicCoopApiBase(env: EnvLike = process.env): string {
  return resolveCoopApiBase(env);
}

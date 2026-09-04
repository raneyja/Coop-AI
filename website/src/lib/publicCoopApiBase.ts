const PRODUCTION_API_BASE = "https://api.coop-ai.dev";
const LOCAL_API_BASE = "http://localhost:8787";

type EnvLike = Record<string, string | undefined>;

/**
 * Browser-facing Coop API origin for marketing-site Google OAuth.
 * Production builds must never fall back to localhost — that ships a dead Sign-in button.
 */
export function resolvePublicCoopApiBase(env: EnvLike = process.env): string {
  const configured =
    env.NEXT_PUBLIC_COOP_API_BASE?.trim() || env.NEXT_PUBLIC_API_BASE?.trim() || "";
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (env.NODE_ENV === "production") {
    return PRODUCTION_API_BASE;
  }
  return LOCAL_API_BASE;
}

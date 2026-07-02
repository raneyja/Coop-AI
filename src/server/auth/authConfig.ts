export type AuthConfig = {
  publicBaseUrl: string;
  googleClientId?: string;
  googleClientSecret?: string;
  oauthStateSecret: string;
  accessTtlMs: number;
  refreshTtlMs: number;
  passwordMinLength: number;
  marketingBaseUrl: string;
  adminPortalUrl: string;
};

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const publicBaseUrl =
    env.COOP_PUBLIC_BASE_URL?.trim() || env.WEBHOOK_DOMAIN?.trim() || "http://localhost:8787";
  const marketingBase = env.COOP_MARKETING_BASE_URL?.trim() || "https://coop-ai.dev";
  const adminPortal = env.COOP_ADMIN_PORTAL_URL?.trim() || "http://localhost:3001";
  const stateSecret =
    env.COOP_OAUTH_STATE_SECRET?.trim() ||
    env.CREDENTIALS_ENCRYPTION_KEY?.trim() ||
    "dev-oauth-state-secret-change-me";

  const googleClientId =
    env.GOOGLE_AUTH_CLIENT_ID?.trim() || env.GOOGLE_DOCS_APP_CLIENT_ID?.trim() || undefined;
  const googleClientSecret =
    env.GOOGLE_AUTH_CLIENT_SECRET?.trim() || env.GOOGLE_DOCS_APP_CLIENT_SECRET?.trim() || undefined;

  return {
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    googleClientId,
    googleClientSecret,
    oauthStateSecret: stateSecret,
    accessTtlMs: readPositiveInt(env.AUTH_ACCESS_TTL_MS, 7 * 24 * 60 * 60 * 1000),
    refreshTtlMs: readPositiveInt(env.AUTH_REFRESH_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    passwordMinLength: readPositiveInt(env.AUTH_PASSWORD_MIN_LENGTH, 12),
    marketingBaseUrl: marketingBase.replace(/\/$/, ""),
    adminPortalUrl: adminPortal.replace(/\/$/, "")
  };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** OAuth redirect URIs Google may return to (API callback + portal BFF callbacks). */
export function allowedGoogleRedirectUris(config: AuthConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const uris = new Set<string>();
  const base = config.publicBaseUrl.replace(/\/$/, "");
  const admin = config.adminPortalUrl.replace(/\/$/, "");
  const marketing = config.marketingBaseUrl.replace(/\/$/, "");
  uris.add(`${base}/v1/auth/google/callback`);
  uris.add(`${admin}/api/auth/google/callback`);
  if (marketing !== admin) {
    uris.add(`${marketing}/api/auth/google/callback`);
  }
  const extra = env.GOOGLE_AUTH_EXTRA_REDIRECT_URIS?.split(",") ?? [];
  for (const entry of extra) {
    const trimmed = entry.trim();
    if (trimmed) {
      uris.add(trimmed.replace(/\/$/, ""));
    }
  }
  return [...uris];
}

export function isAllowedGoogleRedirectUri(
  config: AuthConfig,
  redirectUri: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const normalized = redirectUri.trim().replace(/\/$/, "");
  if (!normalized) {
    return false;
  }
  return allowedGoogleRedirectUris(config, env).includes(normalized);
}

export function defaultGoogleCallbackUri(config: AuthConfig): string {
  return `${config.publicBaseUrl.replace(/\/$/, "")}/v1/auth/google/callback`;
}

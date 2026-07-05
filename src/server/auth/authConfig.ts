import { resolveAdminPortalUrl, resolveMarketingBaseUrl } from "../../config/publicUrls";

export type GoogleOAuthCredentialSource = "GOOGLE_AUTH" | "GOOGLE_DOCS_APP";

export type AuthConfig = {
  publicBaseUrl: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleOAuthCredentialSource?: GoogleOAuthCredentialSource;
  oauthStateSecret: string;
  accessTtlMs: number;
  refreshTtlMs: number;
  passwordMinLength: number;
  marketingBaseUrl: string;
  adminPortalUrl: string;
};

/** Load client ID + secret as a matched pair (never mix AUTH id with DOCS secret). */
export function loadGoogleOAuthCredentials(
  env: NodeJS.ProcessEnv = process.env
): { clientId: string; clientSecret: string; source: GoogleOAuthCredentialSource } | undefined {
  const authId = env.GOOGLE_AUTH_CLIENT_ID?.trim();
  const authSecret = env.GOOGLE_AUTH_CLIENT_SECRET?.trim();
  if (authId && authSecret) {
    return { clientId: authId, clientSecret: authSecret, source: "GOOGLE_AUTH" };
  }

  const docsId = env.GOOGLE_DOCS_APP_CLIENT_ID?.trim();
  const docsSecret = env.GOOGLE_DOCS_APP_CLIENT_SECRET?.trim();
  if (docsId && docsSecret) {
    return { clientId: docsId, clientSecret: docsSecret, source: "GOOGLE_DOCS_APP" };
  }

  return undefined;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const publicBaseUrl =
    env.COOP_PUBLIC_BASE_URL?.trim() || env.WEBHOOK_DOMAIN?.trim() || "http://localhost:8787";
  const marketingBase = resolveMarketingBaseUrl(env, publicBaseUrl);
  const adminPortal = resolveAdminPortalUrl(env, publicBaseUrl);
  const stateSecret =
    env.COOP_OAUTH_STATE_SECRET?.trim() ||
    env.CREDENTIALS_ENCRYPTION_KEY?.trim() ||
    "dev-oauth-state-secret-change-me";

  const googleOAuth = loadGoogleOAuthCredentials(env);

  return {
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    googleClientId: googleOAuth?.clientId,
    googleClientSecret: googleOAuth?.clientSecret,
    googleOAuthCredentialSource: googleOAuth?.source,
    oauthStateSecret: stateSecret,
    accessTtlMs: readPositiveInt(env.AUTH_ACCESS_TTL_MS, 7 * 24 * 60 * 60 * 1000),
    refreshTtlMs: readPositiveInt(env.AUTH_REFRESH_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    passwordMinLength: readPositiveInt(env.AUTH_PASSWORD_MIN_LENGTH, 12),
    marketingBaseUrl: marketingBase,
    adminPortalUrl: adminPortal
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

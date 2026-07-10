import { resolveOpsPortalUrl } from "../../config/publicUrls";
import { loadGoogleOAuthCredentials, type GoogleOAuthCredentialSource } from "../auth/authConfig";

export type OperatorRole = "viewer" | "support" | "billing" | "super_admin";

export type OperatorAuthConfig = {
  googleClientId?: string;
  googleClientSecret?: string;
  googleOAuthCredentialSource?: GoogleOAuthCredentialSource;
  allowlistEmails: Set<string>;
  opsPortalUrl: string;
  sessionTtlMs: number;
  oauthStateSecret: string;
  defaultRole: OperatorRole;
};

const OPERATOR_ROLES = new Set<OperatorRole>(["viewer", "support", "billing", "super_admin"]);

export function isOperatorRole(value: string): value is OperatorRole {
  return OPERATOR_ROLES.has(value as OperatorRole);
}

export function loadOperatorAuthConfig(env: NodeJS.ProcessEnv = process.env): OperatorAuthConfig {
  const publicBaseUrl =
    env.COOP_PUBLIC_BASE_URL?.trim() || env.WEBHOOK_DOMAIN?.trim() || "http://localhost:8787";
  const opsPortalUrl = resolveOpsPortalUrl(env, publicBaseUrl);
  const stateSecret =
    env.COOP_OPERATOR_OAUTH_STATE_SECRET?.trim() ||
    env.COOP_OAUTH_STATE_SECRET?.trim() ||
    env.CREDENTIALS_ENCRYPTION_KEY?.trim() ||
    "dev-operator-oauth-state-secret-change-me";

  const allowlistRaw = env.COOP_OPERATOR_ALLOWLIST_EMAILS?.trim() ?? "";
  const allowlistEmails = new Set(
    allowlistRaw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );

  // Option A: reuse customer Google OAuth client when operator-specific vars are unset.
  const operatorGoogle = env.COOP_OPERATOR_GOOGLE_CLIENT_ID?.trim()
    ? {
        clientId: env.COOP_OPERATOR_GOOGLE_CLIENT_ID.trim(),
        clientSecret: env.COOP_OPERATOR_GOOGLE_CLIENT_SECRET?.trim() ?? "",
        source: "GOOGLE_AUTH" as GoogleOAuthCredentialSource
      }
    : loadGoogleOAuthCredentials(env);

  const defaultRoleRaw = env.COOP_OPERATOR_DEFAULT_ROLE?.trim().toLowerCase();
  const defaultRole: OperatorRole =
    defaultRoleRaw && isOperatorRole(defaultRoleRaw) ? defaultRoleRaw : "super_admin";

  return {
    googleClientId: operatorGoogle?.clientId,
    googleClientSecret: operatorGoogle?.clientSecret,
    googleOAuthCredentialSource: operatorGoogle?.source,
    allowlistEmails,
    opsPortalUrl: opsPortalUrl.replace(/\/$/, ""),
    sessionTtlMs: readPositiveInt(env.COOP_OPERATOR_SESSION_TTL_MS, 12 * 60 * 60 * 1000),
    oauthStateSecret: stateSecret,
    defaultRole
  };
}

export function allowedOperatorGoogleRedirectUris(config: OperatorAuthConfig): string[] {
  const ops = config.opsPortalUrl.replace(/\/$/, "");
  return [`${ops}/api/auth/google/callback`];
}

export function isAllowedOperatorGoogleRedirectUri(
  config: OperatorAuthConfig,
  redirectUri: string
): boolean {
  const normalized = redirectUri.trim().replace(/\/$/, "");
  return allowedOperatorGoogleRedirectUris(config).includes(normalized);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

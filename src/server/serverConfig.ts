import { isIP } from "node:net";

export type ServerConfig = {
  nodeEnv: string;
  requireApiAuth: boolean;
  legacyApiToken?: string;
  credentialsEncryptionKey?: string;
  jobsWorkersEnabled: boolean;
  devMode: boolean;
  /** Exact transport proxy addresses permitted to supply an appended forwarding chain. */
  trustedAuthProxyAddresses?: string[];
  /** Public base URL of the backend (e.g. https://api.coop-ai.dev). Enables SAML SSO when set. */
  ssoBaseUrl?: string;
  /** Optional SP entityId override; defaults to `${ssoBaseUrl}/v1/auth/saml/metadata`. */
  ssoSpEntityId?: string;
  /** SSO session lifetime in ms. Defaults to userStore's 12h when unset. */
  ssoSessionTtlMs?: number;
};

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const legacyApiToken = env.COOP_JOBS_API_TOKEN ?? env.COOP_API_TOKEN;
  const authFlag = readBoolean(env.COOP_REQUIRE_API_AUTH, nodeEnv === "production");
  if (nodeEnv === "production" && env.COOP_REQUIRE_API_AUTH !== undefined && !authFlag) {
    console.error("[config] COOP_REQUIRE_API_AUTH=false is ignored when NODE_ENV=production");
  }
  return {
    nodeEnv,
    requireApiAuth: nodeEnv === "production" ? true : authFlag,
    legacyApiToken,
    credentialsEncryptionKey: env.CREDENTIALS_ENCRYPTION_KEY,
    jobsWorkersEnabled: readBoolean(env.JOBS_WORKERS, env.JOBS_WORKERS !== "0"),
    devMode: readBoolean(env.COOP_DEV_MODE, false),
    trustedAuthProxyAddresses: parseTrustedAuthProxyAddresses(env.COOP_AUTH_TRUSTED_PROXY_IPS),
    ssoBaseUrl: env.COOP_PUBLIC_BASE_URL?.trim() || undefined,
    ssoSpEntityId: env.COOP_SSO_SP_ENTITY_ID?.trim() || undefined,
    ssoSessionTtlMs: readPositiveInt(env.COOP_SSO_SESSION_TTL_MS)
  };
}

function parseTrustedAuthProxyAddresses(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const addresses = value.split(",").map(address => address.trim());
  if (addresses.length > 32 || addresses.some(address => !isIP(address))) {
    throw new Error("COOP_AUTH_TRUSTED_PROXY_IPS requires at most 32 exact IP addresses.");
  }
  return [...new Set(addresses)];
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readPositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

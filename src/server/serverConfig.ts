import { isIP } from "node:net";
import { isCanonicalCredentialEncryptionKey } from "./credentialCrypto";

export type ServerConfig = {
  nodeEnv: string;
  requireApiAuth: boolean;
  legacyApiToken?: string;
  credentialsEncryptionKey?: string;
  jobsWorkersEnabled: boolean;
  devMode: boolean;
  /** Explicit split-worker readiness expectations. No fleet count/build is inferred. */
  workerFleetId?: string;
  expectedWorkerBundleSha256?: string;
  minimumReadyWorkers?: number;
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
  if (
    nodeEnv === "production" &&
    env.CREDENTIALS_ENCRYPTION_KEY &&
    !isCanonicalCredentialEncryptionKey(env.CREDENTIALS_ENCRYPTION_KEY)
  ) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be canonical base64 encoding of a 32-byte key in production.");
  }
  return {
    nodeEnv,
    requireApiAuth: nodeEnv === "production" ? true : authFlag,
    legacyApiToken,
    credentialsEncryptionKey: env.CREDENTIALS_ENCRYPTION_KEY,
    jobsWorkersEnabled: readBoolean(env.JOBS_WORKERS, env.JOBS_WORKERS !== "0"),
    devMode: readBoolean(env.COOP_DEV_MODE, false),
    ...workerFleetExpectations(env),
    trustedAuthProxyAddresses: parseTrustedAuthProxyAddresses(env.COOP_AUTH_TRUSTED_PROXY_IPS),
    ssoBaseUrl: env.COOP_PUBLIC_BASE_URL?.trim() || undefined,
    ssoSpEntityId: env.COOP_SSO_SP_ENTITY_ID?.trim() || undefined,
    ssoSessionTtlMs: readPositiveInt(env.COOP_SSO_SESSION_TTL_MS)
  };
}

function workerFleetExpectations(env: NodeJS.ProcessEnv): Partial<ServerConfig> {
  const result: Partial<ServerConfig> = {};
  if (env.COOP_WORKER_FLEET_ID !== undefined) {
    const value = env.COOP_WORKER_FLEET_ID.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error("Invalid COOP_WORKER_FLEET_ID");
    result.workerFleetId = value;
  }
  if (env.COOP_EXPECTED_WORKER_SHA256 !== undefined) {
    const value = env.COOP_EXPECTED_WORKER_SHA256.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid COOP_EXPECTED_WORKER_SHA256");
    result.expectedWorkerBundleSha256 = value;
  }
  if (env.COOP_MIN_READY_WORKERS !== undefined) {
    const value = env.COOP_MIN_READY_WORKERS.trim();
    const minimum = Number(value);
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(minimum)) throw new Error("Invalid COOP_MIN_READY_WORKERS");
    result.minimumReadyWorkers = minimum;
  }
  return result;
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

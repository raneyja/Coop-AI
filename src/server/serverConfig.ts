export type ServerConfig = {
  nodeEnv: string;
  requireApiAuth: boolean;
  legacyApiToken?: string;
  credentialsEncryptionKey?: string;
  jobsWorkersEnabled: boolean;
  devMode: boolean;
};

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const legacyApiToken = env.COOP_JOBS_API_TOKEN ?? env.COOP_API_TOKEN;
  return {
    nodeEnv,
    requireApiAuth: readBoolean(env.COOP_REQUIRE_API_AUTH, nodeEnv === "production"),
    legacyApiToken,
    credentialsEncryptionKey: env.CREDENTIALS_ENCRYPTION_KEY,
    jobsWorkersEnabled: readBoolean(env.JOBS_WORKERS, env.JOBS_WORKERS !== "0"),
    devMode: readBoolean(env.COOP_DEV_MODE, false)
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

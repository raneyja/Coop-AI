import { resolvePublicBaseUrl } from "./publicBaseUrl";

export type GitHubAppConfig = {
  appId: string;
  privateKeyPem: string;
  slug: string;
  webhookSecret?: string;
  /** Public HTTPS base for install callback (e.g. https://api.coop-ai.dev). */
  publicBaseUrl: string;
};

export function loadGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig | undefined {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKeyPem = readPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const slug = env.GITHUB_APP_SLUG?.trim() || "coop-ai";
  if (!appId || !privateKeyPem) {
    return undefined;
  }
  const publicBaseUrl = resolvePublicBaseUrl(env);
  return {
    appId,
    privateKeyPem,
    slug,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET?.trim(),
    publicBaseUrl: publicBaseUrl
  };
}

export function isCoopDevModeServer(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.COOP_DEV_MODE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readPrivateKey(raw: string | undefined): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  let key = raw.trim();
  if (!key.includes("BEGIN")) {
    key = Buffer.from(key, "base64").toString("utf8");
  }
  return /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(key) ? key : undefined;
}

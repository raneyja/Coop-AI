import { MARKETING_SITE_URL } from "./siteConfig";

/** Canonical admin portal — not the marketing site host. */
export const ADMIN_PORTAL_URL = "https://admin.coop-ai.dev";

export function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** True when the API is deployed (not local docker/dev). */
export function isProductionApiHost(publicBaseUrl: string): boolean {
  try {
    const host = new URL(publicBaseUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return false;
    }
    return host === "api.coop-ai.dev" || host.endsWith(".coop-ai.dev");
  } catch {
    return false;
  }
}

/**
 * Prefer env when set. On a production API host, ignore localhost env values so
 * transactional emails and checkout redirects never point at dev servers.
 */
export function resolvePublicUrl(
  envValue: string | undefined,
  publicBaseUrl: string,
  productionDefault: string,
  localDefault?: string
): string {
  const trimmed = envValue?.trim();
  if (trimmed && !(isProductionApiHost(publicBaseUrl) && isLocalhostUrl(trimmed))) {
    return trimmed.replace(/\/$/, "");
  }
  if (isProductionApiHost(publicBaseUrl)) {
    return productionDefault.replace(/\/$/, "");
  }
  return (trimmed || localDefault || productionDefault).replace(/\/$/, "");
}

export function resolveMarketingBaseUrl(env: NodeJS.ProcessEnv, publicBaseUrl: string): string {
  return resolvePublicUrl(
    env.COOP_MARKETING_BASE_URL,
    publicBaseUrl,
    MARKETING_SITE_URL,
    "http://localhost:3001"
  );
}

export function resolveAdminPortalUrl(env: NodeJS.ProcessEnv, publicBaseUrl: string): string {
  return resolvePublicUrl(env.COOP_ADMIN_PORTAL_URL, publicBaseUrl, ADMIN_PORTAL_URL, "http://localhost:3001");
}

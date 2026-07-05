import { resolveAdminPortalUrl } from "../config/publicUrls";

/**
 * Optional post-OAuth browser redirect. Local API servers skip auto-redirect so
 * users stay on the success page. Production sends admins back to Integrations.
 */
export function resolveOAuthSuccessRedirectUrl(
  publicBaseUrl: string,
  query: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  try {
    const host = new URL(publicBaseUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return undefined;
    }
    const adminPortal = resolveAdminPortalUrl(env, publicBaseUrl);
    return `${adminPortal.replace(/\/$/, "")}/integrations?${query}`;
  } catch {
    return undefined;
  }
}

/** After GitHub App install/reconnect, send admins back to Integrations. */
export function resolveGithubConnectSuccessRedirectUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const publicBase =
    env.COOP_PUBLIC_BASE_URL?.trim() || env.WEBHOOK_DOMAIN?.trim() || "http://localhost:8787";
  const adminPortal = resolveAdminPortalUrl(env, publicBase);
  return `${adminPortal.replace(/\/$/, "")}/integrations?github=connected`;
}

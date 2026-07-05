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
    const adminPortal =
      env.COOP_ADMIN_PORTAL_URL?.trim() ||
      (host === "api.coop-ai.dev" ? "https://admin.coop-ai.dev" : undefined);
    if (adminPortal) {
      return `${adminPortal.replace(/\/$/, "")}/integrations?${query}`;
    }
    return `${publicBaseUrl.replace(/\/$/, "")}/integrations?${query}`;
  } catch {
    return undefined;
  }
}

/** After GitHub App install/reconnect, send admins back to Integrations. */
export function resolveGithubConnectSuccessRedirectUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const adminPortal = env.COOP_ADMIN_PORTAL_URL?.trim() || "http://localhost:3001";
  return `${adminPortal.replace(/\/$/, "")}/integrations?github=connected`;
}

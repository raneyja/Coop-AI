/**
 * Optional post-OAuth browser redirect. Local API servers have no /docs route;
 * skip auto-redirect so users stay on the success page instead of seeing JSON 404.
 */
export function resolveOAuthSuccessRedirectUrl(
  publicBaseUrl: string,
  query: string
): string | undefined {
  try {
    const host = new URL(publicBaseUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return undefined;
    }
    if (host === "api.coop-ai.dev") {
      return `https://coop-ai.dev/docs?${query}`;
    }
    return `${publicBaseUrl.replace(/\/$/, "")}/docs?${query}`;
  } catch {
    return undefined;
  }
}

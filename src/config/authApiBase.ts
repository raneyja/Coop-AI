import { DEFAULT_API_BASE } from "../chat/types";
import { ADMIN_PORTAL_URL } from "./publicUrls";

export function isLoopbackCoopApiBase(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(baseUrl);
  }
}

/**
 * Google / password / SSO live on the public Coop API.
 * Localhost does not run Google OAuth — using it produces google_auth_unavailable.
 */
export function resolveUserAuthApiBase(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!trimmed || isLoopbackCoopApiBase(trimmed)) {
    return DEFAULT_API_BASE;
  }
  return trimmed;
}

/**
 * Hosted Google sign-in runs through the admin portal so the browser never
 * needs to navigate to the API hostname. The portal performs the API exchange
 * server-side and hands the finished session back to the editor URI.
 */
export function buildUserGoogleAuthStartUrl(apiBaseUrl: string, redirect?: string): string {
  const authBase = resolveUserAuthApiBase(apiBaseUrl);
  const isHostedCoop = authBase === DEFAULT_API_BASE;
  const startUrl = new URL(
    isHostedCoop ? "/api/auth/google/start" : "/v1/auth/google/start",
    isHostedCoop ? ADMIN_PORTAL_URL : authBase
  );
  startUrl.searchParams.set("mode", "login");
  const sanitized = redirect?.trim();
  if (sanitized) {
    startUrl.searchParams.set("redirect", sanitized);
  }
  return startUrl.toString();
}

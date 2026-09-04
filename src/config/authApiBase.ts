import { DEFAULT_API_BASE } from "../chat/types";

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

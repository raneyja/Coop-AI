import { ADMIN_PORTAL_URL } from "../../config/publicUrls";

function normalizeAdminPortalBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/login$/, "");
}

/** Base admin portal URL → sign-in page (used in emails and post-checkout links). */
export function adminPortalLoginUrl(baseUrl: string): string {
  const trimmed = normalizeAdminPortalBase(baseUrl) || ADMIN_PORTAL_URL;
  return `${trimmed}/login`;
}

export type AdminPortalFreshLoginOptions = {
  /** Prefill the login form when known (e.g. email recipient). */
  email?: string;
};

/**
 * Sign-in URL for transactional email / post-checkout CTAs.
 * Forces the admin portal to clear any existing browser session before showing login
 * so the recipient is not auto-routed into a different account.
 */
export function adminPortalFreshLoginUrl(
  baseUrl: string,
  options?: AdminPortalFreshLoginOptions
): string {
  const url = new URL(adminPortalLoginUrl(baseUrl));
  url.searchParams.set("signedOut", "1");
  const email = options?.email?.trim();
  if (email) {
    url.searchParams.set("email", email);
  }
  return url.toString();
}

/** Admin portal invite acceptance page (new teammates set a password here). */
export function adminPortalAcceptInviteUrl(baseUrl: string, token: string): string {
  const trimmed = normalizeAdminPortalBase(baseUrl) || ADMIN_PORTAL_URL;
  return `${trimmed}/accept-invite?token=${encodeURIComponent(token)}`;
}

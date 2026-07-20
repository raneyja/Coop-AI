import { ADMIN_PORTAL_URL } from "../../config/publicUrls";

function normalizeAdminPortalBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/login$/, "");
}

/** Base admin portal URL → sign-in page (used in emails and post-checkout links). */
export function adminPortalLoginUrl(baseUrl: string): string {
  const trimmed = normalizeAdminPortalBase(baseUrl) || ADMIN_PORTAL_URL;
  return `${trimmed}/login`;
}

/** Admin portal invite acceptance page (new teammates set a password here). */
export function adminPortalAcceptInviteUrl(baseUrl: string, token: string): string {
  const trimmed = normalizeAdminPortalBase(baseUrl) || ADMIN_PORTAL_URL;
  return `${trimmed}/accept-invite?token=${encodeURIComponent(token)}`;
}

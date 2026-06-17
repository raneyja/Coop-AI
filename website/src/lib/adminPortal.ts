/** Base admin portal URL from env → sign-in page. */
export function getAdminPortalLoginUrl(): string {
  const base = process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL?.trim() || "http://localhost:3001";
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/login")) {
    return trimmed;
  }
  return `${trimmed}/login`;
}

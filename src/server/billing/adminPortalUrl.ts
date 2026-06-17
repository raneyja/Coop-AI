/** Base admin portal URL → sign-in page (used in emails and post-checkout links). */
export function adminPortalLoginUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "/login";
  }
  if (trimmed.endsWith("/login")) {
    return trimmed;
  }
  return `${trimmed}/login`;
}

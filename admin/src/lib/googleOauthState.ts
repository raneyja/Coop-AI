export const ADMIN_OAUTH_STATE_COOKIE = "coop_admin_oauth_state";
export const ADMIN_OAUTH_STATE_MAX_AGE_SEC = 15 * 60;

export function authorizeState(location: string): string | undefined {
  try {
    const url = new URL(location);
    if (url.origin !== "https://accounts.google.com") return undefined;
    return url.searchParams.get("state") || undefined;
  } catch {
    return undefined;
  }
}

export function callbackStateCookie(request: Request): string | undefined {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${ADMIN_OAUTH_STATE_COOKIE}=`));
  if (matches.length !== 1) return undefined;
  try {
    return decodeURIComponent(matches[0].slice(ADMIN_OAUTH_STATE_COOKIE.length + 1));
  } catch {
    return undefined;
  }
}

import { getAdminPortalAuthCallbackUrl } from "./adminPortal";

export const PASSWORD_MIN_LENGTH = 12;

const ACCESS_TOKEN_KEY = "coop_access_token";
const REFRESH_TOKEN_KEY = "coop_refresh_token";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
  orgId?: string;
  orgName?: string;
  email?: string;
  plan?: string;
  adminPortalLoginUrl?: string;
};

export function saveWebsiteSession(session: Pick<AuthSession, "accessToken" | "refreshToken">): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
}

export function clearWebsiteSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function redirectToAdminPortal(session: Pick<AuthSession, "accessToken" | "refreshToken">): void {
  saveWebsiteSession(session);
  const callback = getAdminPortalAuthCallbackUrl();
  const params = new URLSearchParams();
  params.set("coopToken", session.accessToken);
  params.set("coopRefresh", session.refreshToken);
  window.location.href = `${callback}#${params.toString()}`;
}

export function validatePasswordClient(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export function getGoogleAuthStartUrl(options: {
  mode: "signup" | "login";
  orgName?: string;
}): string {
  const apiBase =
    process.env.NEXT_PUBLIC_COOP_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE?.trim() ||
    "http://localhost:8787";
  const redirect = getAdminPortalAuthCallbackUrl();
  const params = new URLSearchParams({
    mode: options.mode,
    redirect
  });
  if (options.orgName?.trim()) {
    params.set("orgName", options.orgName.trim());
  }
  return `${apiBase.replace(/\/$/, "")}/v1/auth/google/start?${params.toString()}`;
}

export const authInputClassName =
  "w-full rounded-md border border-coop-border bg-white px-3 py-2 text-gray-900 placeholder:text-coop-muted/60 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-300";

export const authErrorClassName =
  "rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700";

export const authSuccessClassName =
  "rounded-sm border border-coop-index/30 bg-coop-index/10 px-3 py-2 text-sm text-gray-900";

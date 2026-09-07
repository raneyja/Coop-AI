import { getAdminPortalAuthCallbackUrl } from "./adminPortal";

export const MARKETING_GOOGLE_AUTH_START_PATH = "/api/auth/google/start";

export const GOOGLE_START_QUERY_KEYS = [
  "mode",
  "redirect",
  "orgName",
  "tier",
  "intent",
  "seats",
  "inviteToken",
  "firstName",
  "lastName",
  "timezone"
] as const;

export type GoogleAuthStartMode = "signup" | "login" | "checkout";

/**
 * Same-origin Google start URL. The browser must never be sent to the API host
 * (that is how localhost:8787 leaked into production).
 */
export function marketingGoogleAuthStartUrl(options: {
  mode: GoogleAuthStartMode;
  orgName?: string;
  redirect?: string;
  checkout?: {
    tier: "pro" | "pro_plus" | "max";
    intent: "individual" | "team";
    seats?: number;
  };
}): string {
  const params = new URLSearchParams({
    mode: options.mode,
    redirect: options.redirect?.trim() || getAdminPortalAuthCallbackUrl()
  });
  if (options.orgName?.trim()) {
    params.set("orgName", options.orgName.trim());
  }
  if (options.mode === "checkout" && options.checkout) {
    params.set("tier", options.checkout.tier);
    params.set("intent", options.checkout.intent);
    if (options.checkout.intent === "team" && options.checkout.seats != null) {
      params.set("seats", String(options.checkout.seats));
    }
  }
  return `${MARKETING_GOOGLE_AUTH_START_PATH}?${params.toString()}`;
}

export function backendGoogleStartUrl(apiBase: string, searchParams: URLSearchParams): string {
  const backend = new URL(`${apiBase.replace(/\/+$/, "")}/v1/auth/google/start`);
  for (const key of GOOGLE_START_QUERY_KEYS) {
    const value = searchParams.get(key)?.trim();
    if (value) {
      backend.searchParams.set(key, value);
    }
  }
  if (!backend.searchParams.get("redirect")) {
    backend.searchParams.set("redirect", getAdminPortalAuthCallbackUrl());
  }
  return backend.toString();
}

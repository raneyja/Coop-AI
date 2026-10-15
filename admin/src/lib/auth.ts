import { clearOrgSuspended } from "./orgSuspendedState";

/** Fired on `window` after the signed-in org name changes. */
export const ORG_NAME_UPDATED_EVENT = "coop:org-name-updated";

const TOKEN_KEY = "coop_admin_api_token";
const REFRESH_TOKEN_KEY = "coop_admin_refresh_token";
const ORG_NAME_KEY = "coop_admin_org_name";
const ME_KEY = "coop_admin_me";
const UPGRADE_POPUP_DISMISS_KEY = "coop-upgrade-popup-dismissed";
let currentMe: StoredMe | null = null;
let currentOrgNameOverride: string | null = null;
if (typeof window !== "undefined") clearLegacySensitiveStorage();

export type StoredMe = {
  orgId: string;
  orgName: string;
  plan: "free" | "pro" | "enterprise";
  role?: string;
  userId?: string;
  firstName?: string;
  lastName?: string;
  timezone?: string;
  memberOnboardingCompleted?: boolean;
  canInstallIntegrations?: boolean;
  email?: string;
  authMethod?: "api_key" | "sso_session" | "password" | "google_oauth";
  sessionProvider?: "password" | "google" | "saml";
  usageTier?: string | null;
  seats?: number | null;
};

export function getOrgNameOverride(): string | null {
  return currentOrgNameOverride;
}

export function getStoredMe(): StoredMe | null {
  return typeof window === "undefined" ? null : currentMe;
}

export function saveSession(
  me: StoredMe,
  orgNameOverride?: string
): void {
  if (typeof window === "undefined") throw new Error("Browser session state is unavailable on the server");
  currentMe = me;
  currentOrgNameOverride = orgNameOverride?.trim() || null;
  clearLegacySensitiveStorage();
  // Successful sign-in for this org — clear any prior suspended-org latch.
  clearOrgSuspended();
  clearUpgradePopupDismissed();
}

/** Update cached /v1/me profile without touching tokens. */
export function updateStoredMe(me: StoredMe): void {
  if (typeof window === "undefined") throw new Error("Browser session state is unavailable on the server");
  currentMe = me;
}

/** Persist a renamed organization so the portal header and settings stay in sync. */
export function setStoredOrgName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return;
  const me = getStoredMe();
  const override = getOrgNameOverride();
  if (me?.orgName === trimmed && !override) return;
  if (me) {
    updateStoredMe({ ...me, orgName: trimmed });
  }
  currentOrgNameOverride = null;
  window.dispatchEvent(new Event(ORG_NAME_UPDATED_EVENT));
}

export function clearSession(): void {
  currentMe = null;
  currentOrgNameOverride = null;
  clearLegacySensitiveStorage();
  clearUpgradePopupDismissed();
  clearOrgSuspended();
}

function clearLegacySensitiveStorage(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(ME_KEY);
    sessionStorage.removeItem(ORG_NAME_KEY);
  } catch {
    // Browser storage may be unavailable; no sensitive data is written here.
  }
}

export function isUpgradePopupDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(UPGRADE_POPUP_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function markUpgradePopupDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(UPGRADE_POPUP_DISMISS_KEY, "1");
  } catch {
    // Ignore quota / private mode.
  }
}

export function clearUpgradePopupDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(UPGRADE_POPUP_DISMISS_KEY);
  } catch {
    // Ignore quota / private mode.
  }
}

export async function restoreSessionFromCookie(): Promise<StoredMe | null> {
  clearLegacySensitiveStorage();
  try {
    const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      // Suspended/expired cookies must not leave stale profile data in memory.
      if (response.status === 401 || response.status === 403) {
        clearSession();
      }
      return null;
    }
    const data = (await response.json()) as StoredMe;
    if (
      !data ||
      typeof data.orgId !== "string" || !data.orgId ||
      typeof data.orgName !== "string" || !data.orgName ||
      !["free", "pro", "enterprise"].includes(data.plan)
    ) {
      clearSession();
      return null;
    }
    const me: StoredMe = {
      orgId: data.orgId,
      orgName: data.orgName,
      plan: data.plan,
      role: data.role,
      userId: typeof data.userId === "string" ? data.userId : undefined,
      firstName: data.firstName,
      lastName: data.lastName,
      timezone: data.timezone,
      memberOnboardingCompleted: data.memberOnboardingCompleted,
      canInstallIntegrations: data.canInstallIntegrations,
      email: data.email,
      authMethod: data.authMethod,
      sessionProvider: data.sessionProvider
    };
    saveSession(me);
    return me;
  } catch {
    return null;
  }
}

export async function establishSessionCookie(accessToken: string, refreshToken?: string): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, refreshToken })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function signOutRemote(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include"
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function displayOrgName(me: StoredMe | null): string {
  if (!me) return "Organization";
  return getOrgNameOverride() ?? me.orgName ?? "Organization";
}

export function isAdminRole(me: StoredMe): boolean {
  if (me.canInstallIntegrations === true) return true;
  const role = (me.role ?? "").toLowerCase();
  return role === "owner" || role === "admin";
}

export function isMemberRole(me: StoredMe): boolean {
  return !isAdminRole(me);
}

export function canAccessAdminPages(me: StoredMe): boolean {
  return isAdminRole(me);
}

export function defaultHomePath(me: StoredMe | null): string {
  if (me && isMemberRole(me)) {
    return "/";
  }
  return "/";
}

const MEMBER_ALLOWED_PREFIXES = [
  "/",
  "/feed",
  "/settings",
  "/my-usage",
  "/analytics/my",
  "/my-activity",
  "/integrations"
];

export function isMemberAllowedPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/feed" || pathname.startsWith("/feed/")) {
    return true;
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return true;
  }
  if (pathname === "/integrations" || pathname.startsWith("/integrations/")) {
    return true;
  }
  if (pathname === "/analytics/my" || pathname.startsWith("/analytics/my/")) {
    return true;
  }
  if (pathname === "/analytics" || pathname.startsWith("/analytics/")) {
    return false;
  }
  return MEMBER_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function meFromAuthPayload(data: Record<string, unknown>): StoredMe {
  return {
    orgId: String(data.orgId ?? ""),
    orgName: String(data.orgName ?? ""),
    plan: (data.plan as StoredMe["plan"]) ?? "free",
    role: typeof data.role === "string" ? data.role : undefined,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    firstName: typeof data.firstName === "string" ? data.firstName : undefined,
    lastName: typeof data.lastName === "string" ? data.lastName : undefined,
    timezone: typeof data.timezone === "string" ? data.timezone : undefined,
    memberOnboardingCompleted: data.memberOnboardingCompleted === true,
    canInstallIntegrations: data.canInstallIntegrations === true,
    email: typeof data.email === "string" ? data.email : undefined,
    authMethod: data.authMethod as StoredMe["authMethod"],
    sessionProvider: data.sessionProvider as StoredMe["sessionProvider"],
    usageTier: typeof data.usageTier === "string" ? data.usageTier : data.usageTier === null ? null : undefined,
    seats: typeof data.seats === "number" && Number.isFinite(data.seats) ? data.seats : undefined
  };
}

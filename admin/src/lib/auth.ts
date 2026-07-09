const TOKEN_KEY = "coop_admin_api_token";
const REFRESH_TOKEN_KEY = "coop_admin_refresh_token";
const ORG_NAME_KEY = "coop_admin_org_name";
const ME_KEY = "coop_admin_me";

export type StoredMe = {
  orgId: string;
  orgName: string;
  plan: "free" | "pro" | "enterprise";
  role?: string;
  firstName?: string;
  lastName?: string;
  timezone?: string;
  memberOnboardingCompleted?: boolean;
  canInstallIntegrations?: boolean;
  email?: string;
  authMethod?: "api_key" | "sso_session" | "password" | "google_oauth";
  sessionProvider?: "password" | "google" | "saml";
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

/** @deprecated Use getToken — kept for older automation-key session storage. */
export const getApiToken = getToken;

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getOrgNameOverride(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ORG_NAME_KEY);
}

export function getStoredMe(): StoredMe | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(ME_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredMe;
  } catch {
    return null;
  }
}

export function saveSession(
  token: string,
  me: StoredMe,
  orgNameOverride?: string,
  refreshToken?: string
): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(ME_KEY, JSON.stringify(me));
  if (refreshToken?.trim()) {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken.trim());
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
  if (orgNameOverride?.trim()) {
    sessionStorage.setItem(ORG_NAME_KEY, orgNameOverride.trim());
  } else {
    sessionStorage.removeItem(ORG_NAME_KEY);
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(ME_KEY);
  sessionStorage.removeItem(ORG_NAME_KEY);
}

export async function restoreSessionFromCookie(): Promise<StoredMe | null> {
  try {
    const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as StoredMe & {
      accessToken?: string;
      refreshToken?: string;
    };
    const token = String(data.accessToken ?? "").trim();
    if (!token) {
      return null;
    }
    const me: StoredMe = {
      orgId: data.orgId,
      orgName: data.orgName,
      plan: data.plan,
      role: data.role,
      firstName: data.firstName,
      lastName: data.lastName,
      timezone: data.timezone,
      memberOnboardingCompleted: data.memberOnboardingCompleted,
      canInstallIntegrations: data.canInstallIntegrations,
      email: data.email,
      authMethod: data.authMethod,
      sessionProvider: data.sessionProvider
    };
    saveSession(token, me, undefined, data.refreshToken);
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

export async function signOutRemote(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refreshToken ?? "" })
    });
  } catch {
    // still clear local session
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
    firstName: typeof data.firstName === "string" ? data.firstName : undefined,
    lastName: typeof data.lastName === "string" ? data.lastName : undefined,
    timezone: typeof data.timezone === "string" ? data.timezone : undefined,
    memberOnboardingCompleted: data.memberOnboardingCompleted === true,
    canInstallIntegrations: data.canInstallIntegrations === true,
    email: typeof data.email === "string" ? data.email : undefined,
    authMethod: data.authMethod as StoredMe["authMethod"],
    sessionProvider: data.sessionProvider as StoredMe["sessionProvider"]
  };
}

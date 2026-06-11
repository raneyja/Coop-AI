const TOKEN_KEY = "coop_admin_api_token";
const ORG_NAME_KEY = "coop_admin_org_name";
const ME_KEY = "coop_admin_me";

export type StoredMe = {
  orgId: string;
  orgName: string;
  plan: "free" | "pro" | "enterprise";
  role?: string;
  canInstallIntegrations?: boolean;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
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

export function saveSession(token: string, me: StoredMe, orgNameOverride?: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(ME_KEY, JSON.stringify(me));
  if (orgNameOverride?.trim()) {
    sessionStorage.setItem(ORG_NAME_KEY, orgNameOverride.trim());
  } else {
    sessionStorage.removeItem(ORG_NAME_KEY);
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ME_KEY);
  sessionStorage.removeItem(ORG_NAME_KEY);
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

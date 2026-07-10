const TOKEN_KEY = "coop_ops_token";
const ME_KEY = "coop_ops_me";

export type OperatorRole = "viewer" | "support" | "billing" | "super_admin";

export type StoredOperatorMe = {
  id: string;
  email: string;
  name?: string;
  role: OperatorRole;
  authMethod?: "google_oauth";
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredMe(): StoredOperatorMe | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(ME_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredOperatorMe;
  } catch {
    return null;
  }
}

export function saveSession(token: string, me: StoredOperatorMe): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(ME_KEY, JSON.stringify(me));
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ME_KEY);
}

export async function restoreSessionFromCookie(): Promise<StoredOperatorMe | null> {
  try {
    const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as StoredOperatorMe & { accessToken?: string };
    const token = String(data.accessToken ?? "").trim();
    if (!token) {
      return null;
    }
    const me: StoredOperatorMe = {
      id: String(data.id ?? ""),
      email: String(data.email ?? ""),
      name: typeof data.name === "string" ? data.name : undefined,
      role: (data.role as OperatorRole) ?? "viewer",
      authMethod: data.authMethod
    };
    saveSession(token, me);
    return me;
  } catch {
    return null;
  }
}

export async function establishSessionCookie(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function signOutRemote(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
  } catch {
    // still clear local session
  }
}

export function meFromAuthPayload(data: Record<string, unknown>): StoredOperatorMe {
  return {
    id: String(data.id ?? ""),
    email: String(data.email ?? ""),
    name: typeof data.name === "string" ? data.name : undefined,
    role: (data.role as OperatorRole) ?? "viewer",
    authMethod: data.authMethod as StoredOperatorMe["authMethod"]
  };
}

export function roleLabel(role: OperatorRole): string {
  switch (role) {
    case "super_admin":
      return "Super admin";
    case "billing":
      return "Billing";
    case "support":
      return "Support";
    default:
      return "Viewer";
  }
}

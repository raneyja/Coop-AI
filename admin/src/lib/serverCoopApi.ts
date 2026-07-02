import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const SESSION_COOKIE = "coop_session";

export function serverApiBase(): string {
  const base =
    process.env.COOP_API_BASE?.trim() ||
    process.env.NEXT_PUBLIC_COOP_API_BASE?.trim() ||
    "https://api.coop-ai.dev";
  return base.replace(/\/$/, "");
}

export function isCoopCredential(token: string): boolean {
  return token.startsWith("coop_") || token.startsWith("coop_sess_");
}

export function sessionCookieOptions(maxAgeSeconds = 60 * 60 * 24 * 7) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds
  };
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value?.trim();
  return token && isCoopCredential(token) ? token : null;
}

export async function fetchMe(token: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${serverApiBase()}/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

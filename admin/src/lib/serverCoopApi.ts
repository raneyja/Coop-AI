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

/** Bearer token from Authorization header, or httpOnly session cookie when absent. */
export async function resolveRequestBearerToken(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (isCoopCredential(token)) {
      return token;
    }
  }
  return readSessionToken();
}

export async function backendFetch(
  path: string,
  request: Request,
  init: RequestInit = {}
): Promise<Response> {
  const primaryToken = await resolveRequestBearerToken(request);
  if (!primaryToken) {
    return new Response(JSON.stringify({ error: "unauthorized", message: "Not signed in." }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${primaryToken}`);

  let response = await fetch(`${serverApiBase()}${path}`, { ...init, headers, cache: "no-store" });
  if (response.status !== 401) {
    return response;
  }

  const cookieToken = await readSessionToken();
  if (!cookieToken || cookieToken === primaryToken) {
    return response;
  }

  headers.set("Authorization", `Bearer ${cookieToken}`);
  return fetch(`${serverApiBase()}${path}`, { ...init, headers, cache: "no-store" });
}

export async function fetchMe(token: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${serverApiBase()}/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

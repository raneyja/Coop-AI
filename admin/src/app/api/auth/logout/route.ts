import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  readRefreshToken,
  readSessionToken,
  serverApiBase
} from "@/lib/serverCoopApi";
import { isSameOriginMutation } from "@/lib/portalProxyPolicy";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const token = await readSessionToken();
  let refreshToken = await readRefreshToken();
  if (!refreshToken) {
    try {
      const body = (await request.json()) as { refreshToken?: string };
      const legacyRefresh = String(body.refreshToken ?? "").trim();
      refreshToken = legacyRefresh.startsWith("coop_refresh_") ? legacyRefresh : null;
    } catch {
      // Older tabs may have no refresh token.
    }
  }

  if (token || refreshToken) {
    try {
      const upstream = await fetch(`${serverApiBase()}/v1/auth/logout`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refreshToken: refreshToken ?? "" }),
        cache: "no-store"
      });
      if (!upstream.ok) {
        return NextResponse.json(
          { error: "sign_out_failed", message: "Could not sign out. Please try again." },
          { status: 502 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "sign_out_failed", message: "Could not sign out. Please try again." },
        { status: 503 }
      );
    }
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}

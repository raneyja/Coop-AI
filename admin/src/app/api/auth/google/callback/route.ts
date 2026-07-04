import { NextResponse } from "next/server";
import { serverApiBase, setSessionCookie } from "@/lib/serverCoopApi";

function loginRedirect(origin: string, error: string, message: string): NextResponse {
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", error);
  loginUrl.searchParams.set("message", message);
  return NextResponse.redirect(loginUrl.toString());
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const adminOrigin = url.origin.replace(/\/$/, "");
  const oauthCallback = `${adminOrigin}/api/auth/google/callback`;

  const googleError = url.searchParams.get("error");
  if (googleError) {
    return loginRedirect(adminOrigin, "google_auth_denied", "Google sign-in was cancelled.");
  }

  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  if (!code || !state) {
    return loginRedirect(adminOrigin, "invalid_callback", "Google sign-in callback was incomplete.");
  }

  const exchangeResponse = await fetch(`${serverApiBase()}/v1/auth/google/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state, redirectUri: oauthCallback }),
    cache: "no-store"
  });

  const exchangeData = (await exchangeResponse.json().catch(() => ({}))) as {
    accessToken?: string;
    refreshToken?: string;
    redirect?: string;
    error?: string;
    message?: string;
  };

  if (!exchangeResponse.ok || !exchangeData.accessToken) {
    const detail =
      exchangeData.message?.trim() ||
      exchangeData.error?.trim() ||
      (exchangeResponse.status ? `Sign-in request failed (${exchangeResponse.status}).` : "");
    return loginRedirect(
      adminOrigin,
      exchangeData.error ?? "google_exchange_failed",
      detail || "Google sign-in failed."
    );
  }

  const redirectTarget = exchangeData.redirect?.trim() || `${adminOrigin}/auth/callback`;
  const params = new URLSearchParams();
  params.set("coopToken", exchangeData.accessToken);
  if (exchangeData.refreshToken?.trim()) {
    params.set("coopRefresh", exchangeData.refreshToken.trim());
  }
  const separator = redirectTarget.includes("#") ? "&" : "#";
  const location = `${redirectTarget}${separator}${params.toString()}`;

  const response = NextResponse.redirect(location);
  setSessionCookie(response, exchangeData.accessToken);
  return response;
}

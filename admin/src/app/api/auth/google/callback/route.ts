import { NextResponse } from "next/server";
import { serverApiBase, setSessionCookie } from "@/lib/serverCoopApi";

const INVITE_OAUTH_COOKIE = "coop_oauth_invite";

function loginRedirect(origin: string, error: string, message: string): NextResponse {
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", error);
  loginUrl.searchParams.set("message", message);
  return NextResponse.redirect(loginUrl.toString());
}

function acceptInviteRedirect(origin: string, inviteToken: string, error: string, message: string): NextResponse {
  const target = new URL("/accept-invite", origin);
  target.searchParams.set("token", inviteToken);
  target.searchParams.set("error", error);
  target.searchParams.set("message", message);
  const response = NextResponse.redirect(target.toString());
  response.cookies.set(INVITE_OAUTH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

function errorRedirect(redirect: string, error: string, message: string): NextResponse {
  try {
    const target = new URL(redirect);
    target.searchParams.set("error", error);
    target.searchParams.set("message", message);
    const response = NextResponse.redirect(target.toString());
    response.cookies.set(INVITE_OAUTH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch {
    return NextResponse.redirect(redirect);
  }
}

function inviteTokenFromRequest(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)coop_oauth_invite=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const adminOrigin = url.origin.replace(/\/$/, "");
  const oauthCallback = `${adminOrigin}/api/auth/google/callback`;
  const inviteCookie = inviteTokenFromRequest(request);

  const googleError = url.searchParams.get("error");
  if (googleError) {
    if (inviteCookie) {
      return acceptInviteRedirect(
        adminOrigin,
        inviteCookie,
        "google_auth_denied",
        "Google sign-in was cancelled."
      );
    }
    return loginRedirect(adminOrigin, "google_auth_denied", "Google sign-in was cancelled.");
  }

  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  if (!code || !state) {
    if (inviteCookie) {
      return acceptInviteRedirect(
        adminOrigin,
        inviteCookie,
        "invalid_callback",
        "Google sign-in callback was incomplete."
      );
    }
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
    const errorCode = exchangeData.error ?? "google_exchange_failed";
    const message = detail || "Google sign-in failed.";
    if (exchangeData.redirect?.trim()) {
      return errorRedirect(exchangeData.redirect.trim(), errorCode, message);
    }
    if (inviteCookie) {
      return acceptInviteRedirect(adminOrigin, inviteCookie, errorCode, message);
    }
    return loginRedirect(adminOrigin, errorCode, message);
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
  response.cookies.set(INVITE_OAUTH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

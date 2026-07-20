import { NextResponse } from "next/server";
import { serverApiBase } from "@/lib/serverCoopApi";

const INVITE_OAUTH_COOKIE = "coop_oauth_invite";
const INVITE_OAUTH_MAX_AGE_SEC = 15 * 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const modeParam = url.searchParams.get("mode");
  const mode = modeParam === "signup" ? "signup" : modeParam === "invite" ? "invite" : "login";
  const orgName = url.searchParams.get("orgName")?.trim() ?? "";
  const inviteToken = url.searchParams.get("inviteToken")?.trim() ?? "";
  const firstName = url.searchParams.get("firstName")?.trim() ?? "";
  const lastName = url.searchParams.get("lastName")?.trim() ?? "";
  const timezone = url.searchParams.get("timezone")?.trim() ?? "";
  const adminOrigin = url.origin.replace(/\/$/, "");
  const oauthCallback = `${adminOrigin}/api/auth/google/callback`;
  const finalRedirect = `${adminOrigin}/auth/callback`;

  const backendUrl = new URL(`${serverApiBase()}/v1/auth/google/start`);
  backendUrl.searchParams.set("mode", mode);
  backendUrl.searchParams.set("redirect", finalRedirect);
  backendUrl.searchParams.set("redirectUri", oauthCallback);
  if (orgName) {
    backendUrl.searchParams.set("orgName", orgName);
  }
  if (mode === "invite" && inviteToken) {
    backendUrl.searchParams.set("inviteToken", inviteToken);
  }
  if (firstName) {
    backendUrl.searchParams.set("firstName", firstName);
  }
  if (lastName) {
    backendUrl.searchParams.set("lastName", lastName);
  }
  if (timezone) {
    backendUrl.searchParams.set("timezone", timezone);
  }

  const backendResponse = await fetch(backendUrl.toString(), { redirect: "manual", cache: "no-store" });
  const location = backendResponse.headers.get("location");
  if (location) {
    const response = NextResponse.redirect(location);
    if (mode === "invite" && inviteToken) {
      // So Google cancel / incomplete callback can return to accept-invite.
      response.cookies.set(INVITE_OAUTH_COOKIE, inviteToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: adminOrigin.startsWith("https://"),
        path: "/",
        maxAge: INVITE_OAUTH_MAX_AGE_SEC
      });
    } else {
      response.cookies.set(INVITE_OAUTH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    }
    return response;
  }

  const body = (await backendResponse.json().catch(() => ({}))) as { message?: string; error?: string };
  return NextResponse.json(
    { error: body.error ?? "google_auth_unavailable", message: body.message ?? "Google sign-in is unavailable." },
    { status: backendResponse.status || 503 }
  );
}

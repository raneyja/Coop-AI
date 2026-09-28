import { NextResponse } from "next/server";
import { opsPublicOrigin, serverApiBase } from "@/lib/serverCoopApi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const opsOrigin =
    process.env.NODE_ENV === "production" ? opsPublicOrigin() : url.origin.replace(/\/$/, "");
  const oauthCallback = `${opsOrigin}/api/auth/google/callback`;
  const finalRedirect = `${opsOrigin}/auth/callback`;

  const loginError = (error: string, message: string) => {
    const loginUrl = new URL("/login", opsOrigin);
    loginUrl.searchParams.set("error", error);
    loginUrl.searchParams.set("message", message);
    return NextResponse.redirect(loginUrl.toString());
  };

  try {
    const backendUrl = new URL(`${serverApiBase()}/v1/operator/auth/google/start`);
    backendUrl.searchParams.set("redirect", finalRedirect);
    backendUrl.searchParams.set("redirectUri", oauthCallback);

    const backendResponse = await fetch(backendUrl.toString(), {
      redirect: "manual",
      cache: "no-store"
    });
    const location = backendResponse.headers.get("location");
    if (location) {
      return NextResponse.redirect(location);
    }

    const body = (await backendResponse.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    return loginError(
      body.error ?? "google_auth_unavailable",
      body.message ?? "Google sign-in is unavailable. Check API Google OAuth env vars."
    );
  } catch {
    return loginError(
      "google_auth_unavailable",
      `Could not reach the API at ${serverApiBase()}. Is it running?`
    );
  }
}

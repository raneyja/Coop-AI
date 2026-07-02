import { NextResponse } from "next/server";
import { serverApiBase } from "@/lib/serverCoopApi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "signup" ? "signup" : "login";
  const orgName = url.searchParams.get("orgName")?.trim() ?? "";
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

  const backendResponse = await fetch(backendUrl.toString(), { redirect: "manual", cache: "no-store" });
  const location = backendResponse.headers.get("location");
  if (location) {
    return NextResponse.redirect(location);
  }

  const body = (await backendResponse.json().catch(() => ({}))) as { message?: string; error?: string };
  return NextResponse.json(
    { error: body.error ?? "google_auth_unavailable", message: body.message ?? "Google sign-in is unavailable." },
    { status: backendResponse.status || 503 }
  );
}

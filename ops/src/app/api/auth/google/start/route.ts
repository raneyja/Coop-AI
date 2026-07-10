import { NextResponse } from "next/server";
import { serverApiBase } from "@/lib/serverCoopApi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const opsOrigin = url.origin.replace(/\/$/, "");
  const oauthCallback = `${opsOrigin}/api/auth/google/callback`;
  const finalRedirect = `${opsOrigin}/auth/callback`;

  const backendUrl = new URL(`${serverApiBase()}/v1/operator/auth/google/start`);
  backendUrl.searchParams.set("redirect", finalRedirect);
  backendUrl.searchParams.set("redirectUri", oauthCallback);

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
